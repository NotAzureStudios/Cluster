package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// EDB publishes the complete PostgreSQL Windows binary distribution as a ZIP.
// This avoids launching its Windows installer, which requests elevation even
// when Cluster asks it to perform an extract-only operation.
const postgresBinariesSHA256 = "e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2"

func verifySHA256(filename, expected string) error {
	file, err := os.Open(filename)
	if err != nil {
		return err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return err
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if !strings.EqualFold(actual, expected) {
		return fmt.Errorf("SHA-256 mismatch for %s: expected %s, got %s", filepath.Base(filename), expected, actual)
	}
	return nil
}

// extractPostgresBinaries unpacks pgsql/* to the dedicated PostgreSQL runtime
// staging directory. No elevated subprocess or OS-wide install is involved.
// Reject malformed, unexpected, or unsafe archive members before writing any.
func extractPostgresBinaries(archive, destination string) error {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer reader.Close()
	required := map[string]bool{"bin/postgres.exe": false, "bin/pg_ctl.exe": false, "bin/initdb.exe": false, "bin/psql.exe": false, "bin/createdb.exe": false}
	seen := make(map[string]bool, len(reader.File))
	totalBytes := uint64(0)
	const maxFiles = 75000
	const maxTotalBytes = uint64(6) * 1024 * 1024 * 1024
	if len(reader.File) > maxFiles {
		return fmt.Errorf("PostgreSQL archive has too many files (%d)", len(reader.File))
	}
	for _, entry := range reader.File {
		name := entry.Name
		if strings.ContainsAny(name, "\\:") || strings.HasPrefix(name, "/") || strings.ContainsRune(name, '\x00') {
			return fmt.Errorf("unsafe PostgreSQL archive path: %q", name)
		}
		normalized := path.Clean(name)
		if normalized != name && normalized+"/" != name {
			return fmt.Errorf("non-canonical PostgreSQL archive path: %q", name)
		}
		if !strings.HasPrefix(name, "pgsql/") {
			return fmt.Errorf("unexpected PostgreSQL archive member: %q", name)
		}
		relative := strings.TrimPrefix(name, "pgsql/")
		if relative == "" {
			continue
		}
		if relative == ".." || strings.HasPrefix(relative, "../") || strings.Contains(relative, "/../") {
			return fmt.Errorf("PostgreSQL archive path traversal: %q", name)
		}
		key := strings.ToLower(strings.TrimSuffix(relative, "/"))
		if seen[key] {
			return fmt.Errorf("duplicate PostgreSQL archive path: %q", name)
		}
		seen[key] = true
		if entry.Mode()&os.ModeSymlink != 0 || !entry.Mode().IsRegular() && !entry.FileInfo().IsDir() {
			return fmt.Errorf("unsupported PostgreSQL archive object: %q", name)
		}
		if !entry.FileInfo().IsDir() {
			totalBytes += entry.UncompressedSize64
			if totalBytes > maxTotalBytes {
				return fmt.Errorf("PostgreSQL archive expands beyond safe size limit")
			}
			if _, ok := required[key]; ok {
				required[key] = true
			}
		}
	}
	for item, present := range required {
		if !present {
			return fmt.Errorf("PostgreSQL archive missing %s", item)
		}
	}
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}
	for _, entry := range reader.File {
		relative := strings.TrimPrefix(entry.Name, "pgsql/")
		if relative == "" {
			continue
		}
		target := filepath.Join(destination, filepath.FromSlash(relative))
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		input, err := entry.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		closeErr := output.Close()
		input.Close()
		if copyErr != nil {
			return fmt.Errorf("extract %s: %w", relative, copyErr)
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}
