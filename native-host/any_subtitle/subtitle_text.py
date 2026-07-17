from __future__ import annotations

from functools import lru_cache
from typing import Any


def is_chinese(language: Any) -> bool:
    value = str(language or "").strip().lower().replace("_", "-")
    return value in {"zh", "chi", "zho", "chinese", "mandarin"} or value.startswith("zh-")


def is_auto(language: Any) -> bool:
    value = str(language or "").strip().lower().replace("_", "-")
    return value in {"", "auto", "und", "unknown"}


@lru_cache(maxsize=1)
def traditional_tw_converter() -> Any | None:
    try:
        from opencc import OpenCC
    except ModuleNotFoundError:
        return None
    return OpenCC("s2twp")


def convert_traditional_tw(text: str, language: Any, enabled: bool) -> str:
    # Whisper's accurate mode keeps the requested language as "auto".  The
    # Traditional Chinese preference must therefore also apply to auto-detected
    # transcripts; OpenCC leaves non-Chinese text unchanged.
    if not enabled or not (is_chinese(language) or is_auto(language)):
        return text
    converter = traditional_tw_converter()
    if converter is None:
        return text
    return converter.convert(text)
