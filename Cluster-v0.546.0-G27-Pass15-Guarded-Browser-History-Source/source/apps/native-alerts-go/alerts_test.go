package nativealerts

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const safeDiscordWebhook = "https://discord.com/api/webhooks/1234567890/ABCdef0123456789_Token"

func TestNativeWebhookRejectsUnsafeTargets(t *testing.T) {
	unsafe := []string{
		"http://discord.com/api/webhooks/1234567890/ABCdef0123456789_Token",
		"https://127.0.0.1/api/webhooks/1234567890/ABCdef0123456789_Token",
		"https://discord.com.evil.test/api/webhooks/1234567890/ABCdef0123456789_Token",
		"https://user:pass@discord.com/api/webhooks/1234567890/ABCdef0123456789_Token",
		"https://discord.com:444/api/webhooks/1234567890/ABCdef0123456789_Token",
		"https://discord.com/api/webhooks/1234567890/ABCdef0123456789_Token?x=1",
		"https://discord.com/api/webhooks/1234567890/%2e%2e",
		"https://discord.com/api/users/@me",
	}
	for _, address := range unsafe {
		if _, err := validateNativeAlertWebhook(address); err == nil {
			t.Fatalf("accepted unsafe webhook %s", address)
		}
	}
	if _, err := validateNativeAlertWebhook(safeDiscordWebhook); err != nil {
		t.Fatal(err)
	}
	if value, err := validateNativeAlertWebhook(""); err != nil || value != "" {
		t.Fatalf("disabled webhook must be permitted: %q %v", value, err)
	}
}

func newTestAlertSpool(t *testing.T, webhook string) *Spool {
	t.Helper()
	s, err := New(t.TempDir(), webhook)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestNativeJournalPersistsWithoutExternalTransport(t *testing.T) {
	s := newTestAlertSpool(t, "")
	added, err := s.Record(APIReadinessFailed)
	if err != nil || !added {
		t.Fatalf("expected locally persisted event: %v", err)
	}
	entries, err := s.findFiles(".pending")
	if err != nil || len(entries) != 1 {
		t.Fatalf("event missing from disk: %v %v", entries, err)
	}
	info, err := os.Stat(entries[0])
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() < 80 || info.Size() > nativeAlertMaxFileBytes {
		t.Fatalf("unexpected event size %d", info.Size())
	}
	item, err := s.read(entries[0])
	if err != nil {
		t.Fatal(err)
	}
	if item.Code != APIReadinessFailed || item.Severity != "critical" {
		t.Fatalf("wrong event: %+v", item)
	}
	if n, err := s.Drain(context.Background(), 3); n != 0 || err != nil {
		t.Fatalf("disabled external delivery: %d %v", n, err)
	}
}

func TestNativeJournalDeduplicatesConcurrentFailures(t *testing.T) {
	s := newTestAlertSpool(t, "")
	var added atomic.Int64
	var wait sync.WaitGroup
	for i := 0; i < 16; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			ok, err := s.Record(APICrashed)
			if err != nil {
				t.Error(err)
			}
			if ok {
				added.Add(1)
			}
		}()
	}
	wait.Wait()
	if added.Load() != 1 {
		t.Fatalf("wanted one event, got %d", added.Load())
	}
	s.now = func() time.Time { return time.Now().Add(nativeAlertDedupInterval + time.Second) }
	if ok, err := s.Record(APICrashed); err != nil || !ok {
		t.Fatalf("new failure outside cooldown was dropped: %v", err)
	}
	entries, _ := s.findFiles(".pending")
	if len(entries) != 2 {
		t.Fatalf("expected two events, got %d", len(entries))
	}
}

func TestNativeJournalRetriesWithDurableDeliveryReceipts(t *testing.T) {
	s := newTestAlertSpool(t, safeDiscordWebhook)
	if _, err := s.Record(GatewayServeFailed); err != nil {
		t.Fatal(err)
	}
	var calls int
	s.send = func(_ context.Context, item RecordData) error {
		calls++
		if item.Code != GatewayServeFailed {
			t.Fatalf("wrong code %s", item.Code)
		}
		if calls == 1 {
			return errors.New("network down")
		}
		return nil
	}
	if n, err := s.Drain(context.Background(), 4); n != 0 || err == nil {
		t.Fatalf("should retain failed message: %d, %v", n, err)
	}
	pending, _ := s.findFiles(".pending")
	if len(pending) != 1 {
		t.Fatalf("lost pending event: %v", pending)
	}
	if n, err := s.Drain(context.Background(), 4); n != 1 || err != nil {
		t.Fatalf("could not retry: %d %v", n, err)
	}
	pending, _ = s.findFiles(".pending")
	sent, _ := s.findFiles(".sent")
	if len(pending) != 0 || len(sent) != 1 || calls != 2 {
		t.Fatalf("wrong final journal state: pending=%d sent=%d calls=%d", len(pending), len(sent), calls)
	}
	if n, err := s.Drain(context.Background(), 4); n != 0 || err != nil || calls != 2 {
		t.Fatalf("redelivered already sent message: %d %v", n, err)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestNativeDiscordPayloadContainsNoMentionsOrSensitiveLogs(t *testing.T) {
	s := newTestAlertSpool(t, safeDiscordWebhook)
	var captured map[string]any
	s.client.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != safeDiscordWebhook || req.Header.Get("Content-Type") != "application/json" {
			t.Fatal("invalid outbound request")
		}
		body, _ := io.ReadAll(req.Body)
		if err := json.Unmarshal(body, &captured); err != nil {
			t.Fatal(err)
		}
		return &http.Response{StatusCode: 204, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
	})
	s.send = s.sendDiscord
	if _, err := s.Record(APIRecoveryFailed); err != nil {
		t.Fatal(err)
	}
	if n, err := s.Drain(context.Background(), 4); n != 1 || err != nil {
		t.Fatalf("not delivered: %d %v", n, err)
	}
	content, ok := captured["content"].(string)
	if !ok {
		t.Fatal("missing content")
	}
	if !strings.Contains(content, "api_recovery_exhausted") || strings.Contains(content, "ABCdef0123456789_Token") {
		t.Fatal("unsafe Discord message")
	}
	if _, ok := captured["allowed_mentions"]; !ok {
		t.Fatal("Discord mentions not explicitly disabled")
	}
}

func TestNativeAlertTransportDoesNotLeakWebhookTokenOnError(t *testing.T) {
	s := newTestAlertSpool(t, safeDiscordWebhook)
	s.client.Transport = roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("leaked secret ABCdef0123456789_Token")
	})
	err := s.sendDiscord(context.Background(), RecordData{Code: APICrashed})
	if err == nil || strings.Contains(err.Error(), "ABCdef0123456789_Token") {
		t.Fatalf("secrets leaked: %v", err)
	}
}

func TestNativeAlertUnknownCodeAndCorruptRecordFailClosed(t *testing.T) {
	s := newTestAlertSpool(t, safeDiscordWebhook)
	if _, err := s.Record(Code("api_data_password=secret")); err == nil {
		t.Fatal("accepted arbitrary event payload")
	}
	if _, err := s.Record(APIStartFailed); err != nil {
		t.Fatal(err)
	}
	pending, _ := s.findFiles(".pending")
	if err := os.WriteFile(pending[0], []byte(`{"code":"wrong"}`), 0600); err != nil {
		t.Fatal(err)
	}
	var called bool
	s.send = func(context.Context, RecordData) error { called = true; return nil }
	if n, err := s.Drain(context.Background(), 4); n != 0 || err == nil || called {
		t.Fatalf("invalid event escaped validation: %d %v", n, err)
	}
	quarantined, _ := s.findFiles(".invalid")
	if len(quarantined) != 1 {
		t.Fatal("invalid event was not quarantined")
	}
}

func TestNativeEmergencyCanRecordWithoutWebOrDatabase(t *testing.T) {
	s := newTestAlertSpool(t, "")
	if err := s.Emit(APIStartFailed); err != nil {
		t.Fatal(err)
	}
	paths, _ := s.findFiles(".pending")
	if len(paths) != 1 || !strings.HasSuffix(filepath.Base(paths[0]), ".pending") {
		t.Fatal("missing native emergency record")
	}
}

func TestNativeAlertsDoNotDoubleSendAcrossProcesses(t *testing.T) {
	root := t.TempDir()
	a, err := New(root, safeDiscordWebhook)
	if err != nil {
		t.Fatal(err)
	}
	b, err := New(root, safeDiscordWebhook)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Record(APIStartFailed); err != nil {
		t.Fatal(err)
	}
	var count atomic.Int64
	deliver := func(context.Context, RecordData) error { count.Add(1); time.Sleep(25 * time.Millisecond); return nil }
	a.send, b.send = deliver, deliver
	var wg sync.WaitGroup
	for _, spool := range []*Spool{a, b} {
		wg.Add(1)
		go func(s *Spool) {
			defer wg.Done()
			if _, err := s.Drain(context.Background(), 4); err != nil {
				t.Error(err)
			}
		}(spool)
	}
	wg.Wait()
	if count.Load() != 1 {
		t.Fatalf("cross-process double delivery: %d", count.Load())
	}
}

func TestNativeAlertsRecoverCrashClaimAfterFiveMinutes(t *testing.T) {
	s := newTestAlertSpool(t, safeDiscordWebhook)
	if _, err := s.Record(HostUnexpectedExit); err != nil {
		t.Fatal(err)
	}
	files, _ := s.findFiles(".pending")
	claimed := strings.TrimSuffix(files[0], ".pending") + ".sending"
	if err := os.Rename(files[0], claimed); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-10 * time.Minute)
	if err := os.Chtimes(claimed, old, old); err != nil {
		t.Fatal(err)
	}
	var sends int
	s.send = func(context.Context, RecordData) error { sends++; return nil }
	if n, err := s.Drain(context.Background(), 4); n != 1 || err != nil || sends != 1 {
		t.Fatalf("stale claim lost: %d %v sends %d", n, err, sends)
	}
}

func TestNativeInvalidEntryDoesNotBlockOtherIncidents(t *testing.T) {
	s := newTestAlertSpool(t, safeDiscordWebhook)
	if _, err := s.Record(APIStartFailed); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Record(APIRecoveryFailed); err != nil {
		t.Fatal(err)
	}
	files, _ := s.findFiles(".pending")
	if err := os.WriteFile(files[0], []byte(`not valid json`), 0600); err != nil {
		t.Fatal(err)
	}
	var delivered int
	s.send = func(context.Context, RecordData) error { delivered++; return nil }
	n, err := s.Drain(context.Background(), 4)
	if n != 1 || err == nil || delivered != 1 {
		t.Fatalf("malformed record blocked critical event: %d %v sends %d", n, err, delivered)
	}
	invalid, _ := s.findFiles(".invalid")
	if len(invalid) != 1 {
		t.Fatal("expected quarantined record")
	}
}

func TestNativeAlertDeduplicatesAlreadyDeliveredOutage(t *testing.T) {
	s := newTestAlertSpool(t, safeDiscordWebhook)
	s.send = func(context.Context, RecordData) error { return nil }
	if ok, err := s.Record(HostUnexpectedExit); err != nil || !ok {
		t.Fatal(err)
	}
	if n, err := s.Drain(context.Background(), 1); n != 1 || err != nil {
		t.Fatalf("delivery: %d %v", n, err)
	}
	if ok, err := s.Record(HostUnexpectedExit); err != nil || ok {
		t.Fatalf("repeated outage spammed: %v %v", ok, err)
	}
	if ok, err := s.Record(APIRecovered); err != nil || !ok {
		t.Fatalf("recovery must not be suppressed: %v %v", ok, err)
	}
	s.now = func() time.Time { return time.Now().Add(nativeAlertDedupInterval + time.Second) }
	if ok, err := s.Record(HostUnexpectedExit); err != nil || !ok {
		t.Fatalf("cooldown did not expire: %v %v", ok, err)
	}
}
