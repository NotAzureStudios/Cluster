package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
)

type msiRepairStatus struct {
	Schema               int                  `json:"schema"`
	PackageKey           string               `json:"packageKey"`
	State                string               `json:"state"`
	HasReceipt           bool                 `json:"hasReceipt"`
	ReadOnly             bool                 `json:"readOnly"`
	OSAttested           bool                 `json:"osAttested"`
	RetryAuthorized      bool                 `json:"retryAuthorized"`
	ManualReviewRequired bool                 `json:"manualReviewRequired"`
	ReceiptSha256        string               `json:"receiptSha256,omitempty"`
	Receipt              *msiRepairReceipt    `json:"receipt,omitempty"`
	UpgradeRecovery      *msiUpgradeRecovery  `json:"upgradeRecovery,omitempty"`
	RollbackRecovery     *msiRollbackRecovery `json:"rollbackRecovery,omitempty"`
}

func writeFirstMSIRepairReceipt(path string, value msiRepairReceipt) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	// An O_EXCL initial write cannot replace another operation's evidence.
	// A crashed or partially written first receipt remains an explicit hold.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errors.New("repair journal exists or cannot be created; manual review")
	}
	defer f.Close()
	if len(raw) > 4096 {
		return errors.New("repair journal too large")
	}
	n, err := f.Write(raw)
	if err != nil || n != len(raw) {
		return errors.New("repair journal write failed")
	}
	if err := f.Sync(); err != nil {
		return err
	}
	return syncMSICustodyParent(path)
}
func inspectMSIRepair(root, key string) (msiRepairStatus, error) {
	return inspectMSILifecycle(root, key, "repair")
}
func inspectMSIUpgrade(root, key string) (msiRepairStatus, error) {
	return inspectMSILifecycle(root, key, "upgrade")
}
func inspectMSIUninstall(root, key string) (msiRepairStatus, error) {
	return inspectMSILifecycle(root, key, "uninstall")
}
func inspectMSIRollback(root, key string) (msiRepairStatus, error) {
	return inspectMSILifecycle(root, key, "msi-rollback")
}
func inspectMSILifecycle(root, key, operation string) (msiRepairStatus, error) {
	out := msiRepairStatus{Schema: 1, PackageKey: key, State: "no_recorded_" + operation, ReadOnly: true, OSAttested: false, RetryAuthorized: false}
	if operation != "repair" && operation != "uninstall" && operation != "upgrade" && operation != "msi-rollback" {
		return out, errors.New("invalid lifecycle inspection operation")
	}
	if !validPackageKey(key) || root == "" {
		return out, errors.New("invalid MSI repair inspection identity")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return out, err
	}
	if _, err := os.Lstat(abs); os.IsNotExist(err) {
		return out, nil
	} else if err != nil {
		return out, err
	}
	if err = directoryNoLinks(abs); err != nil {
		return out, err
	}
	dir := filepath.Join(abs, "msi-lifecycle")
	if _, err = os.Lstat(dir); os.IsNotExist(err) {
		return out, nil
	} else if err != nil {
		return out, err
	}
	if err = directoryNoLinks(dir); err != nil {
		return out, err
	}
	name := key + ".json"
	if operation == "msi-rollback" {
		name = "rollback_" + key + ".json"
	}
	path := filepath.Join(dir, name)
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	raw, err := readStableMSIAttemptReceipt(path, info)
	if err != nil {
		return out, err
	}
	var receipt msiRepairReceipt
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&receipt) != nil || decoder.Decode(new(any)) != io.EOF || receipt.Schema != 1 || receipt.Operation != operation || receipt.PackageKey != key ||
		!validDigest(receipt.PriorReceiptSha256) || !validDigest(receipt.ArtifactSha256) || !validDigest(receipt.MSISha256) ||
		!msiProductCodePattern.MatchString(receipt.ProductCode) || !msiProductVersionPattern.MatchString(receipt.ProductVersion) ||
		!dependencyVersionPattern.MatchString(receipt.Version) || receipt.OSAttested ||
		(receipt.MSIPath != "" && (!msiPathPattern.MatchString(receipt.MSIPath) || secureName(receipt.MSIPath) != nil)) ||
		(receipt.Operation != "upgrade" && receipt.Operation != "msi-rollback" && receipt.MSIPath != "") ||
		((receipt.Operation == "upgrade" || receipt.Operation == "msi-rollback") && (!validDigest(receipt.PriorMSISha256) || !msiProductVersionPattern.MatchString(receipt.PriorProductVersion) ||
			receipt.PriorProductVersion == receipt.ProductVersion)) ||
		(receipt.Operation != "upgrade" && receipt.Operation != "msi-rollback" && (receipt.PriorMSISha256 != "" || receipt.PriorProductVersion != "")) ||
		(receipt.Operation == "msi-rollback" && (!validDigest(receipt.UpgradeJournalSha256) || !validDigest(receipt.SuccessorMSISha256) || receipt.MSIPath == "" || receipt.MSISha256 != receipt.PriorMSISha256 || receipt.SuccessorMSISha256 == receipt.MSISha256)) ||
		(receipt.Operation != "msi-rollback" && (receipt.UpgradeJournalSha256 != "" || receipt.SuccessorMSISha256 != "")) {
		return out, errors.New("invalid durable MSI repair record")
	}
	if receipt.Operation == "upgrade" || receipt.Operation == "msi-rollback" {
		before, after := receipt.PriorProductVersion, receipt.ProductVersion
		if receipt.Operation == "msi-rollback" {
			before, after = after, before
		}
		if _, e := compareMSIVersions(before, after); e != nil {
			return out, errors.New("invalid signed successor version sequence in upgrade journal")
		}
	}
	start, e := time.Parse(time.RFC3339Nano, receipt.StartedAt)
	if e != nil {
		return out, errors.New("invalid repair time")
	}
	if receipt.LaunchCommittedAt != "" {
		launch, e := time.Parse(time.RFC3339Nano, receipt.LaunchCommittedAt)
		if e != nil || launch.Before(start) {
			return out, errors.New("invalid repair launch time")
		}
	}
	if receipt.FinishedAt != "" {
		finish, e := time.Parse(time.RFC3339Nano, receipt.FinishedAt)
		if e != nil || finish.Before(start) {
			return out, errors.New("invalid repair finish time")
		}
	}
	switch receipt.State {
	case operation + "_prepared_not_launched":
		if receipt.LaunchCommittedAt != "" || receipt.FinishedAt != "" || receipt.ExitCode != 0 {
			return out, errors.New("inconsistent prepared repair")
		}
	case operation + "_started_outcome_unknown":
		if receipt.LaunchCommittedAt == "" || receipt.FinishedAt != "" || receipt.ExitCode != 0 {
			return out, errors.New("inconsistent started repair")
		}
	case operation + "_failed_or_outcome_unknown", operation + "_exit_zero_not_os_attested", operation + "_restart_required_not_os_attested":
		if receipt.LaunchCommittedAt == "" || receipt.FinishedAt == "" {
			return out, errors.New("incomplete completed repair")
		}
		launched, _ := time.Parse(time.RFC3339Nano, receipt.LaunchCommittedAt)
		finished, _ := time.Parse(time.RFC3339Nano, receipt.FinishedAt)
		if finished.Before(launched) || (receipt.State == operation+"_exit_zero_not_os_attested" && receipt.ExitCode != 0) ||
			(receipt.State == operation+"_restart_required_not_os_attested" && receipt.ExitCode != 3010) {
			return out, errors.New("contradictory completed repair")
		}
	default:
		return out, errors.New("unknown repair state")
	}
	digest := sha256.Sum256(raw)
	out.State = receipt.State
	out.HasReceipt = true
	out.ManualReviewRequired = true
	out.ReceiptSha256 = hex.EncodeToString(digest[:])
	out.Receipt = &receipt
	if operation == "msi-rollback" {
		first, okA := readMSIRegistrationForRecovery(receipt.ProductCode, receipt.ProductVersion)
		second, okB := readMSIRegistrationForRecovery(receipt.ProductCode, receipt.ProductVersion)
		if !sameMSIRegistrationObservation(first, second, okA, okB) {
			return out, errors.New("MSI rollback registration changed during read-only recovery")
		}
		recovery, e := classifyMSIRollbackRecovery(receipt, first, okA)
		if e != nil {
			return out, e
		}
		out.RollbackRecovery = &recovery
	}
	if operation == "upgrade" {
		first, okA := readMSIRegistrationForRecovery(receipt.ProductCode, receipt.ProductVersion)
		second, okB := readMSIRegistrationForRecovery(receipt.ProductCode, receipt.ProductVersion)
		if !sameMSIRegistrationObservation(first, second, okA, okB) {
			return out, errors.New("MSI upgrade product registration changed during read-only recovery")
		}
		recovery, err := classifyMSIUpgradeRecovery(receipt, first, okA)
		if err != nil {
			return out, err
		}
		out.UpgradeRecovery = &recovery
	}
	return out, nil
}
