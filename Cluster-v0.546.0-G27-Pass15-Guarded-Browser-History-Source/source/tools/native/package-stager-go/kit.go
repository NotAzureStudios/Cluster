package main

// Import a complete renderer-generated staging kit without first unpacking
// untrusted archive members onto the filesystem. The caller still MUST provide
// a signing-key pin from independent, workstation-controlled configuration.
import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
)

const maxKitSize int64 = maxArtifactSize + 64*1024

func readStagingKit(path string) (archive, manifestBytes, signature, publicKey []byte, err error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maxKitSize {
		return nil, nil, nil, nil, errors.New("unsafe or oversized staging kit")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if int64(len(content)) > maxKitSize {
		return nil, nil, nil, nil, errors.New("oversized staging kit")
	}
	reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if len(reader.File) != 5 {
		return nil, nil, nil, nil, errors.New("staging kit must have exactly five entries")
	}
	limits := map[string]int64{
		"release.zip":    maxArtifactSize,
		"manifest.json":  4096,
		"signature.txt":  4096,
		"public-key.pem": 4096,
		"README.txt":     8192,
	}
	extracted := make(map[string][]byte)
	for _, member := range reader.File {
		limit, ok := limits[member.Name]
		if !ok || member.Method != zip.Store || !member.Mode().IsRegular() || member.UncompressedSize64 > uint64(limit) || member.Flags&1 != 0 {
			return nil, nil, nil, nil, fmt.Errorf("unapproved staging kit member %q", member.Name)
		}
		if _, duplicate := extracted[member.Name]; duplicate {
			return nil, nil, nil, nil, errors.New("duplicate staging kit member")
		}
		body, err := member.Open()
		if err != nil {
			return nil, nil, nil, nil, err
		}
		data, readErr := io.ReadAll(io.LimitReader(body, limit+1))
		closeErr := body.Close()
		if readErr != nil || closeErr != nil || int64(len(data)) > limit || len(data) == 0 {
			return nil, nil, nil, nil, errors.New("corrupt or oversized staging kit member")
		}
		extracted[member.Name] = data
	}
	return extracted["release.zip"], extracted["manifest.json"], extracted["signature.txt"], extracted["public-key.pem"], nil
}
