package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// This intentionally does not depend on Node or PostgreSQL: they may be
// unavailable when Windows SCM is trying to recover from a bad network change.
const networkDeploymentSuffix = ".network-deployment.json"
const networkPublicationSuffix = ".publication-journal.json"
const maxDeploymentBytes = 2*4*1024*1024 + 16*1024

type deploymentSnapshot struct {
	Present bool    `json:"present"`
	Bytes   *string `json:"bytes"`
	SHA256  *string `json:"sha256"`
}
type networkDeployment struct {
	Schema    int                `json:"schema"`
	ID        string             `json:"id"`
	State     string             `json:"state"`
	CreatedAt string             `json:"createdAt"`
	Before    deploymentSnapshot `json:"before"`
	After     deploymentSnapshot `json:"after"`
}

func nativeDeploymentConfigPath(root string) string {
	if path := strings.TrimSpace(os.Getenv("CLUSTER_CONFIG_FILE")); path != "" {
		return path
	}
	return filepath.Join(root, "data", "system", "config", "cluster.config.json")
}
func snapshotText(s deploymentSnapshot) (string, error) {
	if !s.Present {
		if s.Bytes != nil || s.SHA256 != nil {
			return "", fmt.Errorf("missing snapshot has data")
		}
		return "", nil
	}
	if s.Bytes == nil || s.SHA256 == nil || len(*s.Bytes) > 4*1024*1024 {
		return "", fmt.Errorf("invalid deployment snapshot")
	}
	digest := sha256.Sum256([]byte(*s.Bytes))
	if hex.EncodeToString(digest[:]) != *s.SHA256 {
		return "", fmt.Errorf("deployment snapshot hash mismatch")
	}
	return *s.Bytes, nil
}
func readNativeDeployment(config string) (*networkDeployment, error) {
	raw, err := os.ReadFile(config + networkDeploymentSuffix)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(raw) > maxDeploymentBytes {
		return nil, fmt.Errorf("deployment record exceeds size limit")
	}
	var p networkDeployment
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("invalid deployment record: %w", err)
	}
	if err = dec.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("network deployment record has trailing content")
	}
	if p.Schema != 1 || (p.State != "staged" && p.State != "verified" && p.State != "rolled_back") || len(p.ID) != 36 || strings.Count(p.ID, "-") != 4 {
		return nil, fmt.Errorf("invalid deployment identity/state")
	}
	if _, err = time.Parse(time.RFC3339Nano, p.CreatedAt); err != nil {
		return nil, fmt.Errorf("invalid deployment timestamp")
	}
	if _, err = snapshotText(p.Before); err != nil {
		return nil, err
	}
	if !p.After.Present {
		return nil, fmt.Errorf("candidate snapshot missing")
	}
	if _, err = snapshotText(p.After); err != nil {
		return nil, err
	}
	return &p, nil
}
func deploymentJournalExists(config string) (bool, error) {
	_, err := os.Stat(config + networkPublicationSuffix)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return false, err
}

// Never restore a syntactically invalid or noncanonical boot configuration.
// A local administrator must recover unsafe records explicitly rather than
// having the native service overwrite a valid current configuration.
func validatePreviousBootSnapshot(content string) error {
	var parsed struct {
		Version      int            `json:"version"`
		SecretPolicy string         `json:"secretPolicy"`
		Settings     map[string]any `json:"settings"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return fmt.Errorf("previous boot config is malformed: %w", err)
	}
	if parsed.Version != 2 || parsed.SecretPolicy != "server-managed-only" || parsed.Settings == nil {
		return fmt.Errorf("previous boot config does not use the canonical schema")
	}
	if _, err := parseNativeNetwork(parsed.Settings); err != nil {
		return fmt.Errorf("previous network settings invalid: %w", err)
	}
	return nil
}
func matchSnapshot(raw []byte, exists bool, s deploymentSnapshot) bool {
	if !exists {
		return !s.Present
	}
	if !s.Present || s.Bytes == nil {
		return false
	}
	digest := sha256.Sum256(raw)
	return s.SHA256 != nil && hex.EncodeToString(digest[:]) == *s.SHA256 && string(raw) == *s.Bytes
}
func readDeploymentCurrent(config string) ([]byte, bool, error) {
	raw, err := os.ReadFile(config)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	return raw, err == nil, err
}
func syncWriteNativeFile(dest string, content []byte) error {
	name := fmt.Sprintf("%s.tmp-%d-%d", dest, os.Getpid(), time.Now().UnixNano())
	f, err := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer os.Remove(name)
	if _, err = f.Write(content); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(name, dest); err != nil {
		return err
	}
	return os.Chmod(dest, 0600)
}
func writeDeploymentState(config string, p *networkDeployment, state string) error {
	candidate := *p
	candidate.State = state
	raw, err := json.Marshal(candidate)
	if err != nil {
		return err
	}
	if err = syncWriteNativeFile(config+networkDeploymentSuffix, append(raw, '\n')); err != nil {
		return err
	}
	*p = candidate
	return nil
}
func verifyNativeNetworkDeployment(root string) error {
	config := nativeDeploymentConfigPath(root)
	p, err := readNativeDeployment(config)
	if err != nil || p == nil || p.State != "staged" {
		return err
	}
	pending, err := deploymentJournalExists(config)
	if err != nil {
		return err
	}
	if pending {
		return fmt.Errorf("configuration publication is not settled; cannot verify network rollout")
	}
	raw, exists, err := readDeploymentCurrent(config)
	if err != nil {
		return err
	}
	if matchSnapshot(raw, exists, p.Before) {
		return writeDeploymentState(config, p, "rolled_back")
	}
	if !matchSnapshot(raw, exists, p.After) {
		return fmt.Errorf("configuration differs from staged candidate; refusing to verify")
	}
	return writeDeploymentState(config, p, "verified")
}

// Only called after failed STARTUP (never after a previously healthy service
// crashes). The result is true only if a verified exact previous snapshot was
// restored. No remote probes or Windows Firewall changes are performed.
func rollbackNativeNetworkDeployment(root string) (bool, error) {
	config := nativeDeploymentConfigPath(root)
	p, err := readNativeDeployment(config)
	if err != nil || p == nil || p.State != "staged" {
		return false, err
	}
	pending, err := deploymentJournalExists(config)
	if err != nil {
		return false, err
	}
	if pending {
		return false, fmt.Errorf("unresolved settings publication blocks native rollback")
	}
	raw, exists, err := readDeploymentCurrent(config)
	if err != nil {
		return false, err
	}
	if matchSnapshot(raw, exists, p.Before) {
		// A publication was rolled back before this restart. Do not restart or undo anything.
		if err = writeDeploymentState(config, p, "rolled_back"); err != nil {
			return false, err
		}
		return false, nil
	}
	if !matchSnapshot(raw, exists, p.After) {
		return false, fmt.Errorf("config differs from staged candidate; refusing to overwrite operator changes")
	}
	if p.Before.Present {
		if err = validatePreviousBootSnapshot(*p.Before.Bytes); err != nil {
			return false, err
		}
		if err = syncWriteNativeFile(config, []byte(*p.Before.Bytes)); err != nil {
			return false, err
		}
	} else if err = os.Remove(config); err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	if err = writeDeploymentState(config, p, "rolled_back"); err != nil {
		return false, fmt.Errorf("previous config restored, but deployment status write failed: %w", err)
	}
	return true, nil
}
