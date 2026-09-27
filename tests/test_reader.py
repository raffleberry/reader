"""Settings, cache, CORS and routes. Offline-safe: the TTS service is never called."""
import pytest
from aiohttp.test_utils import TestClient, TestServer

import reader


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    """Point the settings file at a temp dir."""
    monkeypatch.setattr(reader, "settings_file", lambda: tmp_path / "settings.json")
    return tmp_path


@pytest.fixture
async def client(cfg):
    """A real HTTP client against the real app (free port, no network)."""
    tc = TestClient(TestServer(reader.make_app()))
    await tc.start_server()
    yield tc
    await tc.close()


# --- settings ---------------------------------------------------------


def test_defaults(cfg):
    assert reader.load_settings() == {
        "cache_mb": 100,
        "readahead": 3,
        "voice": "en-US-AvaNeural",
    }


async def test_save_roundtrip(cfg):
    out = await reader.save_settings({"cache_mb": 50})
    assert out["cache_mb"] == 50
    assert out["voice"] == "en-US-AvaNeural"
    assert reader.load_settings()["cache_mb"] == 50


def test_bad_values_rejected(cfg):
    for patch in (
        {"cache_mb": 1},
        {"cache_mb": 99999},
        {"cache_mb": "lots"},
        {"readahead": -1},
        {"readahead": 99},
        {"voice": ""},
        {"voice": "x" * 81},
        {"nope": 1},
        ["not", "a", "dict"],
    ):
        with pytest.raises(ValueError):
            reader.check_settings(patch)


def test_corrupt_file_falls_back(cfg):
    cfg.joinpath("settings.json").write_text("{broken")
    assert reader.load_settings()["cache_mb"] == 100


# --- speech cache -----------------------------------------------------


def test_key_stable():
    assert reader.key_for("v", "hi") == reader.key_for("v", "hi")
    assert reader.key_for("v", "hi") != reader.key_for("v", "hi ")
    assert reader.key_for("v1", "hi") != reader.key_for("v2", "hi")


async def test_put_get(tmp_path):
    c = reader.Lru(tmp_path / "c", 1000)
    assert await c.get("k") is None
    await c.put("k", b"audio-bytes", [{"text": "hi"}])
    assert await c.get("k") == (b"audio-bytes", [{"text": "hi"}])
    assert (await c.stats())["entries"] == 1


async def test_evicts_lru(tmp_path):
    c = reader.Lru(tmp_path / "c", 30)
    await c.put("a", b"1" * 10, [])
    await c.put("b", b"2" * 10, [])
    await c.get("a")  # touch a; b is now least used
    await c.put("c", b"3" * 10, [])
    assert await c.get("b") is None
    assert await c.get("a") is not None
    assert await c.get("c") is not None


async def test_trim_and_clear(tmp_path):
    c = reader.Lru(tmp_path / "c", 1000)
    await c.put("a", b"1" * 50, [])
    await c.put("b", b"2" * 50, [])
    await c.trim(60)
    assert (await c.stats())["entries"] == 1
    await c.clear()
    assert await c.stats() == {"entries": 0, "bytes": 0}
    assert list((tmp_path / "c").glob("*")) == []


async def test_ensure_validates(cfg):
    with pytest.raises(ValueError):
        await reader.ensure("   ")
    with pytest.raises(ValueError):
        await reader.ensure("x" * (reader.MAX_TEXT + 1))


async def test_ensure_reads_from_cache(cfg, tmp_path, monkeypatch):
    """A warm key is served without touching edge-tts."""
    monkeypatch.setattr(reader, "CACHE", reader.Lru(tmp_path / "c", 1000))

    async def boom(*_args, **_kwargs):
        raise AssertionError("synth must not run for a cached sentence")

    monkeypatch.setattr(reader, "synth", boom)
    key = reader.key_for(reader.DEFAULTS["voice"], "hello there")
    await reader.cache().put(key, b"mp3", [{"text": "hello"}])
    assert await reader.ensure("  hello   there ") == (b"mp3", [{"text": "hello"}])


# --- CORS -------------------------------------------------------------


class FakeReq:
    def __init__(self, origin: str):
        self.headers = {"Origin": origin} if origin else {}


def test_cors_allows_extension_origins():
    for origin in ("chrome-extension://abcdef", "moz-extension://uuid-1"):
        head = reader.cors_headers(FakeReq(origin))
        assert head["Access-Control-Allow-Origin"] == origin
        assert head["Vary"] == "Origin"


def test_cors_refuses_everything_else():
    for origin in ("", "https://example.com", "http://127.0.0.1:8000", "null"):
        assert reader.cors_headers(FakeReq(origin)) == {}


# --- routes -----------------------------------------------------------


async def test_health_reports_version(client):
    res = await client.get("/api/health")
    assert res.status == 200
    assert await res.json() == {"ok": True, "version": reader.VERSION}


async def test_landing_page(client):
    res = await client.get("/")
    assert res.status == 200
    assert "Reader speech server is running" in await res.text()


async def test_settings_roundtrip_over_http(client):
    res = await client.put("/api/settings", json={"voice": "en-GB-RyanNeural"})
    assert res.status == 200
    assert (await res.json())["voice"] == "en-GB-RyanNeural"
    again = await (await client.get("/api/settings")).json()
    assert again["voice"] == "en-GB-RyanNeural"
    assert (await client.put("/api/settings", json={"cache_mb": 1})).status == 400


async def test_speak_rejects_empty_text(client):
    res = await client.post("/api/tts/audio", json={"text": "  "})
    assert res.status == 400
    assert "empty text" in (await res.json())["error"]


async def test_speak_rejects_non_json(client):
    assert (await client.post("/api/tts/audio", data="nope")).status == 400


async def test_prefetch_caps_and_skips_junk(client, monkeypatch):
    warmed: list[str] = []

    async def fake_warm(text):
        warmed.append(text)

    monkeypatch.setattr(reader, "_warm", fake_warm)
    res = await client.post(
        "/api/tts/prefetch", json={"texts": ["a"] * 30 + ["b", "", 5, "c"]}
    )
    assert res.status == 202
    # Only the first 20 texts are warmed, and blanks/non-strings are skipped.
    assert warmed == ["a"] * 20
    assert (await client.post("/api/tts/prefetch", json={"texts": "nope"})).status == 400


async def test_extension_origin_gets_cors_headers(client):
    res = await client.get("/api/health", headers={"Origin": "chrome-extension://abc"})
    assert res.headers["Access-Control-Allow-Origin"] == "chrome-extension://abc"
    site = await client.get("/api/health", headers={"Origin": "https://evil.test"})
    assert "Access-Control-Allow-Origin" not in site.headers


async def test_preflight_from_a_site_is_not_allowed(client):
    res = await client.options("/api/tts/audio", headers={"Origin": "https://evil.test"})
    assert "Access-Control-Allow-Origin" not in res.headers
