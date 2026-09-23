from backend import settings


def test_defaults(tmp_path, monkeypatch):
    use_tmp(tmp_path, monkeypatch)
    assert settings.load() == {
        "cache_mb": 100,
        "readahead": 3,
        "voice": "en-US-AvaNeural",
    }


def test_save_roundtrip(tmp_path, monkeypatch):
    use_tmp(tmp_path, monkeypatch)
    out = settings.save({"cache_mb": 50})
    assert out["cache_mb"] == 50
    assert out["voice"] == "en-US-AvaNeural"
    assert settings.load()["cache_mb"] == 50


def test_bad_values_rejected(tmp_path, monkeypatch):
    use_tmp(tmp_path, monkeypatch)
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
        try:
            settings.save(patch)
        except ValueError:
            pass
        else:
            raise AssertionError(f"expected ValueError for {patch!r}")


def test_corrupt_file_falls_back(tmp_path, monkeypatch):
    use_tmp(tmp_path, monkeypatch)
    from backend import store

    store.settings_file().write_text("{broken")
    assert settings.load()["cache_mb"] == 100


def use_tmp(tmp_path, monkeypatch):
    import backend.store as store_mod

    monkeypatch.setattr(store_mod, "settings_file", lambda: tmp_path / "s.json")
