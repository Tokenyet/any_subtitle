from __future__ import annotations

import json
import os
from pathlib import Path


APP_NAME = "AnySubtitle"
HOST_NAME = "com.dowen.any_subtitle"
PRODUCT_KEY = "any_subtitle"
SHARED_STATE_NAME = "com.dowen.local_exporter"


def local_app_data() -> Path:
    root = os.environ.get("LOCALAPPDATA")
    return Path(root) if root else Path.home() / "AppData" / "Local"


def app_dir() -> Path:
    return local_app_data() / APP_NAME


def tracks_dir() -> Path:
    return app_dir() / "tracks"


def temp_dir() -> Path:
    return app_dir() / "temp"


def logs_dir() -> Path:
    return app_dir() / "logs"


def shared_state_dir() -> Path:
    return local_app_data() / SHARED_STATE_NAME


def default_shared_toolchain_root() -> Path:
    return shared_state_dir() / "toolchain"


def toolchain_settings_path() -> Path:
    return shared_state_dir() / "settings.json"


def toolchain_root() -> Path:
    override = os.environ.get("DOWEN_LOCAL_EXPORT_TOOLCHAIN_ROOT")
    if override:
        return Path(override).expanduser()

    settings_path = toolchain_settings_path()
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8-sig"))
            product = (settings.get("products") or {}).get(PRODUCT_KEY) or {}
            if product.get("root"):
                return Path(str(product["root"])).expanduser()
            root = settings.get("root")
            if root:
                return Path(str(root)).expanduser()
        except (OSError, ValueError, TypeError):
            pass

    shared = default_shared_toolchain_root()
    if shared.exists():
        return shared
    return app_dir() / "tools"


def models_dir() -> Path:
    return toolchain_root() / "models"


def cuda_dir() -> Path:
    return toolchain_root() / "cuda"


def ensure_app_dirs() -> None:
    for path in (app_dir(), tracks_dir(), temp_dir(), logs_dir()):
        path.mkdir(parents=True, exist_ok=True)
