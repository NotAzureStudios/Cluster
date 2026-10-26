package main

// Read-only, profile-wide MSI incident worklist.  This is not an executable
// recovery queue: the stable receipt identity is evidence, not a replay token.
import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
)

type msiIncidentItem struct {
	CaseID              string `json:"caseId"`
	PackageKey          string `json:"packageKey"`
	Operation           string `json:"operation"`
	State               string `json:"state"`
	ReceiptSha256       string `json:"receiptSha256"`
	PriorReceiptSha256  string `json:"priorReceiptSha256"`
	PredecessorRecorded bool   `json:"predecessorRecorded"`
	PredecessorMatches  bool   `json:"predecessorMatches"`
	RegistrationState   string `json:"registrationState"`
	Severity            string `json:"severity"`
	RecoveryAction      string `json:"recoveryAction"`
	ReadOnly            bool   `json:"readOnly"`
	RetryAuthorized     bool   `json:"retryAuthorized"`
	MutationAuthorized  bool   `json:"mutationAuthorized"`
	OSAttested          bool   `json:"osAttested"`
}

type msiIncidentWorklist struct {
	Schema               int               `json:"schema"`
	State                string            `json:"state"`
	ReadOnly             bool              `json:"readOnly"`
	Complete             bool              `json:"complete"`
	OSAttested           bool              `json:"osAttested"`
	MutationAuthorized   bool              `json:"mutationAuthorized"`
	RetryAuthorized      bool              `json:"retryAuthorized"`
	AdmissionLockPresent bool              `json:"admissionLockPresent"`
	ManualRecoveryCount  int               `json:"manualRecoveryCount"`
	ReviewCount          int               `json:"reviewCount"`
	ObservationCount     int               `json:"observationCount"`
	Items                []msiIncidentItem `json:"items"`
}

func planMSIIncidentWorklist(profile msiProfileStatus) (msiIncidentWorklist, error) {
	out := msiIncidentWorklist{Schema: 1, State: "empty", ReadOnly: true, Complete: true, Items: []msiIncidentItem{}}
	if profile.Schema != 1 || !profile.ReadOnly || !profile.Complete || profile.OSAttested || profile.RetryAuthorized || profile.LifecycleMutationAuthorized ||
		len(profile.Records) > maxMSIProfileEntries || len(profile.LifecycleRecords) > maxMSIProfileEntries {
		return msiIncidentWorklist{}, errors.New("MSI incident worklist requires complete read-only profile")
	}
	out.AdmissionLockPresent = profile.AdmissionLockPresent
	originals := make(map[string]msiAttemptStatus, len(profile.Records))
	seen := make(map[string]bool, len(profile.Records)+len(profile.LifecycleRecords))
	for _, record := range profile.Records {
		if !validPackageKey(record.PackageKey) || seen["attempt:"+record.PackageKey] || !record.ReadOnly || record.OSAttested || record.RetryAuthorized ||
			record.AdmissionLockPresent != profile.AdmissionLockPresent || (!record.HasReceipt && !record.LockPresent) ||
			(record.HasReceipt && (!validDigest(record.ReceiptSha256) || record.Attempt == nil || record.Attempt.PackageKey != record.PackageKey)) {
			return msiIncidentWorklist{}, errors.New("invalid MSI attempt in incident inventory")
		}
		seen["attempt:"+record.PackageKey] = true
		originals[record.PackageKey] = record
		item := msiIncidentItem{CaseID: "attempt:" + record.PackageKey, PackageKey: record.PackageKey, Operation: "install", State: record.State,
			ReceiptSha256: record.ReceiptSha256, ReadOnly: true, RegistrationState: "unavailable", Severity: "review", RecoveryAction: "review_unattested_installation"}
		if record.Product != nil {
			item.RegistrationState = record.Product.State
		}
		if record.LockPresent || !record.HasReceipt || record.State == "msi_prepared_not_launched" || record.State == "msi_started_outcome_unknown" ||
			record.State == "msi_failed_or_outcome_unknown" || record.RegistrationDrift == "registration_changed_since_exit" {
			item.Severity = "manual_recovery"
			item.RecoveryAction = "investigate_install_attempt_no_replay"
		}
		out.Items = append(out.Items, item)
	}
	for _, status := range profile.LifecycleRecords {
		if status.Receipt == nil || !status.HasReceipt || !status.ReadOnly || status.OSAttested || status.RetryAuthorized ||
			!status.ManualReviewRequired || !validDigest(status.ReceiptSha256) || !validPackageKey(status.PackageKey) ||
			status.Receipt.PackageKey != status.PackageKey || status.State != status.Receipt.State ||
			(status.Receipt.Operation != "upgrade" && status.Receipt.Operation != "repair" && status.Receipt.Operation != "uninstall" && status.Receipt.Operation != "msi-rollback") ||
			!validDigest(status.Receipt.PriorReceiptSha256) {
			return msiIncidentWorklist{}, errors.New("invalid lifecycle record in MSI incident inventory")
		}
		id := "lifecycle:" + status.PackageKey + ":" + status.Receipt.Operation
		if seen[id] {
			return msiIncidentWorklist{}, errors.New("duplicate MSI lifecycle incident")
		}
		seen[id] = true
		original, recorded := originals[status.PackageKey]
		matched := recorded && original.HasReceipt && original.ReceiptSha256 == status.Receipt.PriorReceiptSha256
		item := msiIncidentItem{CaseID: id, PackageKey: status.PackageKey, Operation: status.Receipt.Operation, State: status.State,
			ReceiptSha256: status.ReceiptSha256, PriorReceiptSha256: status.Receipt.PriorReceiptSha256,
			PredecessorRecorded: recorded && original.HasReceipt, PredecessorMatches: matched,
			RegistrationState: "unavailable", Severity: "manual_recovery", RecoveryAction: "manual_lifecycle_review_no_replay", ReadOnly: true}
		if original.Product != nil {
			item.RegistrationState = original.Product.State
		}
		if !matched {
			item.RecoveryAction = "investigate_missing_or_changed_predecessor"
		}
		out.Items = append(out.Items, item)
	}
	sort.Slice(out.Items, func(i, j int) bool { return out.Items[i].CaseID < out.Items[j].CaseID })
	if len(out.Items) > 2*maxMSIProfileEntries {
		return msiIncidentWorklist{}, errors.New("MSI incident count exceeds bound")
	}
	for _, item := range out.Items {
		switch item.Severity {
		case "manual_recovery":
			out.ManualRecoveryCount++
		case "review":
			out.ReviewCount++
		case "observation":
			out.ObservationCount++
		default:
			return msiIncidentWorklist{}, fmt.Errorf("unrecognized MSI incident severity %q", item.Severity)
		}
	}
	if out.ManualRecoveryCount > 0 || profile.AdmissionLockPresent {
		out.State = "manual_recovery_required"
	} else if out.ReviewCount > 0 {
		out.State = "review_required"
	}
	return out, nil
}

func inspectMSIIncidentWorklist(root string) (msiIncidentWorklist, error) {
	if root == "" {
		return msiIncidentWorklist{}, errors.New("missing private MSI profile root")
	}
	abs, e := filepath.Abs(root)
	if e != nil {
		return msiIncidentWorklist{}, e
	}
	profile, e := inspectMSIProfile(abs)
	if e != nil {
		return msiIncidentWorklist{}, e
	}
	return planMSIIncidentWorklist(profile)
}
