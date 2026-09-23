# Reader — task runner (requires `just`: https://just.systems)

default:
    @just --list

# Install everything (python deps via uv, js deps via bun).
setup:
    uv sync --group dev
    cd frontend && bun install

# Run backend API + static frontend (http://127.0.0.1:8000).
server:
    uv run python -m backend.server

# Run frontend dev server with /api proxy (http://127.0.0.1:5173).
web:
    cd frontend && bun run dev

# Run backend + frontend together (Ctrl-C stops both).
dev:
    uv run python -m backend.server & SERVER_PID=$!; \
    trap "kill $SERVER_PID" EXIT INT TERM; \
    cd frontend && bun run dev

# Production build of the Vue app (served by `just server`).
build:
    cd frontend && bun run build

# Quick verification: python compile + unit tests + frontend build.
check:
    uv run python -m compileall backend tests
    uv run --group dev pytest -q
    cd frontend && bun run build

# Browser tests for the highlighter (first time: bun x playwright install chromium).
e2e:
    cd frontend && bun x playwright test

# Remove build output and python caches.
clean:
    rm -rf frontend/dist frontend/node_modules/.vite
    find backend tests -name __pycache__ -type d -prune -exec rm -rf {} +
