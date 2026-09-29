//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

func manifestPath() string {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		local = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(local, App, "NativeMessagingHosts", Host+".json")
}

func registryKeys() []string {
	return []string{
		`Software\Google\Chrome\NativeMessagingHosts\` + Host,
		`Software\Chromium\NativeMessagingHosts\` + Host,
		`Software\Microsoft\Edge\NativeMessagingHosts\` + Host,
		`Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\` + Host,
		`Software\Mozilla\NativeMessagingHosts\` + Host,
	}
}

func installRegistry() error {
	path := manifestPath()
	if path == "" {
		return fmt.Errorf("no home directory")
	}
	for _, k := range registryKeys() {
		key, _, err := registry.CreateKey(registry.CURRENT_USER, k, registry.SET_VALUE)
		if err != nil {
			continue
		}
		_ = key.SetStringValue("", path)
		key.Close()
	}
	return nil
}

func uninstallRegistry() error {
	for _, k := range registryKeys() {
		_ = registry.DeleteKey(registry.CURRENT_USER, k)
	}
	return nil
}
