"""Open the app in the user's browser."""
import threading
import webbrowser


def open(url: str) -> None:
    def _open():
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Timer(1.0, _open).start()
