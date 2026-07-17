from __future__ import annotations

import json
import secrets
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .audio import pcm_to_wav_bytes
from .config import cuda_dir, logs_dir
from .tools import model_path, require_tools


class WhisperServer:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._process: subprocess.Popen[bytes] | None = None
        self._log = None
        self._base_url = ""

    def ensure_running(self) -> None:
        with self._lock:
            if self._process and self._process.poll() is None and self._base_url:
                return
            self._start_locked()

    def stop(self) -> None:
        with self._lock:
            process = self._process
            self._process = None
            self._base_url = ""
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
            if self._log:
                self._log.close()
                self._log = None

    def transcribe(self, pcm_chunks: list[bytes], language: str) -> dict[str, Any]:
        wav = pcm_to_wav_bytes(pcm_chunks)
        fields = {
            "temperature": "0.0",
            "temperature_inc": "0.2",
            "response_format": "verbose_json",
            "language": language or "auto",
        }
        body, content_type = multipart_body(fields, "file", "window.wav", wav)
        last_error: Exception | None = None
        for attempt in range(2):
            self.ensure_running()
            request = urllib.request.Request(
                f"{self._base_url}/inference",
                data=body,
                method="POST",
                headers={"Content-Type": content_type},
            )
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    return json.loads(response.read().decode("utf-8"))
            except (
                urllib.error.URLError,
                ConnectionError,
                OSError,
                TimeoutError,
                json.JSONDecodeError,
            ) as error:
                last_error = error
                self.stop()
                if attempt == 0:
                    continue
        raise RuntimeError(f"Whisper server inference failed: {last_error}") from last_error

    def _start_locked(self) -> None:
        tools = require_tools(["whisper-server.exe", "model:small"])
        server = tools["whisper-server.exe"]
        model = tools["model:small"]
        vad = model_path("vad")
        port = free_port()
        token = secrets.token_urlsafe(18)
        command = [
            str(server),
            "--host", "127.0.0.1",
            "--port", str(port),
            "--request-path", f"/{token}",
            "--inference-path", "/inference",
            "-m", str(model),
            "-l", "auto",
            "-t", "8",
            "-fa",
            "-sns",
        ]
        if vad:
            command.extend([
                "--vad",
                "-vm", str(vad),
                "-vsd", "350",
                "-vp", "120",
                "-vo", "0.20",
            ])
        logs_dir().mkdir(parents=True, exist_ok=True)
        self._log = (logs_dir() / "whisper-server.log").open("ab")
        self._process = subprocess.Popen(
            command,
            cwd=str(cuda_dir() if cuda_dir().exists() else server.parent),
            stdin=subprocess.DEVNULL,
            stdout=self._log,
            stderr=subprocess.STDOUT,
        )
        self._base_url = f"http://127.0.0.1:{port}/{token}"
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if self._process.poll() is not None:
                raise RuntimeError("whisper-server exited during startup")
            try:
                with urllib.request.urlopen(f"{self._base_url}/", timeout=1):
                    return
            except urllib.error.URLError:
                time.sleep(0.25)
        process = self._process
        self._process = None
        self._base_url = ""
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        if self._log:
            self._log.close()
            self._log = None
        raise RuntimeError("whisper-server did not become ready")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def multipart_body(
    fields: dict[str, str],
    file_field: str,
    filename: str,
    content: bytes,
) -> tuple[bytes, str]:
    boundary = f"----AnySubtitle{secrets.token_hex(12)}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            str(value).encode(),
            b"\r\n",
        ])
    parts.extend([
        f"--{boundary}\r\n".encode(),
        (
            f'Content-Disposition: form-data; name="{file_field}"; '
            f'filename="{filename}"\r\n'
        ).encode(),
        b"Content-Type: audio/wav\r\n\r\n",
        content,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def parse_verbose_segments(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    language = str(payload.get("language") or payload.get("detected_language") or "auto")
    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list):
        raw_segments = payload.get("transcription")
    result: list[dict[str, Any]] = []
    if isinstance(raw_segments, list):
        for raw in raw_segments:
            if not isinstance(raw, dict):
                continue
            offsets = raw.get("offsets") if isinstance(raw.get("offsets"), dict) else {}
            start = raw.get("start", offsets.get("from", 0))
            end = raw.get("end", offsets.get("to", start))
            start_ms = normalize_offset(start)
            end_ms = max(start_ms + 1, normalize_offset(end))
            text = str(raw.get("text") or "").strip()
            if text:
                result.append({"startMs": start_ms, "endMs": end_ms, "text": text})
    if not result and str(payload.get("text") or "").strip():
        result.append({
            "startMs": 0,
            "endMs": 2000,
            "text": str(payload["text"]).strip(),
        })
    return result, language


def normalize_offset(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if number < 1000:
        return round(number * 1000)
    return round(number)
