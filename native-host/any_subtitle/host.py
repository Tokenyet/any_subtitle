from __future__ import annotations

import msvcrt
import os
import sys
import threading
from typing import Any

from . import __version__
from .config import ensure_app_dirs
from .jobs import JobManager
from .protocol import ProtocolError, read_message, write_message
from .sessions import SessionManager
from .subtitles import (
    find_tracks,
    load_track,
    normalize_track_traditional,
    prune_expired_tracks,
    save_track,
    track_cache_status,
)
from .tools import status as tools_status
from .whisper_server import WhisperServer


class NativeHost:
    def __init__(self) -> None:
        self._write_lock = threading.Lock()
        self._server = WhisperServer()
        self._sessions = SessionManager(self.send_event, self._server)
        self._jobs = JobManager(self.send_event, self._server, self._sessions.has_any)

    def run(self) -> None:
        ensure_app_dirs()
        prune_expired_tracks()
        try:
            while True:
                try:
                    message = read_message(sys.stdin.buffer)
                    if message is None:
                        return
                    self.handle_message(message)
                except ProtocolError as error:
                    self.send_event({"event": "error", "error": str(error)})
                    return
                except Exception as error:
                    self.send_response({}, ok=False, error=str(error))
        finally:
            self._jobs.shutdown()
            self._sessions.shutdown()
            self._server.stop()

    def handle_message(self, message: dict[str, Any]) -> None:
        request_id = message.get("id")
        try:
            action = str(message.get("action") or "")
            if action in {"ping", "status"}:
                payload = tools_status()
            elif action == "startLiveSession":
                payload = {"sessionId": self._sessions.start_live(message)}
            elif action == "audioChunk":
                self._sessions.add_chunk(message)
                payload = {"accepted": True}
            elif action == "timelineAnchor":
                self._sessions.timeline_anchor(
                    str(message.get("sessionId") or ""),
                    message.get("anchor") if isinstance(message.get("anchor"), dict) else {},
                )
                payload = {}
            elif action == "stopSession":
                self._sessions.stop(str(message.get("sessionId") or ""))
                payload = {}
            elif action == "startAccurateJob":
                payload = {"jobId": self._jobs.start(message.get("request") or {})}
            elif action == "startCaptureSession":
                session_id = str(message.get("sessionId") or "")
                payload = {
                    "sessionId": self._sessions.start_capture(
                        session_id,
                        message.get("request") if isinstance(message.get("request"), dict) else {},
                    )
                }
            elif action == "finalizeCapture":
                session_id = str(message.get("sessionId") or "")
                capture = self._sessions.take_capture(session_id)
                payload = {
                    "jobId": self._jobs.start_capture(capture, {
                        "language": str(message.get("language") or "auto"),
                        "traditionalChinese": message.get("traditionalChinese") is not False,
                    })
                }
            elif action == "jobStatus":
                payload = {"job": self._jobs.status(str(message.get("jobId") or ""))}
            elif action == "cancelJob":
                payload = {"job": self._jobs.cancel(str(message.get("jobId") or ""))}
            elif action == "findTracks":
                payload = {"tracks": find_tracks(str(message.get("url") or ""))}
            elif action == "loadTrack":
                payload = {
                    "track": load_track(
                        str(message.get("url") or ""),
                        traditional_chinese=message.get("traditionalChinese") is not False,
                    )
                }
            elif action == "trackStatus":
                payload = {"cache": track_cache_status(str(message.get("url") or ""))}
            elif action == "importTrack":
                track = message.get("track") or {}
                track = normalize_track_traditional(
                    track,
                    track.get("traditionalChinese") is not False,
                )
                payload = {"track": save_track(track)}
            else:
                raise RuntimeError(f"Unknown action: {action}")
            self.send_response({"id": request_id, **payload})
        except Exception as error:
            self.send_response({"id": request_id}, ok=False, error=str(error))

    def send_response(self, payload: dict[str, Any], *, ok: bool = True, error: str = "") -> None:
        message = {"ok": ok, "version": __version__, **payload}
        if error:
            message["error"] = error
        with self._write_lock:
            write_message(sys.stdout.buffer, message)

    def send_event(self, payload: dict[str, Any]) -> None:
        with self._write_lock:
            write_message(sys.stdout.buffer, {"ok": True, "version": __version__, **payload})


def main() -> None:
    if os.name == "nt":
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    NativeHost().run()
