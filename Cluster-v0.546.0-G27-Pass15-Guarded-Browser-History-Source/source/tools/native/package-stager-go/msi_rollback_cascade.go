package main

// An operator's dependents-first MSI recovery workbook. It does not issue
// authority, carry grants, or execute any step. Every dependent needs its own
// independently approved, supervised disposition before a target rollback.
import (
	"errors"
	"path/filepath"
)

type msiRollbackCascadeStep struct {
	Index                         int      `json:"index"`
	PackageKey                    string   `json:"packageKey"`
	Operation                     string   `json:"operation"`
	State                         string   `json:"state"`
	RecordedReceiptSha256         string   `json:"recordedReceiptSha256"`
	WaitingFor                    []string `json:"waitingFor"`
	Blockers                      []string `json:"blockers"`
	SeparateAuthorizationRequired bool     `json:"separateAuthorizationRequired"`
	DispositionObserved           bool     `json:"dispositionObserved"`
	LifecycleJournalSha256        string   `json:"lifecycleJournalSha256"`
	LifecycleJournalState         string   `json:"lifecycleJournalState"`
	RecoveryAction                string   `json:"recoveryAction"`
	MutationAuthorized            bool     `json:"mutationAuthorized"`
}

type msiRollbackCascade struct {
	Schema                   int                      `json:"schema"`
	PackageKey               string                   `json:"packageKey"`
	State                    string                   `json:"state"`
	ReadOnly                 bool                     `json:"readOnly"`
	OSAttested               bool                     `json:"osAttested"`
	MutationAuthorized       bool                     `json:"mutationAuthorized"`
	AutomaticExecution       bool                     `json:"automaticExecution"`
	PriorReceiptSha256       string                   `json:"priorReceiptSha256"`
	UpgradeJournalSha256     string                   `json:"upgradeJournalSha256"`
	RecoveryOrder            []string                 `json:"recoveryOrder"`
	Steps                    []msiRollbackCascadeStep `json:"steps"`
	ManualRecoveryRequired   bool                     `json:"manualRecoveryRequired"`
	ManualReviewPackages     []string                 `json:"manualReviewPackages"`
	NextReviewablePackageKey string                   `json:"nextReviewablePackageKey"`
	Blockers                 []string                 `json:"blockers"`
	Warnings                 []string                 `json:"warnings"`
}

func planMSIRollbackCascadeWithProfile(root, key string, profile msiProfileStatus, verify func(string, string) error) (msiRollbackCascade, error) {
	out := msiRollbackCascade{Schema: 1, PackageKey: key, State: "blocked", ReadOnly: true,
		RecoveryOrder: []string{}, Steps: []msiRollbackCascadeStep{}, ManualReviewPackages: []string{}, Blockers: []string{},
		Warnings: []string{"unknown_external_dependents_not_excluded", "separate_signed_grant_required_per_package",
			"no_automatic_cascade_or_retry", "windows_and_application_health_not_attested"}}
	if !profile.Complete || !profile.ReadOnly || profile.OSAttested || profile.AdmissionLockPresent ||
		profile.RetryAuthorized || profile.LifecycleMutationAuthorized || !validPackageKey(key) || verify == nil {
		return out, errors.New("cascade requires complete unlocked read-only profile")
	}
	// The exact rollback review is the sole source of the target's custody
	// decision. A foreign lifecycle journal or forged rollback source fails.
	rollback, err := reviewMSIRollbackWithProfile(root, key, profile, verify)
	if err != nil {
		return out, err
	}
	if len(rollback.RecoveryOrder) == 0 || len(rollback.RecoveryOrder) > maxMSIProfileEntries ||
		rollback.RecoveryOrder[len(rollback.RecoveryOrder)-1] != key || !validDigest(rollback.PriorReceiptSha256) ||
		!validDigest(rollback.UpgradeJournalSha256) || len(rollback.RecoveryOrder) != len(rollback.KnownDependents)+1 {
		return out, errors.New("cascade rollback identity incomplete")
	}
	out.PriorReceiptSha256, out.UpgradeJournalSha256 = rollback.PriorReceiptSha256, rollback.UpgradeJournalSha256
	out.RecoveryOrder = append(out.RecoveryOrder, rollback.RecoveryOrder...)
	lifecycle, err := planMSILifecycle(profile.Records, profile.DependencyEdges, false)
	if err != nil {
		return out, err
	}
	uninstall := map[string]msiLifecyclePlan{}
	for _, p := range lifecycle {
		if p.Operation == "uninstall" {
			uninstall[p.PackageKey] = p
		}
	}
	settled := make(map[string]bool, len(rollback.SettledDependents))
	for _, packageKey := range rollback.SettledDependents {
		settled[packageKey] = true
	}
	// Use only the coherently sampled, exact profile journals.  Never infer a
	// repair/retry path from an absent, unreadable, or terminal journal.
	lifecycleByKey := make(map[string]msiRepairStatus, len(profile.LifecycleRecords))
	for _, held := range profile.LifecycleRecords {
		if _, exists := lifecycleByKey[held.PackageKey]; exists {
			return out, errors.New("duplicate lifecycle journal in recovery workflow")
		}
		lifecycleByKey[held.PackageKey] = held
	}
	allPriorSettled := true
	for i, packageKey := range out.RecoveryOrder {
		step := msiRollbackCascadeStep{Index: i, PackageKey: packageKey, Operation: "uninstall", State: "blocked",
			WaitingFor: append([]string{}, out.RecoveryOrder[:i]...), Blockers: []string{}, SeparateAuthorizationRequired: true,
			LifecycleJournalState: "not_recorded"}
		if packageKey == key {
			step.Operation = "msi-rollback"
			step.RecordedReceiptSha256 = rollback.PriorReceiptSha256
			for _, reason := range rollback.Blockers {
				if reason != "dependent_packages_require_separate_ordered_disposition" {
					step.Blockers = append(step.Blockers, reason)
				}
			}
		} else {
			p, ok := uninstall[packageKey]
			if !ok || !validDigest(p.RecordedReceiptSha256) || !p.ReadOnly || p.MutationAuthorized || p.OSAttested {
				return out, errors.New("dependent uninstall evidence unavailable")
			}
			step.RecordedReceiptSha256 = p.RecordedReceiptSha256
			step.DispositionObserved = settled[packageKey]
			if held, exists := lifecycleByKey[packageKey]; exists {
				if !held.HasReceipt || held.Receipt == nil || !validDigest(held.ReceiptSha256) ||
					held.Receipt.Operation != "uninstall" || held.Receipt.PackageKey != packageKey || held.Receipt.State != held.State ||
					!held.ReadOnly || held.OSAttested || held.RetryAuthorized || !held.ManualReviewRequired {
					return out, errors.New("dependent lifecycle incident lacks stable read-only journal")
				}
				switch held.State {
				case "uninstall_prepared_not_launched", "uninstall_started_outcome_unknown",
					"uninstall_failed_or_outcome_unknown", "uninstall_exit_zero_not_os_attested",
					"uninstall_restart_required_not_os_attested":
				default:
					return out, errors.New("unknown dependent uninstall lifecycle state")
				}
				step.LifecycleJournalSha256 = held.ReceiptSha256
				step.LifecycleJournalState = held.State
				if !step.DispositionObserved {
					out.ManualReviewPackages = append(out.ManualReviewPackages, packageKey)
				}
			}
			if !step.DispositionObserved {
				for _, reason := range p.Blockers {
					if reason != "known_dependent_packages_present" {
						step.Blockers = append(step.Blockers, reason)
					}
				}
				// Once a journal exists, no further uninstall is replayable
				// without explicit outside/manual recovery. Do not offer
				// another authorized attempt on a stale receipt.
				if step.LifecycleJournalSha256 != "" {
					step.Blockers = append(step.Blockers, "dependent_lifecycle_outcome_unconfirmed")
				}
			}
		}
		// A later operation cannot begin before separate supervised
		// dispositions for each preceding Package are completed and re-probed.
		if step.DispositionObserved {
			step.State = "observed_uninstall_registration_absent"
			step.RecoveryAction = "preserve_completed_disposition"
		} else if len(step.Blockers) == 0 {
			if allPriorSettled {
				step.State = "independent_operator_review_required"
				step.RecoveryAction = "request_independent_authorization"
				if out.NextReviewablePackageKey != "" {
					return out, errors.New("multiple concurrent recovery steps are reviewable")
				}
				out.NextReviewablePackageKey = packageKey
			} else {
				step.State = "awaiting_prior_dispositions"
				step.RecoveryAction = "wait_for_independent_dispositions"
			}
		} else {
			if step.LifecycleJournalSha256 != "" {
				step.RecoveryAction = "manual_recovery_no_replay"
			} else {
				step.RecoveryAction = "resolve_evidence_blocker"
			}
			out.Blockers = append(out.Blockers, packageKey+":review_blocked")
		}
		out.Steps = append(out.Steps, step)
		if packageKey != key && !step.DispositionObserved {
			allPriorSettled = false
		}
	}
	out.ManualRecoveryRequired = len(out.ManualReviewPackages) > 0
	if len(out.Blockers) == 0 {
		out.State = "independent_dispositions_required"
	}
	return out, nil
}

func inspectMSIRollbackCascade(root, key string) (msiRollbackCascade, error) {
	if root == "" || !validPackageKey(key) {
		return msiRollbackCascade{}, errors.New("invalid rollback cascade identity")
	}
	abs, err := filepath.Abs(root)
	if err != nil || directoryNoLinks(abs) != nil {
		return msiRollbackCascade{}, errors.New("unsafe rollback cascade root")
	}
	profile, err := inspectMSIProfile(abs)
	if err != nil {
		return msiRollbackCascade{}, err
	}
	return planMSIRollbackCascadeWithProfile(abs, key, profile, verifyRegularDigest)
}
