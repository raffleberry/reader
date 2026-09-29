package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Firefox's stable add-on ID; Chrome/Edge IDs come from --extension-id.
const firefoxID = "reader@raffleberry.github.io"

// manifest is the native-messaging host file both browsers read.
type manifest struct {
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	Path              string   `json:"path"`
	Type              string   `json:"type"`
	AllowedOrigins    []string `json:"allowed_origins,omitempty"`
	AllowedExtensions []string `json:"allowed_extensions,omitempty"`
}

func manifestBytes(exe string, chromeIDs []string) ([]byte, error) {
	m := manifest{
		Name:              Host,
		Description:       "EPUB Reader speech host",
		Path:              exe,
		Type:              "stdio",
		AllowedExtensions: []string{firefoxID},
	}
	for _, id := range chromeIDs {
		id = strings.TrimSpace(strings.Trim(id, "/"))
		if id == "" {
			continue
		}
		m.AllowedOrigins = append(m.AllowedOrigins, "chrome-extension://"+id+"/")
	}
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}

func exePath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Clean(exe), nil
}

// hostDirs lists every native-messaging directory to write on this OS.
func hostDirs() []string {
	home, _ := os.UserHomeDir()
	var dirs []string
	switch runtime.GOOS {
	case "darwin":
		support := filepath.Join(home, "Library", "Application Support")
		dirs = []string{
			filepath.Join(support, "Google", "Chrome", "NativeMessagingHosts"),
			filepath.Join(support, "Chromium", "NativeMessagingHosts"),
			filepath.Join(support, "Microsoft Edge", "NativeMessagingHosts"),
			filepath.Join(support, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
			filepath.Join(support, "Mozilla", "NativeMessagingHosts"),
		}
	case "windows":
		local := os.Getenv("LOCALAPPDATA")
		if local == "" {
			local = filepath.Join(home, "AppData", "Local")
		}
		dirs = []string{filepath.Join(local, App, "NativeMessagingHosts")}
	default: // linux and the rest: XDG layout
		config := os.Getenv("XDG_CONFIG_HOME")
		if config == "" {
			config = filepath.Join(home, ".config")
		}
		dirs = []string{
			filepath.Join(config, "google-chrome", "NativeMessagingHosts"),
			filepath.Join(config, "chromium", "NativeMessagingHosts"),
			filepath.Join(config, "microsoft-edge", "NativeMessagingHosts"),
			filepath.Join(config, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
		}
		mozHome := os.Getenv("MOZILLA_HOME")
		if mozHome == "" {
			mozHome = filepath.Join(home, ".mozilla")
		}
		dirs = append(dirs, filepath.Join(mozHome, "native-messaging-hosts"))
	}
	return dirs
}

// installHost writes the manifest everywhere browsers look and, on Windows,
// points the registry at it. It reports whether anything changed.
func installHost(chromeIDs []string) (changed bool, err error) {
	exe, err := exePath()
	if err != nil {
		return false, err
	}
	raw, err := manifestBytes(exe, chromeIDs)
	if err != nil {
		return false, err
	}
	filename := Host + ".json"
	for _, dir := range hostDirs() {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			continue // a missing profile root is not fatal
		}
		target := filepath.Join(dir, filename)
		cur, rerr := os.ReadFile(target)
		if rerr == nil && string(cur) == string(raw) {
			continue
		}
		if werr := os.WriteFile(target, raw, 0o644); werr != nil {
			continue
		}
		changed = true
	}
	if runtime.GOOS == "windows" {
		if werr := installRegistry(); werr != nil {
			return changed, werr
		}
		changed = true
	}
	return changed, nil
}

// uninstallHost removes every manifest this tool may have written.
func uninstallHost() {
	filename := Host + ".json"
	for _, dir := range hostDirs() {
		target := filepath.Join(dir, filename)
		cur, err := os.ReadFile(target)
		if err != nil {
			continue
		}
		var m manifest
		if json.Unmarshal(cur, &m) != nil {
			continue
		}
		if m.Name != Host {
			continue
		}
		_ = os.Remove(target)
	}
	if runtime.GOOS == "windows" {
		_ = uninstallRegistry()
	}
}

// installedAlready reports whether at least one manifest points at this exe.
func installedAlready() bool {
	exe, err := exePath()
	if err != nil {
		return false
	}
	filename := Host + ".json"
	for _, dir := range hostDirs() {
		raw, err := os.ReadFile(filepath.Join(dir, filename))
		if err != nil {
			continue
		}
		var m manifest
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		if m.Name == Host && filepath.Clean(m.Path) == exe {
			return true
		}
	}
	return false
}

func manifestPreview(chromeIDs []string) string {
	exe, err := exePath()
	if err != nil {
		exe = "<exe>"
	}
	raw, err := manifestBytes(exe, chromeIDs)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%s\n  in:\n  - %s", raw, strings.Join(hostDirs(), "\n  - "))
}
