package main

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

// Cap retained diagnostic evidence on long-running unattended servers.
// Rotate only the exact native-managed log, never data, database or Library paths.
func rotateNativeSessionLog(path string, maxBytes int64, backups int) error {
	if maxBytes <= 0 || backups < 1 {
		return fmt.Errorf("invalid native log retention policy")
	}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("refusing to open a nonregular native log at %s", filepath.Base(path))
	}
	if info.Size() < maxBytes {
		return nil
	}
	oldest := fmt.Sprintf("%s.%d", path, backups)
	if err := os.Remove(oldest); err != nil && !os.IsNotExist(err) {
		return err
	}
	for index := backups - 1; index >= 1; index-- {
		source := fmt.Sprintf("%s.%d", path, index)
		target := fmt.Sprintf("%s.%d", path, index+1)
		if _, err := os.Lstat(source); err == nil {
			if err := os.Rename(source, target); err != nil {
				return err
			}
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	return os.Rename(path, path+".1")
}

var nativeCredentialURL = regexp.MustCompile(`(?i)\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s@]+@`)
var nativeAuthorizationHeader = regexp.MustCompile(`(?i)\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[^\s,;]+`)
var nativeSecretSetting = regexp.MustCompile(`(?i)\b(DATABASE_URL|DIRECT_DATABASE_URL|POSTGRES_PASSWORD|SESSION_SECRET|CLUSTER_AUTH_SECRET|CLUSTER_SECRET_KEY|CLUSTER_UPDATE_TOKEN|AUTHORIZATION)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)`)

func redactNativeLogLine(line string) string {
	line = nativeCredentialURL.ReplaceAllString(line, "${1}://[REDACTED]@")
	line = nativeAuthorizationHeader.ReplaceAllString(line, "Authorization: [REDACTED]")
	return nativeSecretSetting.ReplaceAllString(line, "${1}=[REDACTED]")
}

const nativeLogMaxLineBytes = 64 * 1024

// The service host's output and control-panel diagnostics share a bounded,
// line-aware writer. It redacts credentials even when a secret crosses OS
// pipe-write boundaries. A single oversized unterminated line cannot grow RAM.
type nativeLineLogWriter struct {
	mu        sync.Mutex
	path      string
	file      *os.File
	size      int64
	maxBytes  int64
	backups   int
	pending   []byte
	truncated bool
	closed    bool
}

func openNativeLineLogWriter(path string, maxBytes int64, backups int) (*nativeLineLogWriter, error) {
	if maxBytes <= nativeLogMaxLineBytes || backups < 1 {
		return nil, fmt.Errorf("invalid native log bounds")
	}
	if err := rotateNativeSessionLog(path, maxBytes, backups); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		return nil, fmt.Errorf("native log target must be a regular file: %v", err)
	}
	return &nativeLineLogWriter{path: path, file: file, size: info.Size(), maxBytes: maxBytes, backups: backups}, nil
}

func (w *nativeLineLogWriter) appendBounded(part []byte) {
	available := nativeLogMaxLineBytes - len(w.pending)
	if len(part) > available {
		w.pending = append(w.pending, part[:available]...)
		w.truncated = true
	} else {
		w.pending = append(w.pending, part...)
	}
}

func (w *nativeLineLogWriter) flushLocked() error {
	text := "[oversized diagnostic line omitted]"
	if !w.truncated {
		text = redactNativeLogLine(string(bytes.TrimSuffix(w.pending, []byte{'\r'})))
	}
	text += "\n"
	if w.size+int64(len(text)) > w.maxBytes {
		if err := w.file.Close(); err != nil {
			return err
		}
		w.file = nil
		if err := rotateNativeSessionLog(w.path, 1, w.backups); err != nil {
			return err
		}
		newFile, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		w.file = newFile
		w.size = 0
	}
	n, err := w.file.Write([]byte(text))
	w.size += int64(n)
	w.pending = w.pending[:0]
	w.truncated = false
	return err
}

func (w *nativeLineLogWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.file == nil {
		return 0, os.ErrClosed
	}
	total := len(p)
	for len(p) > 0 {
		end := bytes.IndexByte(p, '\n')
		if end < 0 {
			w.appendBounded(p)
			break
		}
		w.appendBounded(p[:end])
		if err := w.flushLocked(); err != nil {
			return 0, err
		}
		p = p[end+1:]
	}
	return total, nil
}

func (w *nativeLineLogWriter) Sync() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.file == nil {
		return os.ErrClosed
	}
	return w.file.Sync()
}

func (w *nativeLineLogWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}
	w.closed = true
	if w.file == nil {
		return nil
	}
	var pendingErr error
	if len(w.pending) > 0 || w.truncated {
		pendingErr = w.flushLocked()
	}
	closeErr := w.file.Close()
	w.file = nil
	if pendingErr != nil {
		return pendingErr
	}
	return closeErr
}

func scanBoundedNativeLines(reader io.Reader, emit func(string)) error {
	buffered := bufio.NewReaderSize(reader, 32*1024)
	pending := make([]byte, 0, 32*1024)
	truncated := false
	for {
		part, err := buffered.ReadSlice('\n')
		if err == nil {
			part = part[:len(part)-1]
		}
		available := nativeLogMaxLineBytes - len(pending)
		if len(part) > available {
			pending = append(pending, part[:available]...)
			truncated = true
		} else {
			pending = append(pending, part...)
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		if len(pending) > 0 || truncated || err == nil {
			if truncated {
				emit("[oversized diagnostic line omitted]")
			} else {
				emit(string(bytes.TrimSuffix(pending, []byte{'\r'})))
			}
		}
		pending = pending[:0]
		truncated = false
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}
