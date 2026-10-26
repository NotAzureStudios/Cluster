package main

import (
	"testing"
	"time"
)

func TestMSIBootAnchorContinuityAndRestartIndication(t *testing.T) {
	start := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)
	anchorAt := start.Add(time.Second)
	attempt := msiAttempt{StartedAt: start.Format(time.RFC3339Nano),
		FinishedAt: start.Add(2 * time.Minute).Format(time.RFC3339Nano),
		BootAnchor: &msiBootAnchor{ObservedAt: anchorAt.Format(time.RFC3339Nano),
			UptimeMilliseconds: uint64((10 * time.Hour) / time.Millisecond)}}
	if !validateMSIBootAnchor(attempt.BootAnchor, attempt.StartedAt) {
		t.Fatal("valid receipt anchor rejected")
	}
	now := start.Add(12 * time.Hour)
	// Both readings identify approximately the same boot start.
	same := classifyMSIBootObservation(attempt, now, 22*time.Hour-time.Second, true)
	if same.State != "same_boot_indicated_unverified" || !same.AnchorRecorded || !same.ReadOnly || same.OSAttested || same.RebootConfirmed {
		t.Fatalf("same boot was attested or misclassified: %+v", same)
	}
	// A reset uptime counter indicates a changed boot epoch, not MSI health.
	reset := classifyMSIBootObservation(attempt, now, 2*time.Hour, true)
	if reset.State != "reboot_indicated_unverified" || !reset.AnchorRecorded || reset.RebootConfirmed || reset.OSAttested {
		t.Fatalf("post-restart claim unsafe: %+v", reset)
	}
	// An NTP or manual clock jump can move the inferred boot epoch. It must
	// remain an unverified *indication* rather than proof or replay authority.
	clockJump := classifyMSIBootObservation(attempt, now.Add(2*time.Hour), 22*time.Hour, true)
	if clockJump.State != "reboot_indicated_unverified" || clockJump.RebootConfirmed {
		t.Fatalf("clock jump was certified: %+v", clockJump)
	}
	unavailable := classifyMSIBootObservation(attempt, now, 0, false)
	if unavailable.State != "os_uptime_unavailable" || !unavailable.AnchorRecorded || unavailable.RebootConfirmed {
		t.Fatalf("missing OS observation lost anchor history: %+v", unavailable)
	}
}

func TestMSIBootAnchorCorruptionFailsClosed(t *testing.T) {
	start := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)
	for _, bad := range []msiBootAnchor{
		{ObservedAt: "not-a-time"},
		{ObservedAt: start.Add(-10 * time.Minute).Format(time.RFC3339Nano), UptimeMilliseconds: 10},
		{ObservedAt: start.Add(10 * time.Minute).Format(time.RFC3339Nano), UptimeMilliseconds: 10},
		{ObservedAt: start.Format(time.RFC3339Nano), UptimeMilliseconds: uint64(maxMSIUptime/time.Millisecond) + 1},
	} {
		if validateMSIBootAnchor(&bad, start.Format(time.RFC3339Nano)) {
			t.Fatalf("accepted invalid anchor: %+v", bad)
		}
		attempt := msiAttempt{StartedAt: start.Format(time.RFC3339Nano), BootAnchor: &bad}
		if observation := classifyMSIBootObservation(attempt, start.Add(time.Hour), time.Minute, true); observation.State != "os_uptime_unavailable" || !observation.AnchorRecorded || observation.RebootConfirmed {
			t.Fatalf("unsafe corrupt anchor observation: %+v", observation)
		}
	}
	if !validateMSIBootAnchor(nil, start.Format(time.RFC3339Nano)) {
		t.Fatal("legacy historical receipt rejected")
	}
}
