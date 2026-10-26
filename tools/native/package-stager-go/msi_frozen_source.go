package main

// A verified signed stage is not sufficient if the MSI bytes can be replaced
// between verification and CreateProcess. The Windows constructor opens the
// actual MSI with FILE_SHARE_READ only (no write/delete sharing), keeps that
// handle alive through msiexec, and this shared verifier checks the bytes and
// pathname identity from that SAME open handle before process resume.
// Nothing here authorizes repair, reinstall, upgrade, or a health claim.
import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
)

type msiFrozenSource struct {
	path   string
	sha256 string
	file   *os.File
}

func (s *msiFrozenSource) close() error {
	if s == nil || s.file == nil {
		return nil
	}
	err := s.file.Close()
	s.file = nil
	return err
}

func (s *msiFrozenSource) verify() error {
	if s == nil || s.file == nil || !validDigest(s.sha256) || s.path == "" {
		return errors.New("MSI immutable source handle or digest unavailable")
	}
	if err := directoryNoLinks(filepath.Dir(s.path)); err != nil {
		return errors.New("MSI source parent is no longer trusted")
	}
	opened, err := s.file.Stat()
	if err != nil || !opened.Mode().IsRegular() || opened.Size() < 8 || opened.Size() > maxExpandedSize {
		return errors.New("MSI immutable handle no longer represents a bounded regular file")
	}
	pathInfo, err := os.Lstat(s.path)
	if err != nil || !pathInfo.Mode().IsRegular() || !os.SameFile(opened, pathInfo) ||
		opened.Size() != pathInfo.Size() || !opened.ModTime().Equal(pathInfo.ModTime()) {
		return errors.New("MSI source path no longer refers to the held signed file")
	}
	if _, err := s.file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(s.file, maxExpandedSize+1))
	if err != nil || n != opened.Size() || hex.EncodeToString(h.Sum(nil)) != s.sha256 {
		return errors.New("held MSI source digest differs from the signed manifest")
	}
	finalInfo, err := s.file.Stat()
	if err != nil || !os.SameFile(opened, finalInfo) || opened.Size() != finalInfo.Size() ||
		!opened.ModTime().Equal(finalInfo.ModTime()) {
		return errors.New("MSI source changed while verifying held handle")
	}
	finalPath, err := os.Lstat(s.path)
	if err != nil || !finalPath.Mode().IsRegular() || !os.SameFile(finalInfo, finalPath) ||
		finalInfo.Size() != finalPath.Size() || !finalInfo.ModTime().Equal(finalPath.ModTime()) {
		return errors.New("MSI path replaced during held source verification")
	}
	return nil
}
