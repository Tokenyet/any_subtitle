from __future__ import annotations

import base64
import io
import unittest
import wave

from any_subtitle.audio import has_meaningful_audio, pcm_energy, pcm_to_wav_bytes
from any_subtitle.sessions import LiveChunk, LiveSession, SessionManager, decode_pcm, merge_new_stable
from any_subtitle.whisper_server import parse_verbose_segments


class AudioAndLiveTests(unittest.TestCase):
    def test_pcm_to_wav(self):
        wav = pcm_to_wav_bytes([b"\x00\x00" * 16000])
        with wave.open(io.BytesIO(wav), "rb") as reader:
            self.assertEqual(reader.getframerate(), 16000)
            self.assertEqual(reader.getnchannels(), 1)
            self.assertEqual(reader.getnframes(), 16000)

    def test_decode_pcm(self):
        raw = b"\x01\x00" * 32
        self.assertEqual(decode_pcm(base64.b64encode(raw).decode()), raw)

    def test_silence_is_not_sent_to_whisper(self):
        silence = b"\x00\x00" * 16000
        self.assertEqual(pcm_energy([silence]), (0, 0.0))
        self.assertFalse(has_meaningful_audio([silence]))

    def test_speech_level_pcm_is_meaningful(self):
        signal = (1000).to_bytes(2, "little", signed=True) * 16000
        peak, rms = pcm_energy([signal])
        self.assertEqual(peak, 1000)
        self.assertAlmostEqual(rms, 1000.0)
        self.assertTrue(has_meaningful_audio([signal]))

    def test_merge_stable_deduplicates_overlap(self):
        existing = [{"startMs": 1000, "endMs": 2000, "text": "hello"}]
        emitted = merge_new_stable(existing, [
            {"startMs": 1200, "endMs": 2100, "text": " hello "},
            {"startMs": 3000, "endMs": 4000, "text": "world"},
        ])
        self.assertEqual([cue["text"] for cue in emitted], ["world"])

    def test_parse_server_transcription_offsets(self):
        segments, language = parse_verbose_segments({
            "language": "en",
            "transcription": [{
                "offsets": {"from": 1000, "to": 2500},
                "text": "hello",
            }],
        })
        self.assertEqual(language, "en")
        self.assertEqual(segments[0]["startMs"], 1000)
        self.assertEqual(segments[0]["endMs"], 2500)

    def test_silent_live_window_emits_an_empty_caption_update(self):
        events = []

        class ServerThatMustNotRun:
            def transcribe(self, _chunks, _language):
                raise AssertionError("silence must not be sent to Whisper")

        session = LiveSession("session-1", 1, "", "", "auto", True)
        session.chunks.extend([
            LiveChunk(index, b"\x00\x00" * 16000, index * 1000, {})
            for index in range(3)
        ])
        manager = SessionManager(events.append, ServerThatMustNotRun())

        manager._infer_live(session)

        self.assertEqual(events, [{
            "event": "captionUpdate",
            "sessionId": "session-1",
            "language": "",
            "stableCues": [],
            "provisionalCue": None,
        }])

    def test_vad_window_without_speech_emits_an_empty_caption_update(self):
        events = []

        class ServerWithoutSpeech:
            def transcribe(self, _chunks, _language):
                return {"language": "zh", "transcription": []}

        signal = (1000).to_bytes(2, "little", signed=True) * 16000
        session = LiveSession("session-2", 1, "", "", "auto", True)
        session.chunks.extend([
            LiveChunk(index, signal, index * 1000, {})
            for index in range(3)
        ])
        manager = SessionManager(events.append, ServerWithoutSpeech())

        manager._infer_live(session)

        self.assertEqual(events, [{
            "event": "captionUpdate",
            "sessionId": "session-2",
            "language": "zh",
            "stableCues": [],
            "provisionalCue": None,
        }])


if __name__ == "__main__":
    unittest.main()
