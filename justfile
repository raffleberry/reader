# Reader — task runner (requires `just`: https://just.systems)

default:
    @just --list

# Install everything (python deps via uv, js deps via bun).
setup:
    uv sync --group dev
    cd src/ui && bun install

# Run the speech server (http://127.0.0.1:8000). The extension finds it.
server:
    uv run reader.py

# Run the extension in dev mode (opens a browser with it loaded).
ext:
    cd src/ui && bun run dev

# Speech server + extension dev mode (Ctrl-C stops both).
dev:
    uv run reader.py & SERVER_PID=$!; \
    trap "kill $SERVER_PID" EXIT INT TERM; \
    cd src/ui && bun run dev

# Build the extension: .output/chrome-mv3 (load unpacked in Chrome).
build:
    cd src/ui && bun run build

# Build for Firefox: .output/firefox-mv3 (about:debugging → Load Temporary).
build-firefox:
    cd src/ui && bun run build:firefox

# Store-ready archives: .output/*-chrome.zip + .output/*-firefox.zip.
zip:
    cd src/ui && bun run zip && bun run zip:firefox

# Quick verification: python compile + unit tests + UI unit tests + typecheck + build.
check:
    uv run python -m compileall reader.py tests
    uv run --group dev pytest -q
    cd src/ui && bun run test
    cd src/ui && bun run typecheck
    cd src/ui && bun run build

# Browser tests against the built extension (first time: bun x playwright install chromium).
e2e:
    cd src/ui && bun run e2e

# Portable executable for the current OS (Linux binary / Windows .exe).
# Output: dist/reader (or dist/reader.exe on Windows).
package:
    #!/usr/bin/env bash
    set -euo pipefail
    uv run --group packaging pyinstaller --noconfirm --clean --onefile \
      --name reader \
      --collect-all edge_tts --collect-all aiohttp \
      reader.py

# Remove build output and python caches.
clean:
    rm -rf src/ui/.output src/ui/.wxt src/ui/node_modules/.vite src/ui/test-results dist build reader.spec
    find . -name __pycache__ -type d -prune -exec rm -rf {} +
