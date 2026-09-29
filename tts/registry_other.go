//go:build !windows

package main

func installRegistry() error   { return nil }
func uninstallRegistry() error { return nil }
