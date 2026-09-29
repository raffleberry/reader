package main

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// keyFor identifies one cached synthesis: voice + exact text.
func keyFor(voice, text string) string {
	sum := sha1.Sum([]byte(voice + "\n" + text))
	return hex.EncodeToString(sum[:])
}

// Word is one word timing for follow-along highlighting.
type Word struct {
	Text    string `json:"text"`
	StartMs int64  `json:"start_ms"`
	EndMs   int64  `json:"end_ms"`
}

// Lru is a bounded on-disk MP3 + timings cache. Not per-book, not permanent:
// identical sentences share an entry across books, oldest-first out.
type Lru struct {
	mu       sync.Mutex
	base     string
	maxBytes int64
	sizes    map[string]int64
	order    []string // oldest first
	bytes    int64
}

func newLru(base string, maxBytes int64) *Lru {
	l := &Lru{base: base, maxBytes: maxBytes, sizes: map[string]int64{}}
	l.scan()
	return l
}

func (l *Lru) paths(key string) (string, string) {
	return filepath.Join(l.base, key+".mp3"), filepath.Join(l.base, key+".json")
}

func (l *Lru) scan() {
	_ = os.MkdirAll(l.base, 0o755)
	entries, err := os.ReadDir(l.base)
	if err != nil {
		return
	}
	type sized struct {
		key   string
		size  int64
		mtime int64
	}
	var found []sized
	for _, e := range entries {
		name := e.Name()
		if len(name) != 40 || filepath.Ext(name) != ".mp3" {
			continue
		}
		key := name[:40]
		audioPath, wordsPath := l.paths(key)
		audio, err1 := os.Stat(audioPath)
		words, err2 := os.Stat(wordsPath)
		if err1 != nil || err2 != nil {
			_ = os.Remove(audioPath)
			_ = os.Remove(wordsPath)
			continue
		}
		size := audio.Size() + words.Size()
		l.sizes[key] = size
		l.bytes += size
		found = append(found, sized{key, size, audio.ModTime().UnixNano()})
	}
	sort.Slice(found, func(i, j int) bool { return found[i].mtime < found[j].mtime })
	for _, f := range found {
		l.order = append(l.order, f.key)
	}
	l.evictLocked()
}

func (l *Lru) touchLocked(key string) {
	for i, k := range l.order {
		if k == key {
			l.order = append(append(l.order[:i:i], l.order[i+1:]...), key)
			return
		}
	}
	l.order = append(l.order, key)
}

func (l *Lru) unlink(key string) {
	audio, words := l.paths(key)
	_ = os.Remove(audio)
	_ = os.Remove(words)
}

func (l *Lru) evictLocked() {
	for l.bytes > l.maxBytes && len(l.order) > 0 {
		old := l.order[0]
		l.order = l.order[1:]
		l.bytes -= l.sizes[old]
		delete(l.sizes, old)
		l.unlink(old)
	}
}

// Get returns cached audio + timings, or nil when absent.
func (l *Lru) Get(key string) ([]byte, []Word, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.sizes[key]; !ok {
		return nil, nil, false
	}
	audioPath, wordsPath := l.paths(key)
	audio, err1 := os.ReadFile(audioPath)
	raw, err2 := os.ReadFile(wordsPath)
	if err1 != nil || err2 != nil {
		l.bytes -= l.sizes[key]
		delete(l.sizes, key)
		l.unlink(key)
		return nil, nil, false
	}
	var words []Word
	if err := json.Unmarshal(raw, &words); err != nil {
		l.bytes -= l.sizes[key]
		delete(l.sizes, key)
		l.unlink(key)
		return nil, nil, false
	}
	l.touchLocked(key)
	return audio, words, true
}

// Put stores one synthesis result, evicting oldest-first to the cap.
func (l *Lru) Put(key string, audio []byte, words []Word) {
	raw, err := json.Marshal(words)
	if err != nil {
		return
	}
	_ = os.MkdirAll(l.base, 0o755)
	audioPath, wordsPath := l.paths(key)
	if err := os.WriteFile(audioPath, audio, 0o644); err != nil {
		return
	}
	if err := os.WriteFile(wordsPath, raw, 0o644); err != nil {
		_ = os.Remove(audioPath)
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	size := int64(len(audio) + len(raw))
	l.bytes += size - l.sizes[key]
	l.sizes[key] = size
	l.touchLocked(key)
	l.evictLocked()
}

// Trim lowers the cap and evicts to it.
func (l *Lru) Trim(maxBytes int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.maxBytes = maxBytes
	l.evictLocked()
}

// Stats reports entry count and byte use.
func (l *Lru) Stats() (int, int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.sizes), l.bytes
}

// Clear drops every entry.
func (l *Lru) Clear() {
	l.mu.Lock()
	defer l.mu.Unlock()
	for key := range l.sizes {
		l.unlink(key)
	}
	l.sizes = map[string]int64{}
	l.order = nil
	l.bytes = 0
}

var (
	cacheMu      sync.Mutex
	cacheInst    *Lru
	cacheBaseDir string
)

// cacheStore is the process-wide cache, built on first use. It rebuilds when
// the effective base dir changes (EPUB_READER_CACHE_DIR), so tests can point
// it at a temp dir.
func cacheStore() *Lru {
	base, err := cacheBase()
	if err != nil {
		base = filepath.Join(os.TempDir(), Vendor, App, "tts")
	}
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if cacheInst == nil || base != cacheBaseDir {
		cacheBaseDir = base
		cacheInst = newLru(base, int64(loadSettings().CacheMB)*1024*1024)
	}
	return cacheInst
}
