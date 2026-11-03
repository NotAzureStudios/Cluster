//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeRestartFixture(t *testing.T, root, requestID string, when time.Time, digest string) {
	t.Helper()
	dir := nativeRestartDirectory(root)
	if err := os.MkdirAll(dir, 0700); err != nil { t.Fatal(err) }
	raw, err := json.Marshal(authorizedRestartRequest{Schema: 1, Action: "restart", RequestID: requestID,
		CreatedAt: when.UTC().Format(time.RFC3339Nano), ConfigSHA256: digest})
	if err != nil { t.Fatal(err) }
	if err := os.WriteFile(nativeRestartRequestPath(root), raw, 0600); err != nil { t.Fatal(err) }
}

func TestAuthorizedRestartRequiresFreshMatchingConfigAndConsumesOnlyOnce(t *testing.T) {
	t.Setenv("CLUSTER_CONFIG_FILE", "")
	root := t.TempDir()
	cfg := serverConfigPath(root)
	if err := os.MkdirAll(filepath.Dir(cfg), 0700); err != nil { t.Fatal(err) }
	body := []byte("{\"version\":2,\"settings\":{}}")
	if err := os.WriteFile(cfg, body, 0600); err != nil { t.Fatal(err) }
	digest := sha256.Sum256(body)
	hash := hex.EncodeToString(digest[:])
	id := "f52dbd8c-825b-49cc-93e0-9fd416dde341"
	now := time.Now().UTC()

	t.Run("valid one shot", func(t *testing.T) {
		writeRestartFixture(t, root, id, now, hash)
		got, err := consumeAuthorizedRestart(root, now)
		if err != nil || got != id { t.Fatalf("expected claimed request, got %q err %v", got, err) }
		got, err = consumeAuthorizedRestart(root, now)
		if err != nil || got != "" { t.Fatalf("replayed request: %q err %v", got, err) }
		receipt, err := os.ReadFile(nativeRestartReceiptPath(root))
		if err != nil || !strings.Contains(string(receipt), "\"accepted\"") {
			t.Fatalf("missing receipt: %v %s", err, receipt)
		}
	})
	t.Run("old request", func(t *testing.T) {
		writeRestartFixture(t, root, id, now.Add(-4*time.Minute), hash)
		got, err := consumeAuthorizedRestart(root, now)
		if err == nil || got != "" { t.Fatalf("expired request accepted: %q err %v", got, err) }
	})
	t.Run("wrong config revision", func(t *testing.T) {
		writeRestartFixture(t, root, id, now, strings.Repeat("0", 64))
		got, err := consumeAuthorizedRestart(root, now)
		if err == nil || got != "" { t.Fatalf("wrong config accepted: %q err %v", got, err) }
	})
}
