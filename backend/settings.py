"""Backend settings, persisted in the system config dir."""
import json

from . import store

DEFAULTS = {"cache_mb": 100, "readahead": 3, "voice": "en-US-AvaNeural"}
MIN_MB, MAX_MB = 10, 2000
MAX_AHEAD = 10


def load() -> dict:
    """Settings merged over defaults (unknown keys dropped)."""
    try:
        saved = json.loads(store.settings_file().read_text())
    except (ValueError, OSError):
        saved = {}
    return {k: saved.get(k, v) for k, v in DEFAULTS.items()}


def check(patch: dict) -> dict:
    """Validated full settings from a partial update. Raises ValueError."""
    if not isinstance(patch, dict):
        raise ValueError("settings must be an object")
    out = load()
    for key, val in patch.items():
        if key == "cache_mb":
            if not isinstance(val, (int, float)) or not MIN_MB <= val <= MAX_MB:
                raise ValueError(f"cache_mb must be {MIN_MB}-{MAX_MB}")
            out[key] = int(val)
        elif key == "readahead":
            if not isinstance(val, int) or not 0 <= val <= MAX_AHEAD:
                raise ValueError(f"readahead must be 0-{MAX_AHEAD}")
            out[key] = val
        elif key == "voice":
            if not isinstance(val, str) or not 3 <= len(val) <= 80:
                raise ValueError("voice must be a voice name")
            out[key] = val
        else:
            raise ValueError(f"unknown setting: {key}")
    return out


def save(patch: dict) -> dict:
    out = check(patch)
    store.settings_file().write_text(json.dumps(out, indent=1))
    return out
