from __future__ import annotations

import sys
import unittest

from any_subtitle.jobs import Job, JobManager


class JobCommandTests(unittest.TestCase):
    def test_carriage_return_progress_does_not_block(self):
        events: list[dict] = []
        manager = JobManager(events.append, object(), lambda: False)
        job = Job("test-job", {})
        script = (
            "import sys,time;"
            "sys.stdout.write('25% first\\r');sys.stdout.flush();"
            "time.sleep(0.02);"
            "sys.stdout.write('75% second\\r100% done\\r');sys.stdout.flush()"
        )

        manager._run_command(
            job,
            [sys.executable, "-u", "-c", script],
            10,
            50,
        )

        progress = [event["percent"] for event in events]
        self.assertIn(20, progress)
        self.assertIn(40, progress)
        self.assertEqual(progress[-1], 50)
        self.assertEqual(events[-1]["detail"], "100% done")

    def test_ffmpeg_time_maps_to_stage_progress(self):
        events: list[dict] = []
        manager = JobManager(events.append, object(), lambda: False)
        job = Job("test-job", {})
        script = "print('size=1kB time=00:00:05.00 speed=10x')"

        manager._run_command(
            job,
            [sys.executable, "-u", "-c", script],
            46,
            56,
            duration_ms=10_000,
        )

        self.assertEqual(events[-1]["percent"], 51)


if __name__ == "__main__":
    unittest.main()
