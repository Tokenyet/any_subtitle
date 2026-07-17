from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "native-host"))

from any_subtitle.jobs import JobManager  # noqa: E402
from any_subtitle.tools import require_tools  # noqa: E402
from any_subtitle.whisper_server import WhisperServer, parse_verbose_segments  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Any Subtitle CUDA live and accurate transcription.")
    parser.add_argument("source", type=Path, help="Local media file used for validation")
    parser.add_argument("--seconds", type=int, default=12)
    parser.add_argument("--language", default="en")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.source.expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"Source does not exist: {source}")
    tools = require_tools(["ffmpeg.exe"])
    with tempfile.TemporaryDirectory(prefix="any-subtitle-gpu-") as directory:
        root = Path(directory)
        wav = root / "sample.wav"
        subprocess.run([
            str(tools["ffmpeg.exe"]),
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-i", str(source),
            "-t", str(args.seconds),
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            str(wav),
        ], check=True)
        pcm = read_wav_pcm(wav)
        validate_live(pcm, args.language)
        accurate_wav = root / "accurate.wav"
        accurate_wav.write_bytes(wav.read_bytes())
        validate_accurate(accurate_wav, source, args.language)
    return 0


def read_wav_pcm(path: Path) -> bytes:
    import wave

    with wave.open(str(path), "rb") as reader:
        if reader.getframerate() != 16000 or reader.getnchannels() != 1 or reader.getsampwidth() != 2:
            raise RuntimeError("Validation WAV is not 16 kHz mono PCM16")
        return reader.readframes(reader.getnframes())


def validate_live(pcm: bytes, language: str) -> None:
    chunks = [pcm[index:index + 32000] for index in range(0, len(pcm), 32000)]
    server = WhisperServer()
    try:
        payload = server.transcribe(chunks[-8:], language)
        segments, detected = parse_verbose_segments(payload)
    finally:
        server.stop()
    if not segments:
        raise RuntimeError("Live CUDA validation produced no segments")
    print(json.dumps({
        "mode": "live",
        "language": detected,
        "segmentCount": len(segments),
        "segments": segments[:5],
    }, ensure_ascii=False, indent=2))


def validate_accurate(wav: Path, source: Path, language: str) -> None:
    done = threading.Event()
    terminal: dict[str, object] = {}

    def event_sink(event: dict[str, object]) -> None:
        if event.get("event") in {"trackReady", "error"}:
            terminal.update(event)
            done.set()

    server = WhisperServer()
    manager = JobManager(event_sink, server, lambda: False)
    job_id = manager.start({
        "url": f"https://local.validation/{source.name}",
        "title": "Any Subtitle GPU validation",
        "durationMs": 0,
        "language": language,
        "traditionalChinese": True,
        "source": "gpu-validation",
    }, input_wav=wav)
    if not done.wait(timeout=300):
        manager.cancel(job_id)
        raise RuntimeError("Accurate CUDA validation timed out")
    if terminal.get("event") != "trackReady":
        raise RuntimeError(str(terminal.get("error") or "Accurate CUDA validation failed"))
    track = terminal.get("track") if isinstance(terminal.get("track"), dict) else {}
    print(json.dumps({
        "mode": "accurate",
        "jobId": job_id,
        "cueCount": len(track.get("cues") or []),
        "model": track.get("model"),
        "firstCue": (track.get("cues") or [None])[0],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    raise SystemExit(main())
