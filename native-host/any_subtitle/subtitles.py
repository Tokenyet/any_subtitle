from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import tracks_dir
from .subtitle_text import convert_traditional_tw


TIME_PATTERN = re.compile(
    r"(?P<sh>\d{1,2}):(?P<sm>\d{2}):(?P<ss>\d{2})[,.](?P<sms>\d{3})\s+-->\s+"
    r"(?P<eh>\d{1,2}):(?P<em>\d{2}):(?P<es>\d{2})[,.](?P<ems>\d{3})"
)
TRACK_CACHE_TTL = timedelta(days=7)


def parse_srt(text: str, *, language: str = "auto", traditional_chinese: bool = False) -> list[dict[str, Any]]:
    cues: list[dict[str, Any]] = []
    for index, block in enumerate(re.split(r"\r?\n\s*\r?\n", text.strip())):
        lines = [line.strip("\ufeff") for line in block.splitlines() if line.strip()]
        time_index = next((line_index for line_index, line in enumerate(lines) if "-->" in line), -1)
        if time_index < 0:
            continue
        match = TIME_PATTERN.search(lines[time_index])
        if not match:
            continue
        body = " ".join(lines[time_index + 1:]).strip()
        if not body:
            continue
        body = convert_traditional_tw(body, language, traditional_chinese)
        cues.append({
            "id": f"cue-{index + 1}",
            "startMs": timestamp_ms(match, "s"),
            "endMs": timestamp_ms(match, "e"),
            "text": body,
            "status": "stable",
        })
    return cues


def timestamp_ms(match: re.Match[str], prefix: str) -> int:
    hours = int(match.group(f"{prefix}h"))
    minutes = int(match.group(f"{prefix}m"))
    seconds = int(match.group(f"{prefix}s"))
    millis = int(match.group(f"{prefix}ms"))
    return (((hours * 60) + minutes) * 60 + seconds) * 1000 + millis


def track_key(url: str) -> str:
    return hashlib.sha256(str(url).encode("utf-8")).hexdigest()


def save_track(track: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "url": str(track.get("url") or ""),
        "title": str(track.get("title") or ""),
        "durationMs": max(0, int(track.get("durationMs") or 0)),
        "language": str(track.get("language") or "auto"),
        "source": str(track.get("source") or "unknown"),
        "model": str(track.get("model") or ""),
        "traditionalChinese": track.get("traditionalChinese") is True,
        "generatedAt": str(track.get("generatedAt") or datetime.now(timezone.utc).isoformat()),
        "cues": list(track.get("cues") or []),
    }
    destination = tracks_dir() / track_key(normalized["url"])
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "track.json").write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return normalized


def parse_generated_at(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        generated_at = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)
    return generated_at.astimezone(timezone.utc)


def track_expires_at(track: dict[str, Any]) -> datetime | None:
    generated_at = parse_generated_at(track.get("generatedAt"))
    return generated_at + TRACK_CACHE_TTL if generated_at else None


def track_is_fresh(track: dict[str, Any], *, now: datetime | None = None) -> bool:
    expires_at = track_expires_at(track)
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return bool(expires_at and expires_at > current)


def remove_track_file(path: Path) -> None:
    path.unlink(missing_ok=True)
    try:
        path.parent.rmdir()
    except OSError:
        pass


def normalize_track_traditional(
    track: dict[str, Any],
    enabled: bool,
) -> dict[str, Any]:
    if not enabled:
        return track
    normalized = dict(track)
    language = str(track.get("language") or "auto")
    cues: list[dict[str, Any]] = []
    for raw_cue in track.get("cues") or []:
        if not isinstance(raw_cue, dict):
            continue
        cue = dict(raw_cue)
        cue["text"] = convert_traditional_tw(
            str(cue.get("text") or ""),
            language,
            True,
        )
        cues.append(cue)
    normalized["cues"] = cues
    normalized["traditionalChinese"] = True
    return normalized


def load_track(url: str, *, traditional_chinese: bool = False) -> dict[str, Any] | None:
    path = tracks_dir() / track_key(url) / "track.json"
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, TypeError):
        return None
    if not isinstance(value, dict):
        return None
    if not track_is_fresh(value):
        remove_track_file(path)
        return None
    if traditional_chinese:
        converted = normalize_track_traditional(value, True)
        if converted != value:
            return save_track(converted)
    return value


def track_cache_status(url: str) -> dict[str, Any]:
    track = load_track(url)
    if not track:
        return {"available": False}
    expires_at = track_expires_at(track)
    return {
        "available": True,
        "generatedAt": str(track.get("generatedAt") or ""),
        "expiresAt": expires_at.isoformat() if expires_at else "",
        "source": str(track.get("source") or "unknown"),
        "cueCount": len(track.get("cues") or []),
    }


def prune_expired_tracks() -> int:
    removed = 0
    for path in tracks_dir().glob("*/track.json"):
        try:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError, TypeError):
            remove_track_file(path)
            removed += 1
            continue
        if not isinstance(value, dict) or not track_is_fresh(value):
            remove_track_file(path)
            removed += 1
    return removed


def find_tracks(url: str = "") -> list[dict[str, Any]]:
    if url:
        track = load_track(url)
        return [track] if track else []
    result: list[dict[str, Any]] = []
    for path in tracks_dir().glob("*/track.json"):
        try:
            track = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError, TypeError):
            continue
        if isinstance(track, dict) and track_is_fresh(track):
            result.append(track)
        elif isinstance(track, dict):
            remove_track_file(path)
    return sorted(result, key=lambda item: str(item.get("generatedAt") or ""), reverse=True)
