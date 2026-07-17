from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    entry = root / "native-host" / "any_subtitle_host.py"
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    process = subprocess.Popen(
        [sys.executable, str(entry)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    assert process.stdin is not None and process.stdout is not None
    payload = json.dumps({"id": "ping", "action": "ping"}).encode("utf-8")
    process.stdin.write(struct.pack("<I", len(payload)) + payload)
    process.stdin.flush()
    raw_length = process.stdout.read(4)
    if len(raw_length) != 4:
        print(process.stderr.read().decode("utf-8", errors="replace"), file=sys.stderr)
        return 1
    length = struct.unpack("<I", raw_length)[0]
    response = json.loads(process.stdout.read(length).decode("utf-8"))
    print(json.dumps(response, ensure_ascii=False, indent=2))
    process.terminate()
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
