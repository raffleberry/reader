package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"sync"
)

// trayIconPNG is a small built-in book glyph so the binary needs no assets.
var (
	iconOnce sync.Once
	iconPNG  []byte
)

func trayIcon() []byte {
	iconOnce.Do(func() {
		const s = 32
		img := image.NewRGBA(image.Rect(0, 0, s, s))
		bg := color.RGBA{0x2b, 0x2b, 0x2b, 0xff}
		page := color.RGBA{0xf5, 0xf0, 0xe1, 0xff}
		accent := color.RGBA{0xa6, 0xe2, 0x2e, 0xff}
		for y := 0; y < s; y++ {
			for x := 0; x < s; x++ {
				img.Set(x, y, bg)
			}
		}
		// open book: two pages + spine + underline accent
		for y := 7; y < 23; y++ {
			for x := 6; x < 26; x++ {
				if x == 15 || x == 16 {
					img.Set(x, y, accent)
					continue
				}
				img.Set(x, y, page)
			}
		}
		for x := 6; x < 26; x++ {
			img.Set(x, 24, accent)
			img.Set(x, 25, accent)
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			return
		}
		iconPNG = buf.Bytes()
	})
	return iconPNG
}
