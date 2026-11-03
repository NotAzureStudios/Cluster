package main

import (
	nativealerts "cluster.local/native-alerts"
	processjob "cluster.local/native-process-job"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

func (h *host) apiEnvironment(port int) map[string]string {
	return map[string]string{
		"NODE_ENV":                    "production",
		"HOST":                        "127.0.0.1",
		"PORT":                        strconv.Itoa(port),
		"WEB_ORIGIN":                  h.origin,
		"CLUSTER_RUNTIME_PROFILE":     "managed-host",
		"CLUSTER_HOST_RUNTIME":        "go",
		"CLUSTER_TRUST_PROXY":         "true",
		"CLUSTER_MANAGED_HOST_ALLOW_INSECURE_LAN_HTTP": strconv.FormatBool(h.remoteAccess && h.allowInsecureHTTP && h.scheme == "http"),
		"SESSION_SECURE":              strconv.FormatBool(h.scheme == "https"),
		"DOTENV_CONFIG_PATH":          environmentOr("DOTENV_CONFIG_PATH", filepath.Join(h.root, "apps", "server", ".env")),
		"CLUSTER_DATA_DIR":            environmentOr("CLUSTER_DATA_DIR", filepath.Join(h.root, "data")),
		"CLUSTER_CONFIG_FILE":         environmentOr("CLUSTER_CONFIG_FILE", filepath.Join(h.root, "data", "system", "config", "cluster.config.json")),
		"CLUSTER_UPLOAD_DIR":          environmentOr("CLUSTER_UPLOAD_DIR", filepath.Join(h.root, "data", "system", "uploads")),
		"CLUSTER_HOST_SHUTDOWN_TOKEN": h.shutdownToken,
	}
}

func (h *host) startAPI(port int) error {
	entry := filepath.Join(h.root, "apps", "server", "dist", "index.js")
	if !fileExists(entry) {
		return fmt.Errorf("compiled API is missing at %s", entry)
	}
	job, err := processjob.New()
	if err != nil {
		return fmt.Errorf("could not create API process job: %w", err)
	}
	cmd := exec.Command("node", entry)
	cmd.Dir, cmd.Stdout, cmd.Stderr, cmd.Stdin = h.root, os.Stdout, os.Stderr, os.Stdin
	cmd.Env = mergedEnv(h.apiEnvironment(port))
	if err := cmd.Start(); err != nil {
		_ = job.Close()
		return fmt.Errorf("could not start API: %w", err)
	}
	if err := job.Assign(cmd); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		_ = job.Close()
		return fmt.Errorf("API launch refused: child job ownership failed: %w", err)
	}
	h.apiJob = job
	h.api = cmd
	h.apiErr = nil
	h.apiDone = make(chan struct{})
	go func() { h.apiErr = cmd.Wait(); close(h.apiDone) }()
	return nil
}

func (h *host) waitForAPI(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 2 * time.Second}
	for time.Now().Before(deadline) {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, h.apiOrigin+"/health/supervisor", nil)
		if response, err := client.Do(req); err == nil {
			_, _ = io.Copy(io.Discard, response.Body)
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-h.apiDone:
			if h.apiErr == nil {
				return errors.New("API process exited before becoming ready")
			}
			return fmt.Errorf("API process exited before becoming ready: %w", h.apiErr)
		case <-time.After(250 * time.Millisecond):
		}
	}
	return fmt.Errorf("timed out after %s", timeout)
}

func apiRestartDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := 500 * time.Millisecond
	for index := 1; index < attempt && delay < 8*time.Second; index++ {
		delay *= 2
	}
	if delay > 8*time.Second {
		return 8 * time.Second
	}
	return delay
}

func (h *host) recoverAPI(ctx context.Context, port int) error {
	if h.apiRestartLimit <= 0 {
		return errors.New("API restart supervision is disabled")
	}
	h.apiRestarting.Store(true)
	defer h.apiRestarting.Store(false)
	h.nativeEmergency(nativealerts.APICrashed)
	// The Node parent may have exited while leaving subprocesses behind. The
	// old job must close BEFORE launching the replacement API generation.
	h.closeAPIJob()
	var lastError error
	for attempt := 1; attempt <= h.apiRestartLimit; attempt++ {
		delay := apiRestartDelay(attempt)
		fmt.Fprintf(os.Stderr, "Cluster API stopped unexpectedly; restart attempt %d/%d in %s.\n", attempt, h.apiRestartLimit, delay)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
		if err := h.startAPI(port); err != nil {
			lastError = err
			continue
		}
		if err := h.waitForAPI(ctx, 35*time.Second); err != nil {
			lastError = err
			h.stopAPI()
			continue
		}
		h.apiRestartCount.Add(1)
		fmt.Fprintf(os.Stderr, "Cluster API recovered and is ready.\n")
		h.nativeEmergency(nativealerts.APIRecovered)
		return nil
	}
	if lastError == nil {
		lastError = errors.New("API did not recover")
	}
	h.nativeEmergency(nativealerts.APIRecoveryFailed)
	return fmt.Errorf("API restart limit exhausted: %w", lastError)
}

func generateShutdownToken() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func (h *host) requestAPIShutdown() error {
	if h.apiOrigin == "" || h.shutdownToken == "" {
		return errors.New("managed shutdown is not configured")
	}
	req, err := http.NewRequest(http.MethodPost, h.apiOrigin+"/internal/host/shutdown", nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Cluster-Host-Shutdown", h.shutdownToken)
	response, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode != http.StatusAccepted {
		return fmt.Errorf("managed shutdown returned HTTP %d", response.StatusCode)
	}
	return nil
}

// The API may legally drain for up to 120 seconds, plus its own 5-second
// shutdown watchdog. Do not terminate it after the former 12-second wait:
// that truncated durable event and Library job drains during normal shutdown.
// Leave a small margin for the managed shutdown response and process exit.
const managedAPIDrainGrace = 135 * time.Second

func (h *host) closeAPIJob() {
	if h.apiJob != nil {
		_ = h.apiJob.Close()
		h.apiJob = nil
	}
}

func (h *host) stopAPI() {
	defer h.closeAPIJob()
	if h.api == nil || h.api.Process == nil || h.apiDone == nil {
		return
	}
	select {
	case <-h.apiDone:
		return
	default:
	}
	if err := h.requestAPIShutdown(); err == nil {
		select {
		case <-h.apiDone:
			return
		case <-time.After(managedAPIDrainGrace):
		}
	}
	_ = h.api.Process.Signal(os.Interrupt)
	select {
	case <-h.apiDone:
	case <-time.After(3 * time.Second):
		_ = h.api.Process.Kill()
		select {
		case <-h.apiDone:
		case <-time.After(2 * time.Second):
		}
	}
}
