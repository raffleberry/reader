package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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

// binaryName is the on-disk file name of the installed helper.
func binaryName() string {
	if runtime.GOOS == "windows" {
		return App + ".exe"
	}
	return App
}

// installedBinaryPath is where --install keeps the helper:
// os.UserConfigDir / Vendor / App / binaryName. Manifests point here so
// the user cannot break speech by deleting the download folder. Tests can
// redirect the whole config dir with EPUB_READER_CONFIG_DIR.
func installedBinaryPath() (string, error) {
	dir, err := appConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, binaryName()), nil
}

// installBinaryFrom copies src to the installed location, always
// overwriting (that is the update path). Identical content skips the
// write; the copy is atomic (temp file + rename) with the executable bit
// set. Same-path source is a no-op.
func installBinaryFrom(src string) (string, error) {
	dest, err := installedBinaryPath()
	if err != nil {
		return "", err
	}
	if filepath.Clean(src) == filepath.Clean(dest) {
		return dest, nil
	}
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	raw, err := io.ReadAll(in)
	if err != nil {
		return "", err
	}
	if cur, rerr := os.ReadFile(dest); rerr == nil && bytes.Equal(cur, raw) {
		return dest, nil // already current; nothing to do
	}
	tmp, err := os.CreateTemp(filepath.Dir(dest), ".epub-reader-bin-*")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return "", err
	}
	if err := tmp.Chmod(0o755); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return "", err
	}
	if err := os.Rename(tmpName, dest); err != nil {
		// Windows cannot rename over a running exe: drop the old file
		// first, then retry once before giving up.
		_ = os.Remove(dest)
		if rerr := os.Rename(tmpName, dest); rerr != nil {
			os.Remove(tmpName)
			return "", fmt.Errorf("replace %s (quit the running helper first): %v", dest, rerr)
		}
	}
	_ = os.Chmod(dest, 0o755)
	return dest, nil
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

// manifestOutcome is one manifest write attempt, for the terminal report.
type manifestOutcome struct {
	dir string
	// wrote reports the file was created or updated.
	wrote bool
	// skipped explains why nothing was written: "unchanged", or the
	// error text when the directory was unusable.
	skipped string
}

// installHostReport copies the running binary to the installed location
// (overwriting: that is the update path) and writes the manifest
// everywhere browsers look and, on Windows, points the registry at it.
// It reports each step so a terminal launch can show what happened.
func installHostReport(chromeIDs []string) (binary string, outcomes []manifestOutcome, changed bool, err error) {
	src, err := exePath()
	if err != nil {
		return "", nil, false, err
	}
	exe, err := installBinaryFrom(src)
	if err != nil {
		return "", nil, false, err
	}
	raw, err := manifestBytes(exe, chromeIDs)
	if err != nil {
		return exe, nil, false, err
	}
	filename := Host + ".json"
	for _, dir := range hostDirs() {
		out := manifestOutcome{dir: dir}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			out.skipped = err.Error() // a missing profile root is not fatal
			outcomes = append(outcomes, out)
			continue
		}
		target := filepath.Join(dir, filename)
		cur, rerr := os.ReadFile(target)
		if rerr == nil && string(cur) == string(raw) {
			out.skipped = "unchanged"
			outcomes = append(outcomes, out)
			continue
		}
		if werr := os.WriteFile(target, raw, 0o644); werr != nil {
			out.skipped = werr.Error()
			outcomes = append(outcomes, out)
			continue
		}
		out.wrote = true
		changed = true
		outcomes = append(outcomes, out)
	}
	if runtime.GOOS == "windows" {
		if werr := installRegistry(); werr != nil {
			return exe, outcomes, changed, werr
		}
		changed = true
	}
	return exe, outcomes, changed, nil
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
