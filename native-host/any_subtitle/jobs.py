from __future__ import annotations

import codecs
import re
import shutil
import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .audio import write_pcm_wav
from .config import temp_dir
from .cookies import temporary_cookie_file
from .sessions import CaptureSession
from .subtitles import parse_srt, save_track
from .tools import ffmpeg_location, js_runtime_args, model_path, require_tools
from .whisper_server import WhisperServer


EventSink = Callable[[dict[str, Any]], None]
PERCENT_PATTERN = re.compile(r"(\d{1,3}(?:\.\d+)?)%")
FFMPEG_TIME_PATTERN = re.compile(r"time=(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)")


@dataclass
class Job:
    job_id: str
    request: dict[str, Any]
    input_wav: Path | None = None
    status: str = "queued"
    percent: float = 0
    detail: str = ""
    error: str = ""
    process: subprocess.Popen[str] | None = None
    cancel_requested: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "jobId": self.job_id,
                "event": self.status,
                "percent": self.percent,
                "detail": self.detail,
                "error": self.error,
            }


class JobManager:
    def __init__(
        self,
        send_event: EventSink,
        server: WhisperServer,
        session_active: Callable[[], bool],
    ) -> None:
        self._send_event = send_event
        self._server = server
        self._session_active = session_active
        self._jobs: dict[str, Job] = {}
        self._active_job_id = ""
        self._lock = threading.Lock()

    def start(self, request: dict[str, Any], input_wav: Path | None = None) -> str:
        with self._lock:
            if self._active_job_id or self._session_active():
                raise RuntimeError("Another GPU subtitle job is already active")
            job = Job(str(uuid.uuid4()), dict(request), input_wav=input_wav)
            self._jobs[job.job_id] = job
            self._active_job_id = job.job_id
        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        self._emit(job, "jobProgress", 0, "等待工作")
        return job.job_id

    def start_capture(self, capture: CaptureSession, options: dict[str, Any]) -> str:
        request = {**capture.request, **options, "source": "full-playback-capture"}
        wav_path = capture.pcm_path.with_suffix(".wav")
        write_pcm_wav(wav_path, capture.pcm_path)
        capture.pcm_path.unlink(missing_ok=True)
        return self.start(request, input_wav=wav_path)

    def status(self, job_id: str) -> dict[str, Any]:
        return self._get(job_id).snapshot()

    def cancel(self, job_id: str) -> dict[str, Any]:
        job = self._get(job_id)
        with job.lock:
            job.cancel_requested = True
            process = job.process
        if process and process.poll() is None:
            process.terminate()
        self._emit(job, "error", job.percent, "Cancelled", error="Cancelled")
        return job.snapshot()

    def shutdown(self) -> None:
        with self._lock:
            job = self._jobs.get(self._active_job_id)
        if not job:
            return
        with job.lock:
            job.cancel_requested = True
            process = job.process
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()

    def _get(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
        if not job:
            raise RuntimeError(f"Unknown job: {job_id}")
        return job

    def _run(self, job: Job) -> None:
        work_dir = temp_dir() / job.job_id
        work_dir.mkdir(parents=True, exist_ok=True)
        try:
            self._server.stop()
            wav_path = job.input_wav or self._prepare_audio(job, work_dir)
            self._raise_if_cancelled(job)
            srt_path = self._transcribe(job, wav_path, work_dir)
            language = str(job.request.get("language") or "auto")
            cues = parse_srt(
                srt_path.read_text(encoding="utf-8-sig", errors="replace"),
                language=language,
                traditional_chinese=job.request.get("traditionalChinese") is not False,
            )
            if not cues:
                raise RuntimeError("Whisper produced no subtitle cues")
            track = save_track({
                "url": str(job.request.get("url") or ""),
                "title": str(job.request.get("title") or ""),
                "durationMs": int(job.request.get("durationMs") or 0),
                "language": language,
                "source": str(job.request.get("source") or "local-whisper"),
                "model": "large-v3-turbo",
                "traditionalChinese": job.request.get("traditionalChinese") is not False,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "cues": cues,
            })
            self._emit(job, "trackReady", 100, "字幕已完成", track=track)
        except Cancelled:
            self._emit(job, "error", job.percent, "Cancelled", error="Cancelled")
        except Exception as error:
            text = str(error)
            self._emit(
                job,
                "error",
                job.percent,
                text,
                error=text,
                fallback_available=job.input_wav is None,
                authentication_required=is_authentication_error(text),
            )
        finally:
            if job.input_wav:
                job.input_wav.unlink(missing_ok=True)
            shutil.rmtree(work_dir, ignore_errors=True)
            with self._lock:
                if self._active_job_id == job.job_id:
                    self._active_job_id = ""

    def _prepare_audio(self, job: Job, work_dir: Path) -> Path:
        tools = require_tools(["ffmpeg.exe", "yt-dlp.exe"])
        wav_path = work_dir / "audio.wav"
        current_src = str(job.request.get("currentSrc") or "")
        direct_error = ""
        if current_src.startswith(("http://", "https://")):
            self._emit(job, "jobProgress", 5, "讀取播放器音訊")
            command = [
                str(tools["ffmpeg.exe"]),
                "-y",
                "-i", current_src,
                "-vn",
                "-ar", "16000",
                "-ac", "1",
                "-c:a", "pcm_s16le",
                str(wav_path),
            ]
            try:
                self._run_command(
                    job,
                    command,
                    5,
                    28,
                    duration_ms=int(job.request.get("durationMs") or 0),
                    stage_label="讀取播放器音訊",
                )
                if wav_path.exists() and wav_path.stat().st_size > 44:
                    return wav_path
            except Exception as error:
                direct_error = str(error)
                wav_path.unlink(missing_ok=True)

        url = str(job.request.get("url") or "")
        if not url:
            raise RuntimeError(direct_error or "Accurate subtitle request is missing a URL")
        output_template = work_dir / "source.%(ext)s"
        command = [
            str(tools["yt-dlp.exe"]),
            "--newline",
            "--no-playlist",
            "--restrict-filenames",
            "--socket-timeout", "30",
            "--retries", "20",
            "--fragment-retries", "20",
            "-f", "ba[ext=m4a][abr<=128]/ba[abr<=128]/ba",
            "-o", str(output_template),
        ]
        command.extend(js_runtime_args())
        location = ffmpeg_location()
        if location:
            command.extend(["--ffmpeg-location", location])
        with temporary_cookie_file(job.request.get("cookies")) as cookie_file:
            if cookie_file:
                command.extend(["--cookies", str(cookie_file)])
            command.append(url)
            self._emit(job, "jobProgress", 10, "下載音訊（網路）")
            try:
                self._run_command(job, command, 10, 45, stage_label="下載音訊（網路）")
            except Exception as error:
                detail = str(error)
                if direct_error:
                    detail = f"Direct media failed: {direct_error}\nDownloader failed: {detail}"
                raise RuntimeError(detail) from error

        source = newest_media(work_dir)
        convert = [
            str(tools["ffmpeg.exe"]),
            "-y",
            "-i", str(source),
            "-vn",
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            str(wav_path),
        ]
        self._emit(job, "jobProgress", 46, "準備音訊（CPU）")
        self._run_command(
            job,
            convert,
            46,
            55,
            duration_ms=int(job.request.get("durationMs") or 0),
            stage_label="準備音訊（CPU）",
        )
        return wav_path

    def _transcribe(self, job: Job, wav_path: Path, work_dir: Path) -> Path:
        tools = require_tools(["whisper-cli.exe", "model:large-v3-turbo"])
        output_base = work_dir / "subtitle"
        command = [
            str(tools["whisper-cli.exe"]),
            "-np",
            "-t", "8",
            "-m", str(tools["model:large-v3-turbo"]),
            "-f", str(wav_path),
            "-l", str(job.request.get("language") or "auto"),
            "-bo", "5",
            "-bs", "5",
            "-sow",
            "-osrt",
            "-of", str(output_base),
        ]
        vad = model_path("vad")
        if vad:
            command.extend([
                "--vad",
                "-vm", str(vad),
                "-vsd", "350",
                "-vp", "120",
                "-vo", "0.20",
            ])
        self._emit(job, "jobProgress", 56, "精準轉錄（RTX GPU）")
        self._run_command(job, command, 56, 98, stage_label="精準轉錄（RTX GPU）")
        srt_path = output_base.with_suffix(".srt")
        if not srt_path.exists():
            raise RuntimeError("Whisper did not produce an SRT file")
        return srt_path

    def _run_command(
        self,
        job: Job,
        command: list[str],
        start: float,
        end: float,
        *,
        duration_ms: int = 0,
        stage_label: str = "",
    ) -> None:
        self._raise_if_cancelled(job)
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=0,
        )
        with job.lock:
            job.process = process
        tail: list[str] = []
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        pending_text = ""

        def handle_output_line(raw: str) -> None:
            nonlocal tail
            line = raw.strip()
            if not line:
                return
            tail = (tail + [line])[-18:]
            percent = job.percent
            match = PERCENT_PATTERN.search(line)
            if match:
                source_percent = max(0, min(100, float(match.group(1))))
                percent = start + ((end - start) * source_percent / 100)
            elif duration_ms > 0:
                time_match = FFMPEG_TIME_PATTERN.search(line)
                if time_match:
                    hours, minutes, seconds = time_match.groups()
                    elapsed_ms = (
                        (int(hours) * 3600 + int(minutes) * 60 + float(seconds))
                        * 1000
                    )
                    source_percent = max(0, min(100, elapsed_ms * 100 / duration_ms))
                    percent = start + ((end - start) * source_percent / 100)
            detail = line[-500:]
            if stage_label:
                detail = f"{stage_label} · {detail}"
            self._emit(job, "jobProgress", percent, detail)

        try:
            assert process.stdout is not None
            while True:
                self._raise_if_cancelled(job)
                chunk = process.stdout.read(4096)
                if not chunk:
                    break
                pending_text += decoder.decode(chunk)
                parts = re.split(r"[\r\n]+", pending_text)
                pending_text = parts.pop()
                for line in parts:
                    handle_output_line(line)
            pending_text += decoder.decode(b"", final=True)
            handle_output_line(pending_text)
            code = process.wait()
            if code != 0:
                raise RuntimeError("\n".join(tail) or f"Command failed with exit code {code}")
        finally:
            with job.lock:
                if job.process is process:
                    job.process = None

    def _raise_if_cancelled(self, job: Job) -> None:
        with job.lock:
            cancelled = job.cancel_requested
            process = job.process
        if cancelled:
            if process and process.poll() is None:
                process.terminate()
            raise Cancelled()

    def _emit(
        self,
        job: Job,
        event: str,
        percent: float,
        detail: str,
        *,
        error: str = "",
        track: dict[str, Any] | None = None,
        fallback_available: bool = False,
        authentication_required: bool = False,
    ) -> None:
        with job.lock:
            job.status = event
            job.percent = max(0, min(100, float(percent)))
            job.detail = detail
            if error:
                job.error = error
            payload: dict[str, Any] = {
                "event": event,
                "jobId": job.job_id,
                "percent": job.percent,
                "detail": job.detail,
                "error": job.error,
            }
        if track:
            payload["track"] = track
        if fallback_available:
            payload["fallbackAvailable"] = True
        if authentication_required:
            payload["authenticationRequired"] = True
        self._send_event(payload)


class Cancelled(Exception):
    pass


def newest_media(directory: Path) -> Path:
    ignored = {".wav", ".part", ".ytdl"}
    candidates = [
        path for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() not in ignored
    ]
    if not candidates:
        raise RuntimeError("Downloader produced no audio file")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def is_authentication_error(text: str) -> bool:
    lowered = text.lower()
    return any(pattern in lowered for pattern in (
        "sign in",
        "login",
        "cookies",
        "authentication",
        "http error 401",
        "http error 403",
        "members-only",
        "private video",
    ))
