# EPUB Reader — task runner (requires `just`: https://just.systems)

default:
    @just --list

# Install everything (go toolchain + js deps via bun).
setup:
    go version
    cd tts && go mod download
    cd extension && bun install

# Run the speech helper: installs it with a running commentary and exits.
# (Nothing stays running; the browser starts the helper itself for speech.)
tts:
    cd tts && go run .

# Install the speech helper for extension dev. Chrome dev builds get a fresh
# id per machine: pass it so the browser will talk to the helper, e.g.
# `just host-install abcdefgh...` (see chrome://extensions). Firefox needs
# no id (its add-on id is stable).
host-install ID="":
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -n "{{ID}}" ]; then cd tts && go run . --install --extension-id "{{ID}}"; else cd tts && go run . --install; fi

# Run the extension in dev mode (opens a browser with it loaded).
ext:
    cd extension && bun run dev

# Run the extension in dev mode in Firefox.
ext-firefox:
    cd extension && bun run dev:firefox

# Build the extension: extension/.output/chrome-mv3 (load unpacked in Chrome).
build:
    cd extension && bun run build

# Build for Firefox: extension/.output/firefox-mv3 (about:debugging → Load Temporary).
build-firefox:
    cd extension && bun run build:firefox

# Store-ready archives: extension/.output/*-chrome.zip + .output/*-firefox.zip.
zip:
    cd extension && bun run zip && bun run zip:firefox

# Quick verification: go tests + UI unit tests + typecheck + extension build.
check:
    cd tts && go vet ./... && go test ./...
    cd extension && bun run test
    cd extension && bun run typecheck
    cd extension && bun run build

# Browser + helper tests against the built extension and Go binary
# (first time: bun x playwright install chromium).
e2e:
    cd extension && bun run e2e

# Portable helper for the current OS. Output: dist/epub-reader[-version].
package:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p dist
    (cd tts && go build -o ../dist/epub-reader .)

# Portable helpers for Linux + Windows (needs zig or mingw for cgo-free
# cross builds; the helper is pure Go, so plain GOOS suffices).
package-all:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p dist
    (cd tts && GOOS=linux GOARCH=amd64 go build -o ../dist/epub-reader-linux-amd64 .)
    (cd tts && GOOS=windows GOARCH=amd64 go build -o ../dist/epub-reader-windows-amd64.exe .)

# Remove build output and caches.
clean:
    rm -rf extension/.output extension/.wxt extension/node_modules/.vite extension/test-results dist
