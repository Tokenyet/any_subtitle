from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .config import cuda_dir, models_dir, toolchain_root


@dataclass(frozen=True)
class Tool:
    name: str
    path: Path | None
    source: str

    @property
    def available(self) -> bool:
        return self.path is not None and self.path.exists()

    def as_dict(self) -> dict[str, object]:
        return {
            "available": self.available,
            "path": str(self.path) if self.path else "",
            "source": self.source,
        }


def resolve_tool(executable: str, *, prefer_cuda: bool = False) -> Tool:
    candidates: list[tuple[Path, str]] = []
    if prefer_cuda:
        candidates.append((cuda_dir() / executable, "shared-cuda"))
    candidates.extend([
        (toolchain_root() / executable, "shared"),
        (cuda_dir() / executable, "shared-cuda"),
    ])
    seen: set[Path] = set()
    for path, source in candidates:
        if path in seen:
            continue
        seen.add(path)
        if path.exists():
            return Tool(executable.removesuffix(".exe"), path, source)
    found = shutil.which(executable)
    return Tool(
        executable.removesuffix(".exe"),
        Path(found) if found else None,
        "path" if found else "missing",
    )


def model_path(name: str) -> Path | None:
    aliases = {
        "small": "ggml-small.bin",
        "large-v3-turbo": "ggml-large-v3-turbo.bin",
        "vad": "ggml-silero-v6.2.0.bin",
    }
    path = models_dir() / aliases.get(name, name)
    return path if path.exists() else None


def require_tools(names: Iterable[str]) -> dict[str, Path]:
    result: dict[str, Path] = {}
    missing: list[str] = []
    for name in names:
        if name.startswith("model:"):
            model_name = name.split(":", 1)[1]
            path = model_path(model_name)
        else:
            path = resolve_tool(name, prefer_cuda=name.startswith("whisper-")).path
        if path:
            result[name] = path
        else:
            missing.append(name)
    if missing:
        raise RuntimeError(f"Missing required tool(s): {', '.join(missing)}")
    return result


def ffmpeg_location() -> str:
    path = resolve_tool("ffmpeg.exe").path
    return str(path.parent) if path else ""


def js_runtime_args() -> list[str]:
    for runtime, executable in (
        ("deno", "deno.exe"),
        ("node", "node.exe"),
        ("bun", "bun.exe"),
        ("quickjs", "qjs.exe"),
    ):
        tool = resolve_tool(executable)
        if tool.path:
            return ["--js-runtimes", f"{runtime}:{tool.path}"]
    return []


def status() -> dict[str, object]:
    items = {
        "ffmpeg": resolve_tool("ffmpeg.exe").as_dict(),
        "ffprobe": resolve_tool("ffprobe.exe").as_dict(),
        "yt-dlp": resolve_tool("yt-dlp.exe").as_dict(),
        "whisper-server": resolve_tool("whisper-server.exe", prefer_cuda=True).as_dict(),
        "whisper-cli": resolve_tool("whisper-cli.exe", prefer_cuda=True).as_dict(),
        "small-model": {
            "available": model_path("small") is not None,
            "path": str(model_path("small") or ""),
            "source": "shared-models",
        },
        "accurate-model": {
            "available": model_path("large-v3-turbo") is not None,
            "path": str(model_path("large-v3-turbo") or ""),
            "source": "shared-models",
        },
        "vad-model": {
            "available": model_path("vad") is not None,
            "path": str(model_path("vad") or ""),
            "source": "shared-models",
        },
    }
    live_ready = all(bool(items[key]["available"]) for key in ("ffmpeg", "whisper-server", "small-model"))
    accurate_ready = all(bool(items[key]["available"]) for key in ("ffmpeg", "yt-dlp", "whisper-cli", "accurate-model"))
    return {
        "ready": live_ready,
        "liveReady": live_ready,
        "accurateReady": accurate_ready,
        "toolchainRoot": str(toolchain_root()),
        "tools": items,
        "message": "" if live_ready else "Run scripts/update-tools.ps1 and ensure the shared CUDA whisper.cpp tools exist.",
    }
