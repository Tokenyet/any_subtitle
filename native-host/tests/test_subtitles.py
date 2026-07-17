from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from any_subtitle.subtitles import load_track, parse_srt, save_track, track_cache_status


SRT = """1
00:00:01,000 --> 00:00:02,500
第一句

2
00:00:03.000 --> 00:00:04.000
Second line
"""


class SubtitleTests(unittest.TestCase):
    def test_parse_srt(self):
        cues = parse_srt(SRT)
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0]["startMs"], 1000)
        self.assertEqual(cues[1]["endMs"], 4000)

    def test_parse_srt_converts_auto_detected_chinese_to_taiwan_traditional(self):
        cues = parse_srt(
            """1
00:00:01,000 --> 00:00:02,500
各位乘客 请注意 软件里面
""",
            language="auto",
            traditional_chinese=True,
        )
        self.assertEqual(cues[0]["text"], "各位乘客 請注意 軟體裡面")

    def test_parse_srt_does_not_convert_explicit_english(self):
        cues = parse_srt(
            """1
00:00:01,000 --> 00:00:02,500
Software passenger
""",
            language="en",
            traditional_chinese=True,
        )
        self.assertEqual(cues[0]["text"], "Software passenger")

    def test_track_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("any_subtitle.subtitles.tracks_dir", return_value=Path(directory)):
                track = save_track({
                    "url": "https://example.com/watch/1",
                    "title": "Demo",
                    "language": "en",
                    "cues": parse_srt(SRT),
                })
                loaded = load_track(track["url"])
        self.assertEqual(loaded["title"], "Demo")
        self.assertEqual(len(loaded["cues"]), 2)

    def test_fresh_track_is_available_for_seven_days(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("any_subtitle.subtitles.tracks_dir", return_value=Path(directory)):
                track = save_track({
                    "url": "https://example.com/watch/fresh",
                    "generatedAt": (datetime.now(timezone.utc) - timedelta(days=6)).isoformat(),
                    "cues": parse_srt(SRT),
                })
                status = track_cache_status(track["url"])
        self.assertTrue(status["available"])
        self.assertEqual(status["cueCount"], 2)
        self.assertTrue(status["expiresAt"])

    def test_expired_track_is_removed_after_seven_days(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("any_subtitle.subtitles.tracks_dir", return_value=root):
                track = save_track({
                    "url": "https://example.com/watch/expired",
                    "generatedAt": (datetime.now(timezone.utc) - timedelta(days=8)).isoformat(),
                    "cues": parse_srt(SRT),
                })
                self.assertIsNone(load_track(track["url"]))
                self.assertFalse(track_cache_status(track["url"])["available"])
                self.assertFalse(any(root.rglob("track.json")))


if __name__ == "__main__":
    unittest.main()
