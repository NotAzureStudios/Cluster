//go:build windows

package main

// Plain-language progress for the panel and Web Admin. Every phase the
// transaction records becomes one status line; failures say where and why.
import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var updatePhaseSteps = map[serverUpdatePhase]struct {
	label    string
	progress int
}{
	updatePhaseAuthorized:     {"Preparing", 5},
	updatePhaseWriteHold:      {"Pausing changes", 10},
	updatePhaseStopped:        {"Stopping Cluster", 20},
	updatePhaseBackupVerified: {"Backing up the database", 35},
	updatePhaseApplying:       {"Installing", 60},
	updatePhaseStarting:       {"Starting Cluster", 80},
	updatePhaseProbing:        {"Checking health", 90},
	updatePhaseCommitted:      {"Finishing", 95},
	updatePhaseReopenAccess:   {"Finishing", 98},
	updatePhaseRollingBack:    {"Restoring the previous version", 70},
	updatePhaseRecovered:      {"Previous version restored", 100},
}

func publishUpdateProgress(root string, candidate inspectedStagedServerUpdate, phase serverUpdatePhase, state string) {
	step, ok := updatePhaseSteps[phase]
	if !ok || state == "failed" || state == "blocked" {
		return
	}
	_ = publishWebUpdateStatus(root, webServerUpdateStatus{OK: true, State: "installing", Release: candidate.Release,
		Sequence: candidate.Sequence, Step: step.label, Progress: step.progress,
		Message: step.label + " · updating to " + candidate.Release})
}

func publishUpdateFailure(root string, candidate inspectedStagedServerUpdate, result serverUpdateTransactionResult) {
	step := updatePhaseSteps[result.Phase].label
	if step == "" {
		step = string(result.Phase)
	}
	reason := strings.TrimSpace(fmt.Sprint(result.Err))
	if len(reason) > 300 {
		reason = reason[:300] + "…"
	}
	status := webServerUpdateStatus{OK: false, Release: candidate.Release, Sequence: candidate.Sequence, Step: step, FailedSequence: candidate.Sequence}
	if result.Recovered {
		status.State = "recovered"
		status.Message = fmt.Sprintf("Update to %s failed while %s: %s. The previous version was restored and is running.", candidate.Release, strings.ToLower(step), reason)
	} else {
		status.State = "blocked"
		status.Message = fmt.Sprintf("Update to %s failed while %s and could not be undone automatically: %s. Cluster is paused; send this message to support.", candidate.Release, strings.ToLower(step), reason)
	}
	_ = publishWebUpdateStatus(root, status)
}

// stageUpdateBrokerRefresh copies the freshly installed updater into the
// protected broker folder as .next. The broker swaps it in between updates.
func stageUpdateBrokerRefresh(root string) error {
	dir := updateBrokerDirectory(root)
	if info, err := os.Lstat(dir); err != nil || !info.IsDir() {
		return nil
	}
	next := filepath.Join(dir, "ClusterUpdateBroker.next.exe")
	_ = os.Remove(next)
	return copyBrokerWorkerExecutable(filepath.Join(root, "bin", "ClusterServer.exe"), next)
}
