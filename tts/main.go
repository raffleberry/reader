package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"
	"strings"
)

// idList collects repeatable --extension-id flags.
type idList []string

func (l *idList) String() string     { return strings.Join(*l, ",") }
func (l *idList) Set(v string) error { *l = append(*l, v); return nil }

func chromeIDsFromEnv() []string {
	raw := os.Getenv("EPUB_READER_EXTENSION_IDS")
	if raw == "" {
		return nil
	}
	var out []string
	for _, id := range strings.Split(raw, ",") {
		if id = strings.TrimSpace(id); id != "" {
			out = append(out, id)
		}
	}
	return out
}

// stdinIsPipe reports whether stdin is a pipe (browser-launched) rather
// than a terminal or null device (user-launched).
func stdinIsPipe() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice == 0
}

func main() {
	os.Exit(run())
}

func run() int {
	// The tray is gone: a removed flag gets a plain answer, not a
	// usage dump. This must run before flag.Parse, which would exit
	// on the unknown flag first.
	for _, arg := range os.Args[1:] {
		if arg == "--tray" || arg == "-tray" || strings.HasPrefix(arg, "--tray=") {
			fmt.Fprintln(os.Stderr, "EPUB Reader no longer has a tray mode; just run it and it installs itself.")
			return 1
		}
	}
	var (
		nativeMode bool
		install    bool
		uninstall  bool
		showVer    bool
		ids        idList
	)
	flag.BoolVar(&nativeMode, "native-host", false, "serve one native-messaging session on stdin/stdout")
	flag.BoolVar(&install, "install", false, "install the native-messaging host and exit")
	flag.BoolVar(&uninstall, "uninstall", false, "remove the native-messaging host and exit")
	flag.BoolVar(&showVer, "version", false, "print version and exit")
	flag.Var(&ids, "extension-id", "Chrome extension ID to authorize (repeatable)")
	flag.Parse()

	if showVer {
		fmt.Println(Version)
		return 0
	}
	chromeIDs := append(chromeIDsFromEnv(), ids...)

	switch {
	case install:
		return runInstall(chromeIDs, false)
	case uninstall:
		uninstallHost()
		fmt.Println("EPUB Reader speech host removed (installed binary left in place).")
		return 0
	case nativeMode:
		return serveNative()
	default:
		if stdinIsPipe() {
			return serveNative()
		}
		// Launched by the user: install with a running commentary,
		// then exit. Nothing stays running; the browser starts the
		// helper itself whenever speech is needed.
		return runInstall(chromeIDs, true)
	}
}

// runInstall installs the host and narrates each step on stdout.
// pause asks for Enter before returning, so a double-clicked window on
// Windows stays readable; explicit --install never pauses (scriptable).
func runInstall(chromeIDs []string, pause bool) int {
	fmt.Println("EPUB Reader speech host — installing...")
	exe, outcomes, changed, err := installHostReport(chromeIDs)
	if err != nil {
		fmt.Fprintf(os.Stderr, "install failed: %v\n", err)
		pauseBeforeExit(pause)
		return 1
	}
	fmt.Printf("  binary: %s\n", exe)
	for _, out := range outcomes {
		switch {
		case out.wrote:
			fmt.Printf("  manifest: %s (written)\n", out.dir)
		case out.skipped == "unchanged":
			fmt.Printf("  manifest: %s (unchanged)\n", out.dir)
		default:
			fmt.Printf("  manifest: %s (skipped: %s)\n", out.dir, out.skipped)
		}
	}
	if changed {
		fmt.Println("Installed. The extension starts speech on its own; nothing is left running.")
	} else {
		fmt.Println("Already installed. The extension starts speech on its own; nothing is left running.")
	}
	pauseBeforeExit(pause)
	return 0
}

// pauseBeforeExit waits for Enter on a Windows console so a double-clicked
// launch stays on screen long enough to read. Elsewhere the terminal
// persists on its own, and scripts must never block.
func pauseBeforeExit(pause bool) {
	if !pause || runtime.GOOS != "windows" || !stdoutIsConsole() {
		return
	}
	fmt.Print("Press Enter to close...")
	var line [1]byte
	_, _ = os.Stdin.Read(line[:])
}

// stdoutIsConsole reports whether stdout is an interactive console.
func stdoutIsConsole() bool {
	fi, err := os.Stdout.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}
