from __future__ import annotations

import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


@contextmanager
def temporary_cookie_file(cookies: Any) -> Iterator[Path | None]:
    values = cookies if isinstance(cookies, list) else []
    if not values:
        yield None
        return
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False)
    path = Path(handle.name)
    try:
        handle.write("# Netscape HTTP Cookie File\n")
        for cookie in values:
            if not isinstance(cookie, dict) or not cookie.get("name"):
                continue
            domain = str(cookie.get("domain") or "")
            include_subdomains = "TRUE" if domain.startswith(".") else "FALSE"
            secure = "TRUE" if cookie.get("secure") else "FALSE"
            expires = int(float(cookie.get("expirationDate") or 0))
            handle.write(
                "\t".join([
                    domain,
                    include_subdomains,
                    str(cookie.get("path") or "/"),
                    secure,
                    str(expires),
                    str(cookie["name"]),
                    str(cookie.get("value") or ""),
                ]) + "\n"
            )
        handle.close()
        yield path
    finally:
        try:
            handle.close()
        except OSError:
            pass
        path.unlink(missing_ok=True)
