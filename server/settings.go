// Package main is the EPUB Reader speech server: a tray application that
// is also a self-installing native-messaging host.
//
// The browser extension holds the books and drives playback; this process
// only turns plain text into spoken audio. It keeps a small on-disk cache
// so a sentence is generated once and replays instantly.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	// Version of the speech server. The extension's probe reports it.
	Version = "1.0.0"
	// App is the display name and the on-disk directory base.
	App = "epub-reader"
	// Host is the native-messaging host name shared with the extension.
	Host = "com.raffleberry.epubreader"
	// MaxText is the longest single synthesis request, in characters.
	MaxText = 5000
	// MaxPrefetch caps one prefetch batch; the rest is ignored.
	MaxPrefetch = 20
	// MinMB and MaxMB bound the cache_mb setting.
	MinMB, MaxMB = 10, 2000
	// MaxAhead bounds the readahead setting.
	MaxAhead = 10
)

// Defaults for a fresh profile.
func defaultSettings() Settings {
	return Settings{CacheMB: 100, Readahead: 3, Voice: "en-US-AvaNeural"}
}

// Settings is the validated user preferences file.
type Settings struct {
	CacheMB   int    `json:"cache_mb"`
	Readahead int    `json:"readahead"`
	Voice     string `json:"voice"`
}

// cacheBase returns the system cache dir, creating it. Tests and power
// users can point it elsewhere with EPUB_READER_CACHE_DIR.
func cacheBase() (string, error) {
	if override := os.Getenv("EPUB_READER_CACHE_DIR"); override != "" {
		if err := os.MkdirAll(override, 0o755); err != nil {
			return "", err
		}
		return override, nil
	}
	base, err := os.UserCacheDir()
	if err != nil || base == "" {
		home, herr := os.UserHomeDir()
		if herr != nil {
			return "", fmt.Errorf("no cache dir: %v", err)
		}
		base = filepath.Join(home, ".cache")
	}
	dir := filepath.Join(base, App, "tts")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// configFile returns the settings file path, creating its parent. Tests can
// point it at a temp file with EPUB_READER_CONFIG_FILE.
func configFile() (string, error) {
	if override := os.Getenv("EPUB_READER_CONFIG_FILE"); override != "" {
		if err := os.MkdirAll(filepath.Dir(override), 0o755); err != nil {
			return "", err
		}
		return override, nil
	}
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		home, herr := os.UserHomeDir()
		if herr != nil {
			return "", fmt.Errorf("no config dir: %v", err)
		}
		base = filepath.Join(home, ".config")
	}
	dir := filepath.Join(base, App)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "settings.json"), nil
}

// loadSettings returns settings merged over defaults; unknown keys are
// dropped and a corrupt file falls back to defaults.
func loadSettings() Settings {
	out := defaultSettings()
	path, err := configFile()
	if err != nil {
		return out
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	var saved map[string]any
	if err := json.Unmarshal(raw, &saved); err != nil {
		return out
	}
	if v, ok := saved["cache_mb"].(float64); ok && v == float64(int(v)) {
		if iv := int(v); iv >= MinMB && iv <= MaxMB {
			out.CacheMB = iv
		}
	}
	if v, ok := saved["readahead"].(float64); ok && v == float64(int(v)) {
		if iv := int(v); iv >= 0 && iv <= MaxAhead {
			out.Readahead = iv
		}
	}
	if v, ok := saved["voice"].(string); ok && len(v) >= 3 && len(v) <= 80 {
		out.Voice = v
	}
	return out
}

// checkSettings validates a partial update against the stored settings and
// returns the full merged result.
func checkSettings(patch map[string]any) (Settings, error) {
	if patch == nil {
		return Settings{}, fmt.Errorf("settings must be an object")
	}
	out := loadSettings()
	for key, val := range patch {
		switch key {
		case "cache_mb":
			f, ok := val.(float64)
			if !ok || f != float64(int(f)) || int(f) < MinMB || int(f) > MaxMB {
				return Settings{}, fmt.Errorf("cache_mb must be %d-%d", MinMB, MaxMB)
			}
			out.CacheMB = int(f)
		case "readahead":
			f, ok := val.(float64)
			if !ok || f != float64(int(f)) || int(f) < 0 || int(f) > MaxAhead {
				return Settings{}, fmt.Errorf("readahead must be 0-%d", MaxAhead)
			}
			out.Readahead = int(f)
		case "voice":
			s, ok := val.(string)
			if !ok || len(s) < 3 || len(s) > 80 {
				return Settings{}, fmt.Errorf("voice must be a voice name")
			}
			out.Voice = s
		default:
			return Settings{}, fmt.Errorf("unknown setting: %s", key)
		}
	}
	return out, nil
}

// saveSettings persists validated settings and re-applies the cache cap.
func saveSettings(patch map[string]any) (Settings, error) {
	out, err := checkSettings(patch)
	if err != nil {
		return Settings{}, err
	}
	path, err := configFile()
	if err != nil {
		return Settings{}, err
	}
	raw, err := json.MarshalIndent(out, "", " ")
	if err != nil {
		return Settings{}, err
	}
	if err := os.WriteFile(path, append(raw, '\n'), 0o644); err != nil {
		return Settings{}, err
	}
	cacheStore().Trim(int64(out.CacheMB) * 1024 * 1024)
	return out, nil
}
