package main

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"
)

// Native-messaging wire protocol (Chrome + Firefox, stdin/stdout):
// each message is a 4-byte little-endian length followed by JSON.
//
// Request:  {"id":1,"method":"speak","params":{"text":"..."}}
// Response: {"id":1,"ok":true,"result":{...}} or {"id":1,"ok":false,"error":"..."}
//
// Methods mirror the old HTTP routes: ping, getSettings, putSettings,
// cacheStats, clearCache, speak, ttsWords, prefetch.

// Request is one host call from the extension.
type Request struct {
	ID     int64          `json:"id"`
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

// Response is one host answer. Exactly one of Result/Error is set.
type Response struct {
	ID     int64  `json:"id"`
	Ok     bool   `json:"ok"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

func readMessage(r io.Reader) ([]byte, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	n := binary.LittleEndian.Uint32(hdr[:])
	if n > 64<<20 { // 64 MB sanity cap: one sentence is kilobytes
		return nil, fmt.Errorf("message too large (%d bytes)", n)
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func writeMessage(w io.Writer, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	var hdr [4]byte
	binary.LittleEndian.PutUint32(hdr[:], uint32(len(raw)))
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	_, err = w.Write(raw)
	return err
}

func strParam(params map[string]any, key string) string {
	if params == nil {
		return ""
	}
	s, _ := params[key].(string)
	return s
}

// dispatch runs one request. It is the whole API surface the extension sees.
func dispatch(ctx context.Context, req Request) (any, error) {
	switch req.Method {
	case "ping":
		return map[string]any{"ok": true, "version": Version}, nil
	case "getSettings":
		return loadSettings(), nil
	case "putSettings":
		params := req.Params
		if params == nil {
			params = map[string]any{}
		}
		return saveSettings(params)
	case "cacheStats":
		entries, bytes := cacheStore().Stats()
		return map[string]any{"entries": entries, "bytes": bytes}, nil
	case "clearCache":
		cacheStore().Clear()
		return map[string]any{"ok": true}, nil
	case "speak":
		text := strParam(req.Params, "text")
		voice := strParam(req.Params, "voice")
		audio, words, err := ensure(ctx, text, voice)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"audio": base64.StdEncoding.EncodeToString(audio),
			"words": words,
		}, nil
	case "ttsWords":
		text := strParam(req.Params, "text")
		voice := strParam(req.Params, "voice")
		_, words, err := ensure(ctx, text, voice)
		if err != nil {
			return nil, err
		}
		return map[string]any{"words": words}, nil
	case "prefetch":
		var texts []any
		if req.Params != nil {
			texts, _ = req.Params["texts"].([]any)
		}
		n := 0
		for _, t := range texts {
			if n >= MaxPrefetch {
				break
			}
			s, ok := t.(string)
			if !ok || s == "" {
				continue
			}
			n++
			go warm(s)
		}
		return map[string]any{"ok": true}, nil
	default:
		return nil, fmt.Errorf("unknown method: %s", req.Method)
	}
}

// serveNative loops on stdin/stdout until the browser hangs up (EOF), which
// is the autoclose: one host process per extension session, no lingering.
func serveNative() int {
	stdin := os.Stdin
	stdout := os.Stdout
	for {
		raw, err := readMessage(stdin)
		if err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return 0
			}
			return 0 // browser went away; exit quietly
		}
		var req Request
		if err := json.Unmarshal(raw, &req); err != nil {
			_ = writeMessage(stdout, Response{Ok: false, Error: "body must be JSON"})
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
		result, err := dispatch(ctx, req)
		cancel()
		if err != nil {
			_ = writeMessage(stdout, Response{ID: req.ID, Ok: false, Error: err.Error()})
			continue
		}
		_ = writeMessage(stdout, Response{ID: req.ID, Ok: true, Result: result})
	}
}
