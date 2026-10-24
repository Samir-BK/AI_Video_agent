"""Synthesize one scene with word timings.

Reads the spoken text on stdin. Writes one JSON object to stdout:

    {"audio": "<base64 mp3>", "words": [{"text", "start", "end"}, ...]}

The whole scene is spoken as several short lines. One long request is what
Microsoft answers with "No audio was received", which used to drop the
solution beat into silence while the picture kept going. Each line is retried
on its own, then the mp3s are joined and the word times are shifted so they
still describe the single clip the player rate-locks to the scene.
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
import sys

import edge_tts

ATTEMPTS = 2
ATTEMPT_TIMEOUT_SEC = 9
# edge-tts writes audio-24khz-48kbitrate-mono-mp3, a 48 kbps CBR stream.
MP3_BITRATE_BPS = 48_000
TICKS_PER_SECOND = 10_000_000


def chunks_of(text: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    chunks: list[str] = []
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) <= 240:
            chunks.append(sentence)
            continue
        buffer = ""
        for piece in re.split(r",\s+", sentence):
            candidate = f"{buffer}, {piece}" if buffer else piece
            if buffer and len(candidate) > 240:
                chunks.append(buffer)
                buffer = piece
            else:
                buffer = candidate
        if buffer:
            chunks.append(buffer)
    return chunks or [text.strip()]


def mp3_seconds(audio: bytes) -> float:
    return max(0.2, (len(audio) * 8) / MP3_BITRATE_BPS)


async def synthesize_chunk(
    text: str,
    voice: str,
    rate: str,
) -> tuple[bytes, list[dict[str, float | str]]]:
    communicate = edge_tts.Communicate(
        text,
        voice,
        rate=rate,
        boundary="WordBoundary",
    )
    audio = bytearray()
    words: list[dict[str, float | str]] = []

    async for message in communicate.stream():
        kind = message["type"]
        if kind == "audio":
            audio.extend(message["data"])
            continue
        if kind != "WordBoundary":
            continue
        start = float(message["offset"]) / TICKS_PER_SECOND
        end = start + float(message["duration"]) / TICKS_PER_SECOND
        word = str(message.get("text", "")).strip()
        if not word:
            continue
        words.append({"text": word, "start": round(start, 3), "end": round(end, 3)})

    if len(audio) < 256:
        raise RuntimeError("edge-tts produced empty audio")
    return bytes(audio), words


async def synthesize_chunk_retry(
    text: str,
    voice: str,
    rate: str,
) -> tuple[bytes, list[dict[str, float | str]]]:
    last_error: Exception | None = None
    for attempt in range(ATTEMPTS):
        try:
            return await asyncio.wait_for(
                synthesize_chunk(text, voice, rate),
                timeout=ATTEMPT_TIMEOUT_SEC,
            )
        except Exception as error:  # noqa: BLE001 — transport and empty-audio failures
            last_error = error
            if attempt + 1 < ATTEMPTS:
                await asyncio.sleep(0.35)
    raise last_error or RuntimeError("edge-tts failed")


async def main() -> None:
    voice = sys.argv[1] if len(sys.argv) > 1 else "en-US-AndrewNeural"
    rate = sys.argv[2] if len(sys.argv) > 2 else "+4%"
    text = sys.stdin.read().strip()
    if not text:
        print("empty text", file=sys.stderr)
        sys.exit(1)

    audio = bytearray()
    words: list[dict[str, float | str]] = []
    offset = 0.0

    try:
        for chunk in chunks_of(text):
            chunk_audio, chunk_words = await synthesize_chunk_retry(chunk, voice, rate)
            audio.extend(chunk_audio)
            for word in chunk_words:
                words.append(
                    {
                        "text": word["text"],
                        "start": round(float(word["start"]) + offset, 3),
                        "end": round(float(word["end"]) + offset, 3),
                    }
                )
            offset += mp3_seconds(chunk_audio)
    except Exception as error:  # noqa: BLE001 — report the line that failed
        print(str(error), file=sys.stderr)
        sys.exit(1)

    json.dump(
        {"audio": base64.b64encode(bytes(audio)).decode("ascii"), "words": words},
        sys.stdout,
    )


if __name__ == "__main__":
    asyncio.run(main())
