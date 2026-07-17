from __future__ import annotations

import base64
import threading
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .audio import SAMPLE_RATE, has_meaningful_audio
from .config import temp_dir
from .subtitle_text import convert_traditional_tw
from .whisper_server import WhisperServer, parse_verbose_segments


EventSink = Callable[[dict[str, Any]], None]


@dataclass
class LiveChunk:
    sequence: int
    pcm: bytes
    captured_at_ms: int
    anchor: dict[str, Any]


@dataclass
class LiveSession:
    session_id: str
    tab_id: int
    url: str
    title: str
    language: str
    traditional_chinese: bool
    chunks: deque[LiveChunk] = field(default_factory=lambda: deque(maxlen=8))
    stable_cues: list[dict[str, Any]] = field(default_factory=list)
    last_inference_sequence: int = -1
    inference_running: bool = False
    stopped: bool = False
    seek_epoch: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)


@dataclass
class CaptureSession:
    session_id: str
    request: dict[str, Any]
    pcm_path: Path
    expected_sequence: int = 0
    stopped: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)


class SessionManager:
    def __init__(self, send_event: EventSink, server: WhisperServer) -> None:
        self._send_event = send_event
        self._server = server
        self._live: dict[str, LiveSession] = {}
        self._capture: dict[str, CaptureSession] = {}
        self._lock = threading.Lock()

    def start_live(self, request: dict[str, Any]) -> str:
        session_id = str(request.get("sessionId") or uuid.uuid4())
        session = LiveSession(
            session_id=session_id,
            tab_id=int(request.get("tabId") or 0),
            url=str(request.get("url") or ""),
            title=str(request.get("title") or ""),
            language=str(request.get("language") or "auto"),
            traditional_chinese=request.get("traditionalChinese") is not False,
        )
        with self._lock:
            if self._live or self._capture:
                raise RuntimeError("Another subtitle audio session is already active")
            self._live[session_id] = session
        threading.Thread(target=self._prepare_live, args=(session,), daemon=True).start()
        return session_id

    def start_capture(self, session_id: str, request: dict[str, Any]) -> str:
        temp_dir().mkdir(parents=True, exist_ok=True)
        pcm_path = temp_dir() / f"{session_id}.pcm"
        pcm_path.write_bytes(b"")
        session = CaptureSession(session_id, dict(request), pcm_path)
        with self._lock:
            if self._live or self._capture:
                raise RuntimeError("Another subtitle audio session is already active")
            self._capture[session_id] = session
        self._send_event({"event": "sessionReady", "sessionId": session_id, "mode": "capture"})
        return session_id

    def add_chunk(self, message: dict[str, Any]) -> None:
        session_id = str(message.get("sessionId") or "")
        pcm = decode_pcm(message.get("pcmBase64"))
        with self._lock:
            live = self._live.get(session_id)
            capture = self._capture.get(session_id)
        if live:
            self._add_live_chunk(live, message, pcm)
            return
        if capture:
            self._add_capture_chunk(capture, message, pcm)
            return
        raise RuntimeError(f"Unknown audio session: {session_id}")

    def timeline_anchor(self, session_id: str, anchor: dict[str, Any]) -> None:
        with self._lock:
            session = self._live.get(session_id)
        if not session:
            return
        next_epoch = int(anchor.get("seekEpoch") or 0)
        with session.lock:
            if next_epoch != session.seek_epoch:
                session.chunks.clear()
                session.stable_cues.clear()
                session.last_inference_sequence = -1
                session.seek_epoch = next_epoch

    def stop(self, session_id: str) -> None:
        with self._lock:
            live = self._live.pop(session_id, None)
            capture = self._capture.pop(session_id, None)
        if live:
            with live.lock:
                live.stopped = True
        if capture:
            with capture.lock:
                capture.stopped = True
            capture.pcm_path.unlink(missing_ok=True)
        if not self.has_live():
            self._server.stop()
        self._send_event({"event": "sessionStopped", "sessionId": session_id})

    def take_capture(self, session_id: str) -> CaptureSession:
        with self._lock:
            session = self._capture.pop(session_id, None)
        if not session:
            raise RuntimeError(f"Unknown capture session: {session_id}")
        return session

    def has_live(self) -> bool:
        with self._lock:
            return bool(self._live)

    def has_any(self) -> bool:
        with self._lock:
            return bool(self._live or self._capture)

    def shutdown(self) -> None:
        with self._lock:
            live_sessions = list(self._live.values())
            capture_sessions = list(self._capture.values())
            self._live.clear()
            self._capture.clear()
        for session in live_sessions:
            with session.lock:
                session.stopped = True
        for session in capture_sessions:
            with session.lock:
                session.stopped = True
            session.pcm_path.unlink(missing_ok=True)
        self._server.stop()

    def _prepare_live(self, session: LiveSession) -> None:
        try:
            self._server.ensure_running()
            self._send_event({
                "event": "sessionReady",
                "sessionId": session.session_id,
                "mode": "live",
            })
        except Exception as error:
            self._send_event({
                "event": "error",
                "sessionId": session.session_id,
                "error": str(error),
            })

    def _add_live_chunk(self, session: LiveSession, message: dict[str, Any], pcm: bytes) -> None:
        sequence = int(message.get("sequence") or 0)
        anchor = message.get("anchor") if isinstance(message.get("anchor"), dict) else {}
        with session.lock:
            if session.stopped:
                return
            if session.chunks and sequence <= session.chunks[-1].sequence:
                return
            session.chunks.append(LiveChunk(
                sequence=sequence,
                pcm=pcm,
                captured_at_ms=int(message.get("capturedAtMs") or 0),
                anchor=anchor,
            ))
            should_infer = (
                len(session.chunks) >= 3
                and sequence - session.last_inference_sequence >= 2
                and not session.inference_running
            )
            if should_infer:
                session.inference_running = True
                session.last_inference_sequence = sequence
        if should_infer:
            threading.Thread(target=self._infer_live, args=(session,), daemon=True).start()

    def _add_capture_chunk(self, session: CaptureSession, message: dict[str, Any], pcm: bytes) -> None:
        sequence = int(message.get("sequence") or 0)
        with session.lock:
            if session.stopped or sequence != session.expected_sequence:
                if sequence < session.expected_sequence:
                    return
                raise RuntimeError(
                    f"Capture chunk sequence gap: expected {session.expected_sequence}, received {sequence}"
                )
            with session.pcm_path.open("ab") as output:
                output.write(pcm)
            session.expected_sequence += 1

    def _infer_live(self, session: LiveSession) -> None:
        try:
            with session.lock:
                if session.stopped:
                    return
                chunks = list(session.chunks)
                language = session.language
            pcm_chunks = [chunk.pcm for chunk in chunks]
            if not has_meaningful_audio(pcm_chunks):
                return
            payload = self._server.transcribe(pcm_chunks, language)
            segments, detected_language = parse_verbose_segments(payload)
            if not segments:
                return
            window_duration_ms = round(sum(len(chunk.pcm) for chunk in chunks) / 2 / SAMPLE_RATE * 1000)
            latest_anchor = chunks[-1].anchor
            window_end_ms = int(latest_anchor.get("mediaTimeMs") or window_duration_ms)
            window_start_ms = max(0, window_end_ms - window_duration_ms)
            stable_cutoff = max(window_start_ms, window_end_ms - 2500)
            next_stable: list[dict[str, Any]] = []
            provisional: dict[str, Any] | None = None
            for index, segment in enumerate(segments):
                cue = {
                    "id": f"{session.session_id}-{chunks[-1].sequence}-{index}",
                    "startMs": window_start_ms + int(segment["startMs"]),
                    "endMs": window_start_ms + int(segment["endMs"]),
                    "text": convert_traditional_tw(
                        str(segment["text"]),
                        detected_language,
                        session.traditional_chinese,
                    ),
                    "status": "stable",
                }
                if cue["endMs"] <= stable_cutoff:
                    next_stable.append(cue)
                else:
                    cue["status"] = "provisional"
                    provisional = cue
            with session.lock:
                emitted = merge_new_stable(session.stable_cues, next_stable)
            self._send_event({
                "event": "captionUpdate",
                "sessionId": session.session_id,
                "language": detected_language,
                "stableCues": emitted,
                "provisionalCue": provisional,
            })
        except Exception as error:
            self._send_event({
                "event": "error",
                "sessionId": session.session_id,
                "error": str(error),
            })
        finally:
            with session.lock:
                session.inference_running = False


def decode_pcm(value: Any) -> bytes:
    try:
        data = base64.b64decode(str(value or ""), validate=True)
    except (ValueError, TypeError) as error:
        raise RuntimeError("Invalid PCM chunk encoding") from error
    if not data or len(data) % 2 != 0 or len(data) > 128 * 1024:
        raise RuntimeError(f"Invalid PCM chunk size: {len(data)}")
    return data


def merge_new_stable(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    emitted: list[dict[str, Any]] = []
    for cue in incoming:
        duplicate = any(
            abs(int(old.get("startMs") or 0) - int(cue.get("startMs") or 0)) < 900
            and normalize_text(old.get("text")) == normalize_text(cue.get("text"))
            for old in existing[-12:]
        )
        if not duplicate:
            existing.append(cue)
            emitted.append(cue)
    if len(existing) > 1000:
        del existing[:-1000]
    return emitted


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").lower().split())
