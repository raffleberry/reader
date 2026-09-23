"""LRU + key tests (no network; the TTS service is never touched)."""
import pytest

from reader import voice


def test_key_stable():
    assert voice.key_for("v", "hi") == voice.key_for("v", "hi")
    assert voice.key_for("v", "hi") != voice.key_for("v", "hi ")
    assert voice.key_for("v1", "hi") != voice.key_for("v2", "hi")


async def _lru(tmp_path, limit=1000):
    return voice.Lru(tmp_path / "c", limit)


async def test_put_get(tmp_path):
    cache = await _lru(tmp_path)
    assert await cache.get("k") is None
    await cache.put("k", b"audio-bytes", [{"text": "hi"}])
    assert await cache.get("k") == (b"audio-bytes", [{"text": "hi"}])
    stats = await cache.stats()
    assert stats["entries"] == 1 and stats["bytes"] > 0


async def test_evicts_lru(tmp_path):
    cache = await _lru(tmp_path, limit=30)
    await cache.put("a", b"1" * 10, [])
    await cache.put("b", b"2" * 10, [])
    await cache.get("a")  # touch a; b is now least used
    await cache.put("c", b"3" * 10, [])
    assert await cache.get("b") is None
    assert await cache.get("a") is not None
    assert await cache.get("c") is not None


async def test_trim_and_clear(tmp_path):
    cache = await _lru(tmp_path)
    await cache.put("a", b"1" * 50, [])
    await cache.put("b", b"2" * 50, [])
    await cache.trim(60)
    assert (await cache.stats())["entries"] == 1
    await cache.clear()
    assert await cache.stats() == {"entries": 0, "bytes": 0}
    assert list((tmp_path / "c").glob("*")) == []


async def test_ensure_validates():
    with pytest.raises(ValueError):
        await voice.ensure("   ")
    with pytest.raises(ValueError):
        await voice.ensure("x" * (voice.MAX_TEXT + 1))
