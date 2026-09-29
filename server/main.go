package main

import (
	"flag"
	"fmt"
	"os"
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
	var (
		nativeMode bool
		trayMode   bool
		install    bool
		uninstall  bool
		showVer    bool
		ids        idList
	)
	flag.BoolVar(&nativeMode, "native-host", false, "serve one native-messaging session on stdin/stdout")
	flag.BoolVar(&trayMode, "tray", false, "force tray mode")
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
		changed, err := installHost(chromeIDs)
		if err != nil {
			fmt.Fprintf(os.Stderr, "install: %v\n", err)
			return 1
		}
		if changed {
			fmt.Println("EPUB Reader speech host installed.")
		} else {
			fmt.Println("EPUB Reader speech host already installed.")
		}
		fmt.Println("The extension starts it on its own; nothing is left running.")
		return 0
	case uninstall:
		uninstallHost()
		fmt.Println("EPUB Reader speech host removed.")
		return 0
	case nativeMode:
		return serveNative()
	case trayMode:
		return runTray(chromeIDs)
	default:
		if stdinIsPipe() {
			return serveNative()
		}
		return runTray(chromeIDs)
	}
}
