"""Read-aloud: edge-tts audio + word timings per sentence.

Only talks to the ``text.py`` interface, never to a file format, so new
formats work here for free once they have a text source.
"""
import json
from pathlib import Path

from . import books, text

VOICE = "en-US-AriaNeural"


def words_path(book_id: str, key: str) -> Path:
    return books.audio_dir(book_id) / f"{key}.json"


def audio_path(book_id: str, key: str) -> Path:
    return books.audio_dir(book_id) / f"{key}.mp3"


def find_sentence(book: dict, key: str) -> text.Sentence:
    """Sentence text for one key. Raises KeyError when missing."""
    raw = books.raw_path(book)
    cache = books.text_cache(book["id"])
    for chapter in text.load_chapters(book["format"], raw, cache):
        for sent in chapter.sentences:
            if sent.key == key:
                return sent
    raise KeyError(key)


async def ensure_audio(book: dict, key: str) -> tuple[Path, list[dict]]:
    """MP3 path + word timings for one sentence (cached on disk).

    Each word: {"text", "start_ms", "end_ms"}.
    Raises KeyError for unknown keys, RuntimeError when TTS fails.
    """
    audio, words_file = audio_path(book["id"], key), words_path(book["id"], key)
    if audio.exists() and words_file.exists():
        return audio, json.loads(words_file.read_text())
    sent = find_sentence(book, key)
    try:
        import edge_tts
    except ImportError as err:
        raise RuntimeError("edge-tts is not installed (run: just setup)") from err
    sound = bytearray()
    words: list[dict] = []
    try:
        talk = edge_tts.Communicate(sent.text, VOICE, boundary="WordBoundary")
        async for msg in talk.stream():
            if msg["type"] == "audio":
                sound.extend(msg["data"])
            elif msg["type"] == "WordBoundary":
                words.append(
                    {
                        "text": msg["text"],
                        "start_ms": msg["offset"] // 10000,
                        "end_ms": (msg["offset"] + msg["duration"]) // 10000,
                    }
                )
    except Exception as err:
        raise RuntimeError(f"speech service failed: {err}") from err
    if not sound:
        raise RuntimeError("speech service returned no audio")
    books.audio_dir(book["id"]).mkdir(parents=True, exist_ok=True)
    audio.write_bytes(bytes(sound))
    words_file.write_text(json.dumps(words))
    return audio, words
