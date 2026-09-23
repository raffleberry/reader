"""App dirs: system cache for TTS audio, system config for settings.

Linux: ~/.cache/reader + ~/.config/reader. macOS/Windows follow
platformdirs (~/Library/Caches, %LOCALAPPDATA%). Nothing book-shaped
lives here; books are stored by the frontend in IndexedDB.
"""
from pathlib import Path

from platformdirs import user_cache_dir, user_config_dir

APP = "reader"


def tts_dir() -> Path:
    d = Path(user_cache_dir(APP)) / "tts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def settings_file() -> Path:
    d = Path(user_config_dir(APP))
    d.mkdir(parents=True, exist_ok=True)
    return d / "settings.json"
