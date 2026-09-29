package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/raffleberry/edge-tts-go/edgetts"
)

// synth runs one edge-tts synthesis: MP3 audio plus word timings in
// milliseconds. It raises an error when the service fails or goes quiet.
func synth(ctx context.Context, voice, text string) ([]byte, []Word, error) {
	comm, err := edgetts.NewCommunicate(text, voice, "+0%", "+0%", "+0Hz", edgetts.WordBoundary, "", 10, 60)
	if err != nil {
		return nil, nil, fmt.Errorf("speech service failed: %v", err)
	}
	var sound []byte
	var words []Word
	err = comm.Stream(ctx, func(chunk edgetts.TTSChunk) error {
		switch chunk.Type {
		case edgetts.ChunkAudio:
			sound = append(sound, chunk.Data...)
		case edgetts.ChunkWordBoundary:
			words = append(words, Word{
				Text:    chunk.Text,
				StartMs: chunk.Offset / 10000,
				EndMs:   (chunk.Offset + chunk.Duration) / 10000,
			})
		}
		return nil
	})
	if err != nil {
		return nil, nil, fmt.Errorf("speech service failed: %v", err)
	}
	if len(sound) == 0 {
		return nil, nil, fmt.Errorf("speech service returned no audio")
	}
	return sound, words, nil
}

// ensure returns audio bytes + word timings for one text, cached. The text
// is whitespace-collapsed first so identical sentences share an entry.
func ensure(ctx context.Context, text, voice string) ([]byte, []Word, error) {
	collapsed := strings.Join(strings.Fields(text), " ")
	if collapsed == "" {
		return nil, nil, fmt.Errorf("empty text")
	}
	if len(collapsed) > MaxText {
		return nil, nil, fmt.Errorf("text too long (max %d chars)", MaxText)
	}
	if voice == "" {
		voice = loadSettings().Voice
	}
	c := cacheStore()
	if audio, words, ok := c.Get(keyFor(voice, collapsed)); ok {
		return audio, words, nil
	}
	audio, words, err := synth(ctx, voice, collapsed)
	if err != nil {
		return nil, nil, err
	}
	c.Put(keyFor(voice, collapsed), audio, words)
	return audio, words, nil
}

// warm pre-generates one sentence; the real request surfaces any error.
func warm(text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	_, _, _ = ensure(ctx, text, "")
}
