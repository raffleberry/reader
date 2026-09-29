package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"

	"github.com/gogpu/systray"
)

// runTray shows the tray icon, ensures the native-messaging manifest is
// installed (first run), and blocks on the platform message loop.
func runTray(chromeIDs []string) int {
	first := !installedAlready()
	if _, err := installHost(chromeIDs); err != nil {
		fmt.Fprintf(os.Stderr, "install native host: %v\n", err)
	}

	tray := systray.New()
	menu := systray.NewMenu()
	status := menu.Add("EPUB Reader "+Version, func() {})
	status.SetDisabled(true)
	menu.AddSeparator()
	menu.Add("Reinstall speech host", func() {
		if _, err := installHost(chromeIDs); err != nil {
			tray.ShowNotification("EPUB Reader", "Reinstall failed: "+err.Error())
			return
		}
		tray.ShowNotification("EPUB Reader", "Speech host installed.")
	})
	menu.Add("Clear speech cache", func() {
		cacheStore().Clear()
		tray.ShowNotification("EPUB Reader", "Speech cache cleared.")
	})
	menu.Add("Open speech cache folder", func() {
		base, err := cacheBase()
		if err != nil {
			tray.ShowNotification("EPUB Reader", "No cache folder: "+err.Error())
			return
		}
		if err := openFolder(base); err != nil {
			tray.ShowNotification("EPUB Reader", "Could not open folder: "+err.Error())
		}
	})
	menu.AddSeparator()
	menu.Add("Quit", func() {
		tray.Remove()
		os.Exit(0)
	})

	tray.SetIcon(trayIcon()).
		SetTooltip("EPUB Reader speech").
		SetMenu(menu)
	tray.OnClick(func() {
		s := loadSettings()
		entries, _ := cacheStore().Stats()
		tray.ShowNotification("EPUB Reader",
			fmt.Sprintf("Speech ready (voice %s, %d cached).", s.Voice, entries))
	})
	tray.Show()
	if first {
		tray.ShowNotification("EPUB Reader",
			"Installed. The extension will start speech on its own — nothing left to run.")
	}
	if err := tray.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "tray: %v\n", err)
		return 1
	}
	return 0
}

func openFolder(dir string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", dir)
	case "windows":
		cmd = exec.Command("explorer", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Start()
}
