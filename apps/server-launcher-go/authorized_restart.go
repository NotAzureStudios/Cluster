package main

// Private, one-shot restart requests bridge the authenticated API to the
// independent native Windows supervisor. The HTTP process must never stop
// itself or manage arbitrary Windows processes.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type authorizedRestartRequest struct {
	Schema int `json:"schema"`
	Action string `json:"action"`
	RequestID string `json:"requestId"`
	CreatedAt string `json:"createdAt"`
	ConfigSHA256 string `json:"configSha256"`
}

type authorizedRestartReceipt struct {
	Schema int `json:"schema"`
	RequestID string `json:"requestId"`
	State string `json:"state"`
	UpdatedAt string `json:"updatedAt"`
}

func nativeRestartDirectory(root string) string {
	return filepath.Join(root, "data", "system", "runtime")
}
func nativeRestartRequestPath(root string) string {
	return filepath.Join(nativeRestartDirectory(root), "cluster-restart-request.json")
}
func nativeRestartReceiptPath(root string) string {
	return filepath.Join(nativeRestartDirectory(root), "cluster-restart-result.json")
}
func writeNativeRestartReceipt(root, id, state string) error {
	if id == "" || (state != "accepted" && state != "ready" && state != "failed") {
		return errors.New("invalid restart receipt")
	}
	dir := nativeRestartDirectory(root)
	if err := os.MkdirAll(dir, 0700); err != nil { return err }
	payload, err := json.Marshal(authorizedRestartReceipt{
		Schema:1, RequestID:id, State:state, UpdatedAt:time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil { return err }
	tmp, err := os.CreateTemp(dir, ".cluster-restart-receipt-*")
	if err != nil { return err }
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if err := tmp.Chmod(0600); err != nil { return err }
	if _, err := tmp.Write(payload); err != nil { return err }
	if err := tmp.Sync(); err != nil { return err }
	if err := tmp.Close(); err != nil { return err }
	// Windows cannot atomically rename over an existing file. The receipt is
	// advisory; request consumption is controlled by the separate claim rename.
	_ = os.Remove(nativeRestartReceiptPath(root))
	return os.Rename(tmp.Name(), nativeRestartReceiptPath(root))
}

// consumeAuthorizedRestart atomically claims an API-authorized request and
// checks it is fresh and bound to the current canonical configuration.
// It only returns an ID after a successful claim; repeated polls cannot
// apply the same request twice.
func consumeAuthorizedRestart(root string, now time.Time) (string, error) {
	source := nativeRestartRequestPath(root)
	info, err := os.Lstat(source)
	if errors.Is(err, os.ErrNotExist) { return "", nil }
	if err != nil { return "", err }
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > 4096 {
		return "", errors.New("restart request is not a bounded regular file")
	}
	claim := source + ".claimed"
	if _, err := os.Lstat(claim); err == nil {
		return "", errors.New("another restart request is already claimed")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := os.Rename(source, claim); err != nil { return "", err }
	defer os.Remove(claim)
	body, err := os.ReadFile(claim)
	if err != nil { return "", err }
	var req authorizedRestartRequest
	if err := json.Unmarshal(body, &req); err != nil { return "", errors.New("invalid restart request JSON") }
	if req.Schema != 1 || req.Action != "restart" || len(req.RequestID) != 36 {
		return "", errors.New("invalid restart request contract")
	}
	for _, c := range req.RequestID {
		if !strings.ContainsRune("0123456789abcdef-", c) {
			return "", errors.New("invalid restart request ID")
		}
	}
	issued, err := time.Parse(time.RFC3339Nano, req.CreatedAt)
	if err != nil || issued.After(now.Add(15*time.Second)) || now.Sub(issued) > 2*time.Minute {
		return "", errors.New("expired or future restart request")
	}
	if len(req.ConfigSHA256) != 64 { return "", errors.New("invalid restart configuration fingerprint") }
	if _, err := hex.DecodeString(req.ConfigSHA256); err != nil { return "", err }
	config, err := os.ReadFile(serverConfigPath(root))
	if err != nil { return "", fmt.Errorf("cannot verify current server configuration: %w", err) }
	digest := sha256.Sum256(config)
	if !strings.EqualFold(hex.EncodeToString(digest[:]), req.ConfigSHA256) {
		return "", errors.New("server configuration changed since restart authorization")
	}
	if err := writeNativeRestartReceipt(root, req.RequestID, "accepted"); err != nil {
		return "", fmt.Errorf("cannot durably acknowledge restart: %w", err)
	}
	return req.RequestID, nil
}
