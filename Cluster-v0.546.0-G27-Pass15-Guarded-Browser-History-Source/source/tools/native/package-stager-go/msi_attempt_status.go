package main

// Local MSI attempt evidence is intentionally read-only. A successful process
// exit is never treated as installed-product health; a lock or incomplete
// receipt requires human investigation. This command cannot clear evidence,
// consume a grant, execute a process, or authorize retries.
import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type msiAttemptStatus struct {
	Schema                 int                 `json:"schema"`
	PackageKey             string              `json:"packageKey"`
	State                  string              `json:"state"`
	HasReceipt             bool                `json:"hasReceipt"`
	LockPresent            bool                `json:"lockPresent"`
	AdmissionLockPresent   bool                `json:"admissionLockPresent"`
	ManualReviewRequired   bool                `json:"manualReviewRequired"`
	RetryAuthorized        bool                `json:"retryAuthorized"`
	ReadOnly               bool                `json:"readOnly"`
	OSAttested             bool                `json:"osAttested"`
	ReceiptSha256          string              `json:"receiptSha256,omitempty"`
	Attempt                *msiAttempt         `json:"attempt,omitempty"`
	Product                *msiProductState    `json:"product,omitempty"`
	StagedArtifactState    string              `json:"stagedArtifactState,omitempty"`
	StagedArtifactVerified bool                `json:"stagedArtifactVerified"`
	RecoveryAssessment     string              `json:"recoveryAssessment"`
	RequiresRebootReview   bool                `json:"requiresRebootReview"`
	BootObservation        *msiBootObservation `json:"bootObservation,omitempty"`
	RegistrationTransition string              `json:"registrationTransition,omitempty"`
	RegistrationDrift      string              `json:"registrationDrift,omitempty"`
}

func inspectMSIAttempt(root, key string) (msiAttemptStatus, error) {
	out := msiAttemptStatus{Schema: 1, PackageKey: key, State: "no_recorded_attempt",
		ReadOnly: true, OSAttested: false, RetryAuthorized: false, RecoveryAssessment: "no_receipt_unverified"}
	if !validPackageKey(key) {
		return out, errors.New("invalid MSI Package identity")
	}
	abs, err := filepath.Abs(root)
	if err != nil || root == "" {
		return out, errors.New("invalid MSI evidence root")
	}
	if _, statErr := os.Lstat(abs); os.IsNotExist(statErr) {
		return out, nil
	} else if statErr != nil {
		return out, statErr
	}
	if err = directoryNoLinks(abs); err != nil {
		return out, err
	}
	// Include the global admission lock in every per-Package inspection. A
	// crashed installer may never have written its Package receipt, and an
	// unrelated Package must not see that state as clean admission evidence.
	admissionLock := filepath.Join(abs, "msi-admission.lock")
	if info, lockErr := os.Lstat(admissionLock); lockErr == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return out, errors.New("unsafe MSI admission lock")
		}
		out.LockPresent = true
		out.AdmissionLockPresent = true
	} else if !os.IsNotExist(lockErr) {
		return out, lockErr
	}
	dir := filepath.Join(abs, "msi-attempts")
	if _, err = os.Lstat(dir); os.IsNotExist(err) {
		if out.LockPresent {
			out.State = "interrupted_or_active_without_receipt"
			out.ManualReviewRequired = true
			out.RecoveryAssessment = "operation_lock_without_receipt"
		}
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if err = directoryNoLinks(dir); err != nil {
		return out, err
	}
	lock := filepath.Join(dir, key+".lock")
	if info, lockErr := os.Lstat(lock); lockErr == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return out, errors.New("unsafe MSI operation lock")
		}
		out.LockPresent = true
	} else if !os.IsNotExist(lockErr) {
		return out, lockErr
	}
	path := filepath.Join(dir, key+".json")
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		if out.LockPresent {
			out.State = "interrupted_or_active_without_receipt"
			out.ManualReviewRequired = true
			out.RecoveryAssessment = "operation_lock_without_receipt"
		}
		return out, nil
	}
	if err != nil {
		return out, err
	}
	data, err := readStableMSIAttemptReceipt(path, info)
	if err != nil {
		return out, err
	}
	var receipt msiAttempt
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if dec.Decode(&receipt) != nil || dec.Decode(new(any)) != io.EOF || receipt.Schema != 1 ||
		receipt.PackageKey != key || receipt.OSAttested || !validDigest(receipt.ArtifactSha256) ||
		!validDigest(receipt.MSISha256) || !msiProductCodePattern.MatchString(receipt.ProductCode) ||
		!msiProductVersionPattern.MatchString(receipt.ProductVersion) || receipt.Version == "" ||
		receipt.StartedAt == "" || strings.TrimSpace(receipt.Version) != receipt.Version || len(receipt.Version) > 128 {
		return out, errors.New("invalid or corrupted MSI attempt receipt")
	}
	if _, err = time.Parse(time.RFC3339Nano, receipt.StartedAt); err != nil {
		return out, errors.New("invalid MSI receipt start time")
	}
	if receipt.MSIPath != "" && (!msiPathPattern.MatchString(receipt.MSIPath) || secureName(receipt.MSIPath) != nil) {
		return out, errors.New("invalid recorded MSI rollback source path")
	}
	if err := validateMSIRegistrationTransition(receipt); err != nil {
		return out, err
	}
	if !validMSIDependencyEvidence(receipt.Dependencies, key) {
		return out, errors.New("invalid MSI receipt dependency custody evidence")
	}
	if !validateMSIBootAnchor(receipt.BootAnchor, receipt.StartedAt) {
		return out, errors.New("invalid MSI receipt boot anchor; manual review required")
	}
	started, _ := time.Parse(time.RFC3339Nano, receipt.StartedAt)
	if receipt.LaunchCommittedAt != "" {
		launched, e := time.Parse(time.RFC3339Nano, receipt.LaunchCommittedAt)
		if e != nil || launched.Before(started) {
			return out, errors.New("MSI launch-commit timestamp is inconsistent")
		}
	}
	if receipt.FinishedAt != "" {
		finished, e := time.Parse(time.RFC3339Nano, receipt.FinishedAt)
		if e != nil || finished.Before(started) {
			return out, errors.New("MSI attempt timestamps are inconsistent")
		}
		if receipt.LaunchCommittedAt != "" {
			launched, _ := time.Parse(time.RFC3339Nano, receipt.LaunchCommittedAt)
			if finished.Before(launched) {
				return out, errors.New("MSI process exited before launch commitment")
			}
		}
	}
	switch receipt.State {
	case "msi_prepared_not_launched":
		if receipt.LaunchCommittedAt != "" || receipt.FinishedAt != "" || receipt.ExitCode != 0 {
			return out, errors.New("inconsistent pre-launch MSI receipt")
		}
	case "msi_started_outcome_unknown":
		if receipt.FinishedAt != "" || receipt.ExitCode != 0 {
			return out, errors.New("inconsistent active MSI receipt")
		}
	case "msi_failed_or_outcome_unknown", "msi_exit_zero_not_os_attested", "msi_restart_required_not_os_attested":
		if _, err = time.Parse(time.RFC3339Nano, receipt.FinishedAt); err != nil {
			return out, errors.New("invalid MSI receipt finish time")
		}
	default:
		return out, errors.New("invalid MSI receipt state")
	}
	if (receipt.State == "msi_exit_zero_not_os_attested" && receipt.ExitCode != 0) ||
		(receipt.State == "msi_restart_required_not_os_attested" && receipt.ExitCode != 3010) ||
		(receipt.State == "msi_failed_or_outcome_unknown" && (receipt.ExitCode == 0 || receipt.ExitCode == 3010)) {
		return out, errors.New("MSI process exit and receipt state conflict")
	}
	digest := sha256.Sum256(data)
	out.ReceiptSha256 = hex.EncodeToString(digest[:])
	out.HasReceipt = true
	out.ManualReviewRequired = true
	out.State = receipt.State
	out.Attempt = &receipt
	out.RegistrationTransition = classifyMSIRegistrationTransition(receipt)
	// Missing stage evidence is an observation, never permission to retry.
	out.StagedArtifactState = "staged_artifact_missing"
	stageRoot := filepath.Join(abs, "staged")
	stage := filepath.Join(stageRoot, receipt.ArtifactSha256)
	if err := directoryNoLinks(stageRoot); err == nil {
		if err := directoryNoLinks(stage); err == nil {
			// Signed MSI member path is not persisted in receipts. We can only
			// verify whether the pinned release stage still exists here.
			out.StagedArtifactState = "release_stage_present_unverified"
		} else if !os.IsNotExist(err) {
			out.StagedArtifactState = "release_stage_unsafe_or_unavailable"
		}
	} else if !os.IsNotExist(err) {
		out.StagedArtifactState = "release_stage_unsafe_or_unavailable"
	}
	product, firstOK := readMSIRegistrationForRecovery(receipt.ProductCode, receipt.ProductVersion)
	bootObservation := inspectMSIBootObservation(receipt)
	latestProduct, secondOK := readMSIRegistrationForRecovery(receipt.ProductCode, receipt.ProductVersion)
	if !sameMSIRegistrationObservation(product, latestProduct, firstOK, secondOK) {
		return out, errors.New("Windows Installer registration changed during MSI recovery inspection; retry read-only inspection")
	}
	out.Product = &product
	out.RegistrationDrift = classifyMSIRegistrationDrift(receipt, product)
	out.BootObservation = &bootObservation
	out.RecoveryAssessment, out.RequiresRebootReview = classifyMSIRecoveryAssessment(out.State, out.LockPresent, product.State)
	return out, nil
}

// Read the receipt from the opened file, not from a path looked up twice.
// A swapped symlink, replaced inode, concurrent writer, or oversized record
// is ambiguous forensic evidence and must not be interpreted as a clean state.
func readStableMSIAttemptReceipt(path string, initial os.FileInfo) ([]byte, error) {
	if !initial.Mode().IsRegular() || initial.Size() < 1 || initial.Size() > 4096 {
		return nil, errors.New("unsafe MSI attempt receipt")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(initial, opened) || opened.Size() != initial.Size() {
		return nil, errors.New("MSI attempt receipt changed before inspection")
	}
	data, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil {
		return nil, err
	}
	closed, err := file.Stat()
	if err != nil || !os.SameFile(opened, closed) || closed.Size() != opened.Size() ||
		!closed.ModTime().Equal(opened.ModTime()) || len(data) != int(initial.Size()) || len(data) > 4096 {
		return nil, errors.New("MSI attempt receipt changed during inspection")
	}
	current, err := os.Lstat(path)
	if err != nil || !current.Mode().IsRegular() || !os.SameFile(current, opened) || current.Size() != opened.Size() ||
		!current.ModTime().Equal(opened.ModTime()) {
		return nil, errors.New("MSI attempt receipt replaced during inspection")
	}
	return data, nil
}

// Correlate local receipt and Windows Installer registration without making
// either of them an authorization, an installation-health proof or a repair
// signal. A registered revision may predate this attempt entirely.
func classifyMSIRecoveryAssessment(attemptState string, lock bool, registration string) (string, bool) {
	if lock {
		return "operation_active_or_interrupted_manual_review", attemptState == "msi_restart_required_not_os_attested"
	}
	if attemptState == "msi_restart_required_not_os_attested" {
		return "restart_required_registration_unverified", true
	}
	if attemptState == "msi_prepared_not_launched" {
		return "prepared_without_launch_manual_review", false
	}
	if attemptState == "msi_started_outcome_unknown" {
		return "interrupted_or_active_manual_review", false
	}
	if attemptState == "msi_failed_or_outcome_unknown" {
		return "failed_or_unknown_manual_review", false
	}
	if registration == "registered_version_mismatch" {
		return "registered_version_conflicts_with_receipt", false
	}
	if registration == "registered_version_match" {
		return "registered_version_matches_not_health_attested", false
	}
	if registration == "not_registered_for_user" {
		return "not_registered_for_current_user", false
	}
	return "os_registration_unverified", false
}
