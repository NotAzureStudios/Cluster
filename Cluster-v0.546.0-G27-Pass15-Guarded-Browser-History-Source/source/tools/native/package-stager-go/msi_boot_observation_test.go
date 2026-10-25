package main

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

func TestMSIBootObservationsDoNotAuthorizeRecovery(t *testing.T) {
	at := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)
	attempt := msiAttempt{State: "msi_restart_required_not_os_attested", StartedAt: at.Format(time.RFC3339Nano),
		FinishedAt: at.Add(3 * time.Minute).Format(time.RFC3339Nano)}
	observed := at.Add(48 * time.Hour)
	cases := []struct {
		name      string
		uptime    time.Duration
		available bool
		want      string
	}{
		{"boot after attempt", 4 * time.Hour, true, "reboot_indicated_unverified"},
		{"same boot", 60 * time.Hour, true, "same_boot_indicated_unverified"},
		{"clock near attempt", 48 * time.Hour, true, "boot_relation_ambiguous"},
		{"unavailable API", 0, false, "os_uptime_unavailable"},
		{"invalid negative", -1, true, "os_uptime_unavailable"},
		{"invalid excessive", 4000 * 24 * time.Hour, true, "os_uptime_unavailable"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := classifyMSIBootObservation(attempt, observed, tc.uptime, tc.available)
			if got.State != tc.want || !got.ReadOnly || got.OSAttested || got.RebootConfirmed {
				t.Fatalf("unsafe reboot evidence: %+v", got)
			}
			if tc.available && tc.uptime >= 0 && tc.uptime <= 3650*24*time.Hour && (got.ObservedAt == "" || got.EstimatedBootAt == "") {
				t.Fatalf("missing observation: %+v", got)
			}
		})
	}
}
func TestMSIBootObservationRefusesFutureAndMalformedAttempt(t *testing.T) {
	at := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)
	for _, attempt := range []msiAttempt{{StartedAt: "not-a-date"}, {StartedAt: at.Add(time.Hour).Format(time.RFC3339Nano), FinishedAt: at.Add(time.Hour).Format(time.RFC3339Nano)}} {
		got := classifyMSIBootObservation(attempt, at, time.Hour, true)
		if got.State != "os_uptime_unavailable" || got.RebootConfirmed {
			t.Fatalf("invalid attempt accepted: %+v", got)
		}
	}
}

func TestMSIBootObservationJSONNeverClaimsConfirmation(t *testing.T) {
	at := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)
	attempt := msiAttempt{StartedAt: at.Format(time.RFC3339Nano)}
	confirmed := classifyMSIBootObservation(attempt, at.Add(time.Hour), 0, true)
	encoded, err := json.Marshal(confirmed)
	if err != nil || !bytes.Contains(encoded, []byte(`"uptimeMilliseconds":0`)) ||
		!bytes.Contains(encoded, []byte(`"rebootConfirmed":false`)) ||
		!bytes.Contains(encoded, []byte(`"osAttested":false`)) {
		t.Fatalf("missing explicit zero-uptime non-authorization: %s %v", encoded, err)
	}
	missing, err := json.Marshal(unavailableMSIBootObservation())
	if err != nil || bytes.Contains(missing, []byte(`"uptimeMilliseconds"`)) ||
		bytes.Contains(missing, []byte(`"observedAt"`)) ||
		bytes.Contains(missing, []byte(`"estimatedBootAt"`)) {
		t.Fatalf("unavailable observation invented uptime: %s %v", missing, err)
	}
}
