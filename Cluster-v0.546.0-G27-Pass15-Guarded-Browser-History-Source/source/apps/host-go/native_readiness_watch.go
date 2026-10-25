package main

import (
	nativealerts "cluster.local/native-alerts"
	"context"
	"io"
	"net/http"
	"time"
)

// readinessTransitions uses the supervisor health contract, which remains 200
// during deliberately held workspace maintenance when dependencies are healthy.
// It is independent of the API/database alert persistence. The initial
// readiness gate already passed before this watcher is started. Two consecutive
// failures and two confirmed recoveries avoid spurious operator pages.
type readinessTransitions struct {
	failed   int
	passed   int
	degraded bool
}

func (r *readinessTransitions) observe(healthy bool) (nativealerts.Code, bool) {
	if healthy {
		r.failed = 0
		if !r.degraded {
			return "", false
		}
		r.passed++
		if r.passed >= 2 {
			r.passed = 0
			r.degraded = false
			return nativealerts.APIReadinessRestored, true
		}
		return "", false
	}
	r.passed = 0
	if r.degraded {
		return "", false
	}
	r.failed++
	if r.failed >= 2 {
		r.failed = 0
		r.degraded = true
		return nativealerts.APIReadinessLost, true
	}
	return "", false
}

func nativeAPIReady(ctx context.Context, client *http.Client, origin string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/health/supervisor", nil)
	if err != nil {
		return false
	}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
	return resp.StatusCode == http.StatusOK
}

func (h *host) watchNativeReadiness(ctx context.Context) {
	if h.apiOrigin == "" {
		return
	}
	client := &http.Client{
		Timeout:       3 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		transition := readinessTransitions{}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
				good := nativeAPIReady(checkCtx, client, h.apiOrigin)
				cancel()
				if ctx.Err() != nil {
					return
				}
				if code, shouldAlert := transition.observe(good); shouldAlert {
					h.nativeEmergency(code)
				}
			}
		}
	}()
}
