package main

// This is an advisory reading of OS uptime, NOT evidence that MSI installed
// correctly, that Windows committed a restart, or that repair/retry is safe.
// Clock changes, sleep and system API availability can make an estimate
// ambiguous. No write, grant, lock-clear or installer execution uses it.
import (
	"time"
)

const msiBootComparisonMargin = 5 * time.Minute
const maxMSIUptime = 3650 * 24 * time.Hour

// Optional immutable creation-time anchor stored in NEW MSI attempt receipts.
// Absence is normal for previous schema-1 receipts. It is never an identity
// proof, since UTC can be adjusted independently from monotonic uptime.
type msiBootAnchor struct {
	ObservedAt         string `json:"observedAt"`
	UptimeMilliseconds uint64 `json:"uptimeMilliseconds"`
}

func captureMSIBootAnchor() *msiBootAnchor {
	observedAt, uptime, err := queryMSISystemUptime()
	if err != nil || observedAt.IsZero() || uptime < 0 || uptime > maxMSIUptime {
		return nil
	}
	return &msiBootAnchor{ObservedAt: observedAt.UTC().Format(time.RFC3339Nano), UptimeMilliseconds: uint64(uptime / time.Millisecond)}
}

func validateMSIBootAnchor(anchor *msiBootAnchor, startedAt string) bool {
	if anchor == nil {
		return true
	}
	started, err := time.Parse(time.RFC3339Nano, startedAt)
	observed, timestampErr := time.Parse(time.RFC3339Nano, anchor.ObservedAt)
	if err != nil || timestampErr != nil || anchor.UptimeMilliseconds > uint64(maxMSIUptime/time.Millisecond) {
		return false
	}
	return !observed.Before(started.Add(-msiBootComparisonMargin)) && !observed.After(started.Add(msiBootComparisonMargin))
}

type msiBootObservation struct {
	State              string  `json:"state"`
	ReadOnly           bool    `json:"readOnly"`
	AnchorRecorded     bool    `json:"anchorRecorded"`
	OSAttested         bool    `json:"osAttested"`
	RebootConfirmed    bool    `json:"rebootConfirmed"`
	ObservedAt         string  `json:"observedAt,omitempty"`
	UptimeMilliseconds *uint64 `json:"uptimeMilliseconds,omitempty"`
	EstimatedBootAt    string  `json:"estimatedBootAt,omitempty"`
}

func unavailableMSIBootObservation() msiBootObservation {
	return msiBootObservation{State: "os_uptime_unavailable", ReadOnly: true}
}

// Classify only bounded, internally consistent uptime observations. Even a
// strong indication is NOT an OS-confirmed reboot: a wall-clock correction can
// shift the estimated boot time. Deliberately offer no success/health state.
func classifyMSIBootObservation(attempt msiAttempt, observedAt time.Time, uptime time.Duration, available bool) msiBootObservation {
	out := unavailableMSIBootObservation()
	out.AnchorRecorded = attempt.BootAnchor != nil
	if !validateMSIBootAnchor(attempt.BootAnchor, attempt.StartedAt) || !available || observedAt.IsZero() || uptime < 0 || uptime > maxMSIUptime {
		return out
	}
	referenceText := attempt.StartedAt
	if attempt.LaunchCommittedAt != "" {
		referenceText = attempt.LaunchCommittedAt
	}
	if attempt.FinishedAt != "" {
		referenceText = attempt.FinishedAt
	}
	reference, err := time.Parse(time.RFC3339Nano, referenceText)
	started, startedErr := time.Parse(time.RFC3339Nano, attempt.StartedAt)
	if err != nil || startedErr != nil || reference.After(observedAt.Add(msiBootComparisonMargin)) {
		return out
	}
	boot := observedAt.UTC().Add(-uptime)
	out.ObservedAt = observedAt.UTC().Format(time.RFC3339Nano)
	milliseconds := uint64(uptime / time.Millisecond)
	out.UptimeMilliseconds = &milliseconds
	out.EstimatedBootAt = boot.Format(time.RFC3339Nano)
	if anchor := attempt.BootAnchor; anchor != nil {
		anchorAt, _ := time.Parse(time.RFC3339Nano, anchor.ObservedAt)
		previousBoot := anchorAt.Add(-time.Duration(anchor.UptimeMilliseconds) * time.Millisecond)
		delta := boot.Sub(previousBoot)
		switch {
		case observedAt.After(anchorAt.Add(msiBootComparisonMargin)) &&
			(uint64(uptime/time.Millisecond) < anchor.UptimeMilliseconds || delta > msiBootComparisonMargin):
			out.State = "reboot_indicated_unverified"
		case delta < msiBootComparisonMargin && delta > -msiBootComparisonMargin &&
			uint64(uptime/time.Millisecond) >= anchor.UptimeMilliseconds:
			out.State = "same_boot_indicated_unverified"
		default:
			out.State = "boot_relation_ambiguous"
		}
		return out
	}
	// Historical receipts have no creation-time boot anchor. Their
	// relation is weaker and relies on wall-clock receipt timestamps only.
	switch {
	case boot.After(reference.Add(msiBootComparisonMargin)):
		out.State = "reboot_indicated_unverified"
	case boot.Before(started.Add(-msiBootComparisonMargin)):
		out.State = "same_boot_indicated_unverified"
	default:
		out.State = "boot_relation_ambiguous"
	}
	return out
}

func inspectMSIBootObservation(attempt msiAttempt) msiBootObservation {
	observedAt, uptime, err := queryMSISystemUptime()
	return classifyMSIBootObservation(attempt, observedAt, uptime, err == nil)
}
