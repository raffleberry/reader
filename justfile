# Reader — task runner (requires `just`: https://just.systems)

default:
    @just --list

# Install everything (python deps via uv, js deps via bun).
setup:
    uv sync --group dev
    cd src/ui && bun install

# Run backend API + static UI (http://127.0.0.1:8000).
server:
    uv run python -m reader

# Run UI dev server with /api proxy (http://127.0.0.1:5173).
web:
    cd src/ui && bun run dev

# Run backend + UI together (Ctrl-C stops both).
dev:
    uv run python -m reader & SERVER_PID=$!; \
    trap "kill $SERVER_PID" EXIT INT TERM; \
    cd src/ui && bun run dev

# Production build of the Vue app (served by `just server`).
build:
    cd src/ui && bun run build

# Quick verification: python compile + unit tests + UI build.
check:
    uv run python -m compileall src tests
    uv run --group dev pytest -q
    cd src/ui && bun run build

# Browser tests for the highlighter (first time: bun x playwright install chromium).
e2e:
    cd src/ui && bun x playwright test

# Portable executable for the current OS (Linux binary / Windows .exe).
# Output: dist/reader (or dist/reader.exe on Windows).
package:
    #!/usr/bin/env bash
    set -euo pipefail
    cd src/ui && bun run build
    test -f dist/index.html
    sep=':'; [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* || "$OSTYPE" == win32* ]] && sep=';'
    cd ../.. && uv run --group packaging pyinstaller --noconfirm --clean --onefile \
      --name reader --paths src \
      --add-data "src/ui/dist${sep}ui/dist" \
      --collect-all edge_tts --collect-all aiohttp \
      src/reader/__main__.py

# Remove build output and python caches.
clean:
    rm -rf src/ui/dist src/ui/node_modules/.vite dist build reader.spec
    find src tests -name __pycache__ -type d -prune -exec rm -rf {} +
