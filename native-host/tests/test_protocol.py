from __future__ import annotations

import io
import unittest

from any_subtitle.protocol import read_message, write_message


class ProtocolTests(unittest.TestCase):
    def test_round_trip_unicode(self):
        stream = io.BytesIO()
        write_message(stream, {"id": "1", "text": "精準字幕"})
        stream.seek(0)
        self.assertEqual(read_message(stream), {"id": "1", "text": "精準字幕"})


if __name__ == "__main__":
    unittest.main()
