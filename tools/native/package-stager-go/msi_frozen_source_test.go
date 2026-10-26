package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func frozenFixture(t *testing.T) (*msiFrozenSource, string) {
	t.Helper()
	file := filepath.Join(t.TempDir(), "studio.msi")
	data := append([]byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}, []byte("demo signed content")...)
	if err := os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(data)
	f, err := os.Open(file)
	if err != nil {
		t.Fatal(err)
	}
	return &msiFrozenSource{path: file, sha256: hex.EncodeToString(h[:]), file: f}, file
}
func TestMSIFrozenSourceRequiresHeldMatchingBytesAndPath(t *testing.T) {
	s, _ := frozenFixture(t)
	defer s.close()
	if err := s.verify(); err != nil {
		t.Fatal(err)
	}
	if err := s.verify(); err != nil {
		t.Fatalf("repeated verification failed: %v", err)
	}
	s.sha256 = strings.Repeat("b", 64)
	if err := s.verify(); err == nil {
		t.Fatal("wrong signed hash accepted")
	}
	s.sha256 = "not-a-digest"
	if err := s.verify(); err == nil {
		t.Fatal("malformed hash accepted")
	}
}
func TestMSIFrozenSourceRejectsReplacementAndMutation(t *testing.T) {
	s, path := frozenFixture(t)
	defer s.close()
	if err := os.Rename(path, path+".old"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("new bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.verify(); err == nil {
		t.Fatal("path swapped while held was accepted")
	}
	s.path = path + ".old"
	if err := s.verify(); err != nil {
		t.Fatalf("legitimate held inode not recognized: %v", err)
	}
	if err := os.WriteFile(s.path, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.verify(); err == nil {
		t.Fatal("held inode content mutation accepted")
	}
}
func TestMSIFrozenSourceRefusesSymlinksMissingAndClosedHandles(t *testing.T) {
	s, path := frozenFixture(t)
	defer s.close()
	alias := path + ".link"
	if err := os.Symlink(path, alias); err == nil {
		s.path = alias
		if err := s.verify(); err == nil {
			t.Fatal("symlink alias accepted")
		}
	}
	s.path = path
	if err := s.close(); err != nil {
		t.Fatal(err)
	}
	if err := s.verify(); err == nil {
		t.Fatal("closed handle accepted")
	}
	if err := s.close(); err != nil {
		t.Fatal("idempotent close failed")
	}
}
func TestMSIFrozenSourceRefusesMissingDirectoryAndOversize(t *testing.T) {
	s, path := frozenFixture(t)
	defer s.close()
	s.path = filepath.Join(filepath.Dir(path), "missing", "studio.msi")
	if err := s.verify(); err == nil {
		t.Fatal("missing parent accepted")
	}
	s.path = path
	if err := os.Truncate(path, maxExpandedSize+1); err != nil {
		t.Fatal(err)
	}
	if err := s.verify(); err == nil {
		t.Fatal("oversized held file accepted")
	}
}
