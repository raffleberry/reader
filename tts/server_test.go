package main

// Settings, cache, framing and dispatch. Offline-safe: the speech service is
// never called (cache hits serve every synthesis here).

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func testEnv(t *testing.T, tmp string) {
	t.Helper()
	t.Setenv("READER_CONFIG_FILE", filepath.Join(tmp, "settings.json"))
	t.Setenv("READER_CACHE_DIR", filepath.Join(tmp, "tts"))
}

// --- settings ---

func TestDefaults(t *testing.T) {
	testEnv(t, t.TempDir())
	got := loadSettings()
	if got.CacheMB != 100 || got.Readahead != 3 || got.Voice != "en-US-AvaNeural" {
		t.Fatalf("defaults = %+v", got)
	}
}

func TestSaveRoundtrip(t *testing.T) {
	testEnv(t, t.TempDir())
	out, err := saveSettings(map[string]any{"cache_mb": float64(50)})
	if err != nil {
		t.Fatal(err)
	}
	if out.CacheMB != 50 || out.Voice != "en-US-AvaNeural" {
		t.Fatalf("saved = %+v", out)
	}
	if loadSettings().CacheMB != 50 {
		t.Fatal("not persisted")
	}
}

func TestBadValuesRejected(t *testing.T) {
	testEnv(t, t.TempDir())
	for _, patch := range []map[string]any{
		{"cache_mb": float64(1)},
		{"cache_mb": float64(99999)},
		{"cache_mb": "lots"},
		{"readahead": float64(-1)},
		{"readahead": float64(99)},
		{"voice": ""},
		{"voice": string(make([]byte, 81))},
		{"nope": 1},
	} {
		if _, err := checkSettings(patch); err == nil {
			t.Fatalf("accepted %+v", patch)
		}
	}
	if _, err := checkSettings(nil); err == nil {
		t.Fatal("accepted nil patch")
	}
}

func TestCorruptFileFallsBack(t *testing.T) {
	tmp := t.TempDir()
	testEnv(t, tmp)
	if err := os.WriteFile(filepath.Join(tmp, "settings.json"), []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	if loadSettings().CacheMB != 100 {
		t.Fatal("corrupt file did not fall back")
	}
}

// --- cache ---

func TestKeyStable(t *testing.T) {
	if keyFor("v", "hi") != keyFor("v", "hi") {
		t.Fatal("unstable key")
	}
	if keyFor("v", "hi") == keyFor("v", "hi ") {
		t.Fatal("text not distinguished")
	}
	if keyFor("v1", "hi") == keyFor("v2", "hi") {
		t.Fatal("voice not distinguished")
	}
}

func TestPutGet(t *testing.T) {
	c := newLru(filepath.Join(t.TempDir(), "c"), 1000)
	if _, _, ok := c.Get("k"); ok {
		t.Fatal("phantom hit")
	}
	c.Put("k", []byte("audio-bytes"), []Word{{Text: "hi"}})
	audio, words, ok := c.Get("k")
	if !ok || string(audio) != "audio-bytes" || len(words) != 1 || words[0].Text != "hi" {
		t.Fatalf("get = %q %+v %v", audio, words, ok)
	}
	if entries, _ := c.Stats(); entries != 1 {
		t.Fatalf("entries = %d", entries)
	}
}

func TestEvictsLRU(t *testing.T) {
	c := newLru(filepath.Join(t.TempDir(), "c"), 30)
	c.Put("a", bytes.Repeat([]byte("1"), 10), nil)
	c.Put("b", bytes.Repeat([]byte("2"), 10), nil)
	c.Get("a") // touch a; b is now least used
	c.Put("c", bytes.Repeat([]byte("3"), 10), nil)
	if _, _, ok := c.Get("b"); ok {
		t.Fatal("b should have been evicted")
	}
	if _, _, ok := c.Get("a"); !ok {
		t.Fatal("a should have survived")
	}
	if _, _, ok := c.Get("c"); !ok {
		t.Fatal("c should have survived")
	}
}

func TestTrimAndClear(t *testing.T) {
	c := newLru(filepath.Join(t.TempDir(), "c"), 1000)
	c.Put("a", bytes.Repeat([]byte("1"), 50), nil)
	c.Put("b", bytes.Repeat([]byte("2"), 50), nil)
	c.Trim(60)
	if entries, _ := c.Stats(); entries != 1 {
		t.Fatalf("entries after trim = %d", entries)
	}
	c.Clear()
	if entries, n := c.Stats(); entries != 0 || n != 0 {
		t.Fatalf("after clear = %d %d", entries, n)
	}
}

// --- synthesis validation (never reaches the network) ---

func TestEnsureValidates(t *testing.T) {
	testEnv(t, t.TempDir())
	ctx := context.Background()
	if _, _, err := ensure(ctx, "   ", ""); err == nil {
		t.Fatal("accepted blank text")
	}
	if _, _, err := ensure(ctx, string(bytes.Repeat([]byte("x"), MaxText+1)), ""); err == nil {
		t.Fatal("accepted over-long text")
	}
}

func TestEnsureReadsFromCache(t *testing.T) {
	testEnv(t, t.TempDir())
	key := keyFor(defaultSettings().Voice, "hello there")
	cacheStore().Put(key, []byte("mp3"), []Word{{Text: "hello"}})
	audio, words, err := ensure(context.Background(), "  hello   there ", "")
	if err != nil {
		t.Fatal(err)
	}
	if string(audio) != "mp3" || len(words) != 1 {
		t.Fatalf("cache miss: %q %+v", audio, words)
	}
}

// --- framing ---

func TestFrameRoundtrip(t *testing.T) {
	var buf bytes.Buffer
	if err := writeMessage(&buf, Response{ID: 7, Ok: true}); err != nil {
		t.Fatal(err)
	}
	raw, err := readMessage(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"id":7`)) {
		t.Fatalf("frame = %s", raw)
	}
}

// --- dispatch ---

func TestDispatchPing(t *testing.T) {
	testEnv(t, t.TempDir())
	res, err := dispatch(context.Background(), Request{ID: 1, Method: "ping"})
	if err != nil {
		t.Fatal(err)
	}
	m := res.(map[string]any)
	if m["version"] != Version {
		t.Fatalf("ping = %+v", res)
	}
}

func TestDispatchSettingsRoundtrip(t *testing.T) {
	testEnv(t, t.TempDir())
	ctx := context.Background()
	res, err := dispatch(ctx, Request{ID: 1, Method: "putSettings", Params: map[string]any{"voice": "en-GB-RyanNeural"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.(Settings).Voice != "en-GB-RyanNeural" {
		t.Fatalf("put = %+v", res)
	}
	if _, err := dispatch(ctx, Request{ID: 2, Method: "putSettings", Params: map[string]any{"cache_mb": float64(1)}}); err == nil {
		t.Fatal("accepted bad cache_mb")
	}
}

func TestDispatchSpeakRejectsEmpty(t *testing.T) {
	testEnv(t, t.TempDir())
	if _, err := dispatch(context.Background(), Request{ID: 1, Method: "speak", Params: map[string]any{"text": "  "}}); err == nil {
		t.Fatal("accepted empty text")
	}
	if _, err := dispatch(context.Background(), Request{ID: 1, Method: "nope"}); err == nil {
		t.Fatal("accepted unknown method")
	}
}

func TestDispatchPrefetchSkipsJunk(t *testing.T) {
	testEnv(t, t.TempDir())
	res, err := dispatch(context.Background(), Request{ID: 1, Method: "prefetch", Params: map[string]any{
		"texts": []any{"", 5, nil},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if res.(map[string]any)["ok"] != true {
		t.Fatalf("prefetch = %+v", res)
	}
}

func TestDispatchCacheStats(t *testing.T) {
	testEnv(t, t.TempDir())
	res, err := dispatch(context.Background(), Request{ID: 1, Method: "cacheStats"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := res.(map[string]any)["entries"]; !ok {
		t.Fatalf("stats = %+v", res)
	}
}

// --- home dirs (Vendor / App namespacing) ---

func TestVendorDirLayout(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("READER_CONFIG_DIR", "")
	t.Setenv("READER_CONFIG_FILE", "")
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(tmp, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(tmp, "cache"))
	if runtime.GOOS == "windows" {
		// os.UserConfigDir ignores XDG vars on Windows and reads
		// %APPDATA% instead.
		t.Setenv("APPDATA", filepath.Join(tmp, "config"))
	}
	dir, err := appConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(tmp, "config", Vendor, App)
	if dir != want {
		t.Fatalf("config dir = %q, want %q", dir, want)
	}
	dest, err := installedBinaryPath()
	if err != nil {
		t.Fatal(err)
	}
	if dest != filepath.Join(want, binaryName()) {
		t.Fatalf("binary path = %q", dest)
	}
	cf, err := configFile()
	if err != nil {
		t.Fatal(err)
	}
	if cf != filepath.Join(want, "settings.json") {
		t.Fatalf("config file = %q", cf)
	}
}

func TestManifestUsesNewHost(t *testing.T) {
	raw, err := manifestBytes("/tmp/reader", []string{"deadbeef"})
	if err != nil {
		t.Fatal(err)
	}
	var m manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if m.Name != Host || Host != "io.github.raffleberry.reader" {
		t.Fatalf("manifest name = %q", m.Name)
	}
	if len(m.AllowedExtensions) != 1 || m.AllowedExtensions[0] != firefoxID {
		t.Fatalf("allowed extensions = %q", m.AllowedExtensions)
	}
	if firefoxID != "reader@io.github.raffleberry" {
		t.Fatalf("firefox id = %q", firefoxID)
	}
}

func TestInstallBinaryOverwrites(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("READER_CONFIG_DIR", filepath.Join(tmp, "cfg"))
	src := filepath.Join(tmp, "src-bin")
	if err := os.WriteFile(src, []byte("v1"), 0o755); err != nil {
		t.Fatal(err)
	}
	dest, err := installBinaryFrom(src)
	if err != nil {
		t.Fatal(err)
	}
	if raw, _ := os.ReadFile(dest); string(raw) != "v1" {
		t.Fatalf("dest = %q", raw)
	}
	if runtime.GOOS != "windows" {
		// Windows has no exec bits: executability is the .exe
		// suffix, not the mode. Chmod/Perm checks are meaningless
		// there (Stat always reports 0666).
		if fi, err := os.Stat(dest); err != nil || fi.Mode().Perm()&0o111 == 0 {
			t.Fatalf("dest not executable: %+v %v", fi, err)
		}
	}
	if err := os.WriteFile(src, []byte("v2-longer"), 0o755); err != nil {
		t.Fatal(err)
	}
	dest2, err := installBinaryFrom(src)
	if err != nil {
		t.Fatal(err)
	}
	if dest2 != dest {
		t.Fatalf("dest moved: %q vs %q", dest2, dest)
	}
	if raw, _ := os.ReadFile(dest); string(raw) != "v2-longer" {
		t.Fatalf("not overwritten: %q", raw)
	}
	if _, err := installBinaryFrom(src); err != nil {
		t.Fatal(err) // identical content is a no-op, not an error
	}
}
