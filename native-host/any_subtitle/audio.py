from __future__ import annotations

import io
import math
import sys
import wave
from array import array
from typing import Iterable


SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2
CHANNELS = 1


def pcm_energy(chunks: Iterable[bytes]) -> tuple[int, float]:
    peak = 0
    square_sum = 0
    sample_count = 0
    for chunk in chunks:
        if not chunk:
            continue
        samples = array("h")
        samples.frombytes(chunk[:len(chunk) - (len(chunk) % 2)])
        if sys.byteorder != "little":
            samples.byteswap()
        for sample in samples:
            absolute = abs(sample)
            peak = max(peak, absolute)
            square_sum += sample * sample
        sample_count += len(samples)
    rms = math.sqrt(square_sum / sample_count) if sample_count else 0.0
    return peak, rms


def has_meaningful_audio(chunks: Iterable[bytes]) -> bool:
    peak, rms = pcm_energy(chunks)
    return peak >= 128 or rms >= 16.0


def pcm_to_wav_bytes(chunks: Iterable[bytes]) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(CHANNELS)
        output.setsampwidth(SAMPLE_WIDTH)
        output.setframerate(SAMPLE_RATE)
        for chunk in chunks:
            output.writeframes(chunk)
    return buffer.getvalue()


def write_pcm_wav(path, pcm_path) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(CHANNELS)
        output.setsampwidth(SAMPLE_WIDTH)
        output.setframerate(SAMPLE_RATE)
        with open(pcm_path, "rb") as source:
            while data := source.read(1024 * 1024):
                output.writeframes(data)
