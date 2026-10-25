package nativealerts

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Native emergency alerts cannot depend on the API, PostgreSQL, or Cluster's
// Inbox. Only allowlisted, constant messages are journalled or sent: never
// include raw error strings, connection URLs, tokens, filesystem paths, or PII.
type Code string

const (
	GatewayBindFailed       Code = "gateway_bind_failed"
	GatewayServeFailed      Code = "gateway_serve_failed"
	APIStartFailed          Code = "api_start_failed"
	APIReadinessFailed      Code = "api_readiness_failed"
	APICrashed              Code = "api_process_exited"
	APIRecovered            Code = "api_recovered"
	APIRecoveryFailed       Code = "api_recovery_exhausted"
	APIReadinessLost        Code = "api_runtime_readiness_lost"
	APIReadinessRestored    Code = "api_runtime_readiness_restored"
	LauncherStartupFailed   Code = "launcher_startup_failed"
	HostReadinessTimeout    Code = "host_readiness_timeout"
	HostUnexpectedExit      Code = "host_unexpected_exit"
	NetworkRollbackRestored Code = "network_rollback_restored"
	NetworkRollbackBlocked  Code = "network_rollback_blocked"
)

var nativeAlertCatalog = map[Code]struct {
	Severity string
	Message  string
}{
	GatewayBindFailed:       {"critical", "Cluster's web listener could not start. Inspect the local native server logs."},
	GatewayServeFailed:      {"critical", "Cluster's web listener stopped unexpectedly. Inspect the local native server logs."},
	APIStartFailed:          {"critical", "The Cluster API process failed to start. Inspect the local native server logs."},
	APIReadinessFailed:      {"critical", "The Cluster API did not become ready. Inspect the local native server logs."},
	APICrashed:              {"warning", "The Cluster API process exited unexpectedly. Native recovery is being attempted."},
	APIRecovered:            {"info", "The Cluster API recovered after a supervised restart."},
	APIRecoveryFailed:       {"critical", "The Cluster API could not be recovered within its configured restart limit."},
	APIReadinessLost:        {"critical", "The Cluster API is running but dependency readiness has failed repeatedly (database/storage/saturation)."},
	APIReadinessRestored:    {"info", "The Cluster API dependency readiness has recovered."},
	LauncherStartupFailed:   {"critical", "The native Cluster launcher could not finish starting the server."},
	HostReadinessTimeout:    {"critical", "The native Cluster host failed to report readiness before its watchdog expired."},
	HostUnexpectedExit:      {"critical", "The native Cluster host terminated unexpectedly."},
	NetworkRollbackRestored: {"warning", "The Cluster Windows Service restored the previous network configuration after failed startup. Review the staged change."},
	NetworkRollbackBlocked:  {"critical", "The Cluster Windows Service could not safely restore a staged network change. Inspect the protected deployment record and service logs."},
}

const (
	nativeAlertMaxPending    = 256
	nativeAlertMaxSent       = 256
	nativeAlertMaxFileBytes  = 4096
	nativeAlertDedupInterval = 10 * time.Minute
	nativeAlertDrainInterval = 60 * time.Second
)

type RecordData struct {
	Version    int    `json:"version"`
	ID         string `json:"id"`
	Code       Code   `json:"code"`
	Severity   string `json:"severity"`
	Message    string `json:"message"`
	OccurredAt string `json:"occurredAt"`
}

type Spool struct {
	root       string
	webhookURL string
	client     *http.Client
	now        func() time.Time
	mu         sync.Mutex
	// Testing seam: production uses the strictly validated Discord sender.
	send func(context.Context, RecordData) error
}

// Discord-only transport is deliberate. A configurable arbitrary URL would
// turn a privileged Windows supervisor into an SSRF and secret-exfiltration tool.
func validateNativeAlertWebhook(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || u == nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("emergency Discord webhook must be an HTTPS URL without credentials, query or fragment")
	}
	if u.Hostname() != "discord.com" || (u.Port() != "" && u.Port() != "443") {
		return "", errors.New("emergency webhook must use discord.com over HTTPS")
	}
	parts := strings.Split(strings.Trim(u.EscapedPath(), "/"), "/")
	if len(parts) != 4 || parts[0] != "api" || parts[1] != "webhooks" || len(parts[2]) < 5 || len(parts[3]) < 10 {
		return "", errors.New("emergency webhook has an invalid Discord webhook path")
	}
	for _, part := range parts[2:] {
		for _, c := range part {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') {
				return "", errors.New("emergency webhook contains invalid token characters")
			}
		}
	}
	return u.String(), nil
}

func New(root, webhook string) (*Spool, error) {
	validated, err := validateNativeAlertWebhook(webhook)
	spool := &Spool{
		root:       filepath.Join(root, "data", "system", "operations", "native-alerts"),
		webhookURL: validated,
		now:        time.Now,
	}
	spool.client = &http.Client{Timeout: 4 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	spool.send = spool.sendDiscord
	return spool, err
}

func (s *Spool) Record(code Code) (bool, error) {
	entry, ok := nativeAlertCatalog[code]
	if !ok {
		return false, errors.New("unknown native alert code")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.root, 0700); err != nil {
		return false, err
	}
	// Coalesce duplicate pending AND recently sent codes, so a repeat-crash
	// loop cannot page the on-call channel on every successful delivery.
	pending, err := s.findFiles(".pending")
	if err != nil {
		return false, err
	}
	sent, err := s.findFiles(".sent")
	if err != nil {
		return false, err
	}
	for _, path := range append(pending, sent...) {
		previous, e := s.read(path)
		if e == nil && previous.Code == code {
			previousTime, e := time.Parse(time.RFC3339Nano, previous.OccurredAt)
			age := s.now().Sub(previousTime)
			if e == nil && age >= 0 && age < nativeAlertDedupInterval {
				return false, nil
			}
		}
	}
	if len(pending) >= nativeAlertMaxPending {
		return false, errors.New("native emergency alert journal is full; operator intervention required")
	}
	idBytes := make([]byte, 16)
	if _, err := rand.Read(idBytes); err != nil {
		return false, err
	}
	id := hex.EncodeToString(idBytes)
	item := RecordData{Version: 1, ID: id, Code: code, Severity: entry.Severity, Message: entry.Message, OccurredAt: s.now().UTC().Format(time.RFC3339Nano)}
	body, err := json.Marshal(item)
	if err != nil {
		return false, err
	}
	name := s.now().UTC().Format("20060102T150405.000000000Z") + "-" + id
	tmp := filepath.Join(s.root, name+".writing")
	pendingPath := filepath.Join(s.root, name+".pending")
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return false, err
	}
	if _, err = file.Write(body); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return false, err
	}
	if err := os.Rename(tmp, pendingPath); err != nil {
		_ = os.Remove(tmp)
		return false, err
	}
	return true, nil
}

func (s *Spool) findFiles(suffix string) ([]string, error) {
	entries, err := os.ReadDir(s.root)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var paths []string
	for _, e := range entries {
		if e.Type().IsRegular() && strings.HasSuffix(e.Name(), suffix) {
			paths = append(paths, filepath.Join(s.root, e.Name()))
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func (s *Spool) read(path string) (RecordData, error) {
	var event RecordData
	file, err := os.Open(path)
	if err != nil {
		return event, err
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, nativeAlertMaxFileBytes+1))
	if err != nil || len(body) > nativeAlertMaxFileBytes {
		return event, errors.New("native alert file exceeds safe bounds")
	}
	if err := json.Unmarshal(body, &event); err != nil {
		return event, err
	}
	entry, ok := nativeAlertCatalog[event.Code]
	if !ok || event.Version != 1 || event.Severity != entry.Severity || event.Message != entry.Message || len(event.ID) != 32 {
		return event, errors.New("invalid native alert content")
	}
	return event, nil
}

// Drain bounds outbound delivery and uses an atomic rename to claim records.
// Launcher and host can run concurrently: only one sender may claim a file.
// A crash after receipt but before moving to .sent remains at-least-once;
// downstream event IDs allow duplicate notifications to be correlated.
func (s *Spool) Drain(ctx context.Context, limit int) (int, error) {
	if s.webhookURL == "" || limit <= 0 {
		return 0, nil
	}
	if limit > 4 {
		limit = 4
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.reclaimStaleClaims(); err != nil {
		return 0, err
	}
	pending, err := s.findFiles(".pending")
	if err != nil {
		return 0, err
	}
	delivered := 0
	var invalidEntry error
	for _, path := range pending {
		if delivered >= limit || ctx.Err() != nil {
			break
		}
		claimed := strings.TrimSuffix(path, ".pending") + ".sending"
		// Only one process can successfully rename a given pending file.
		if err := os.Rename(path, claimed); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return delivered, err
		}
		// Update timestamp for stale claim recovery. If stamping fails,
		// preserve the record in the pending queue and fail visibly.
		if err := os.Chtimes(claimed, s.now(), s.now()); err != nil {
			_ = os.Rename(claimed, path)
			return delivered, err
		}
		item, err := s.read(claimed)
		if err != nil {
			// Quarantine malformed records rather than blocking all later
			// emergency incidents. Never transmit unrecognized disk content.
			if renameErr := os.Rename(claimed, strings.TrimSuffix(path, ".pending")+".invalid"); renameErr != nil {
				return delivered, renameErr
			}
			invalidEntry = errors.New("invalid native emergency event quarantined for operator review")
			continue
		}
		if err := s.send(ctx, item); err != nil {
			if renameErr := os.Rename(claimed, path); renameErr != nil {
				return delivered, renameErr
			}
			return delivered, errors.New("native alert delivery unavailable; queued for retry")
		}
		if err := os.Rename(claimed, strings.TrimSuffix(path, ".pending")+".sent"); err != nil {
			return delivered, err
		}
		delivered++
	}
	if delivered > 0 {
		if err := s.pruneSent(); err != nil {
			return delivered, err
		}
	}
	if invalidEntry != nil {
		return delivered, invalidEntry
	}
	return delivered, ctx.Err()
}

// A supervisor crash can strand .sending files. After five minutes, retry
// them. This age exceeds the four-second HTTP timeout plus startup overhead.
func (s *Spool) reclaimStaleClaims() error {
	claims, err := s.findFiles(".sending")
	if err != nil {
		return err
	}
	for _, claimed := range claims {
		info, err := os.Stat(claimed)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if s.now().Sub(info.ModTime()) < 5*time.Minute {
			continue
		}
		pending := strings.TrimSuffix(claimed, ".sending") + ".pending"
		if err := os.Rename(claimed, pending); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (s *Spool) pruneSent() error {
	sent, err := s.findFiles(".sent")
	if err != nil {
		return err
	}
	for len(sent) > nativeAlertMaxSent {
		if err := os.Remove(sent[0]); err != nil {
			return err
		}
		sent = sent[1:]
	}
	return nil
}

func (s *Spool) sendDiscord(ctx context.Context, event RecordData) error {
	text := fmt.Sprintf("Cluster native supervisor [%s] (%s)\n%s\nIncident ID: %s\nUTC: %s", event.Severity, event.Code, event.Message, event.ID, event.OccurredAt)
	payload, _ := json.Marshal(map[string]any{"content": text, "allowed_mentions": map[string]any{"parse": []string{}}})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.webhookURL, bytes.NewReader(payload))
	if err != nil {
		return errors.New("invalid native alert request")
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(req)
	if err != nil {
		// Never bubble up an error that includes the secret-bearing URL.
		return errors.New("emergency Discord webhook could not be reached")
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("emergency Discord webhook did not accept delivery")
	}
	return nil
}

func (s *Spool) Start(ctx context.Context) {
	if s.webhookURL == "" {
		return
	}
	go func() {
		ticker := time.NewTicker(nativeAlertDrainInterval)
		defer ticker.Stop()
		for {
			attemptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			_, _ = s.Drain(attemptCtx, 4)
			cancel()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// Emit records a trusted code before trying best-effort delivery. It is safe
// to call when PostgreSQL and the application runtime are completely offline.
func (s *Spool) Emit(code Code) error {
	added, err := s.Record(code)
	if err != nil {
		return err
	}
	if !added || s.webhookURL == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = s.Drain(ctx, 1)
	return err
}
