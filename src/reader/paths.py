"""Find the bundled web UI."""
import sys
from importlib import resources
from pathlib import Path


def dist() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "ui" / "dist"  # type: ignore[attr-defined]
    trav = resources.files("reader") / ".." / "ui" / "dist"
    return Path(str(trav)).resolve()
