package main

// Lifecycle planning is a deterministic, non-authorizing projection of a
// coherent read-only profile inventory. This is not an executable plan: a
// signed operation-specific grant, OS scope policy, dependency protection,
// rollback custody and Windows certification must independently gate mutations.
import (
	"errors"
	"sort"
)

type msiLifecyclePlan struct {
	Schema                int      `json:"schema"`
	PackageKey            string   `json:"packageKey"`
	Operation             string   `json:"operation"`
	State                 string   `json:"state"`
	ReadOnly              bool     `json:"readOnly"`
	OSAttested            bool     `json:"osAttested"`
	MutationAuthorized    bool     `json:"mutationAuthorized"`
	RecordedReceiptSha256 string   `json:"recordedReceiptSha256,omitempty"`
	KnownDependents       []string `json:"knownDependents"`
	Blockers              []string `json:"blockers"`
	Warnings              []string `json:"warnings"`
}

const maxMSILifecyclePlans = maxMSIProfileEntries * 3

func planMSILifecycle(records []msiAttemptStatus, edges []msiDependencyEdge, admissionLock bool) ([]msiLifecyclePlan, error) {
	if len(records) > maxMSIProfileEntries || len(edges) > maxMSIProfileDependencyEdges {
		return nil, errors.New("MSI lifecycle profile exceeds bounded review")
	}
	byKey := map[string]msiAttemptStatus{}
	for _, rec := range records {
		if !validPackageKey(rec.PackageKey) || byKey[rec.PackageKey].PackageKey != "" {
			return nil, errors.New("duplicate or invalid lifecycle Package identity")
		}
		byKey[rec.PackageKey] = rec
	}
	// Refuse a graph that does not exactly represent those receipts.
	expected, err := knownMSIDependencyEdges(records)
	if err != nil || len(expected) != len(edges) {
		return nil, errors.New("MSI lifecycle dependency graph inconsistent")
	}
	for i := range expected {
		if expected[i] != edges[i] {
			return nil, errors.New("MSI lifecycle dependency edge inconsistent")
		}
	}
	dependentKeys := map[string][]string{}
	graphChanged := map[string]bool{}
	for _, edge := range edges {
		if _, ok := byKey[edge.DependencyPackageKey]; ok {
			dependentKeys[edge.DependencyPackageKey] = append(dependentKeys[edge.DependencyPackageKey], edge.DependentPackageKey)
		}
		if !edge.RecordedReceiptMatches {
			graphChanged[edge.DependentPackageKey] = true
			graphChanged[edge.DependencyPackageKey] = true
		}
	}
	out := make([]msiLifecyclePlan, 0, len(records)*3)
	for _, rec := range records {
		dependents := append([]string{}, dependentKeys[rec.PackageKey]...)
		sort.Strings(dependents)
		// Multiple edges for the same owner are invalid in the signed
		// dependency contract; keep the UI output deterministic anyway.
		dedup := dependents[:0]
		for _, key := range dependents {
			if len(dedup) == 0 || dedup[len(dedup)-1] != key {
				dedup = append(dedup, key)
			}
		}
		for _, op := range []string{"upgrade", "repair", "uninstall"} {
			p := msiLifecyclePlan{Schema: 1, PackageKey: rec.PackageKey, Operation: op,
				State: "requires_operator_review", ReadOnly: true, OSAttested: false,
				MutationAuthorized: false, KnownDependents: append([]string{}, dedup...),
				Blockers: []string{}, Warnings: []string{"unknown_external_dependents_not_excluded", "installed_application_health_unverified", "independent_lifecycle_authority_not_implemented"}}
			if rec.HasReceipt {
				p.RecordedReceiptSha256 = rec.ReceiptSha256
			}
			if admissionLock || rec.AdmissionLockPresent {
				p.Blockers = append(p.Blockers, "profile_installation_lock_present")
			}
			if rec.LockPresent && !rec.AdmissionLockPresent {
				p.Blockers = append(p.Blockers, "package_operation_lock_present")
			}
			if !rec.HasReceipt || rec.Attempt == nil || !validDigest(rec.ReceiptSha256) {
				p.Blockers = append(p.Blockers, "trusted_installation_receipt_missing")
			} else {
				if rec.State != "msi_exit_zero_not_os_attested" && rec.State != "msi_restart_required_not_os_attested" {
					p.Blockers = append(p.Blockers, "installation_attempt_unresolved")
				}
				if rec.Attempt.PreLaunchRegistration == nil || rec.Attempt.PostExitRegistration == nil {
					p.Blockers = append(p.Blockers, "registration_transition_unavailable")
				}
			}
			if rec.Product == nil || rec.Product.State != "registered_version_match" || !rec.Product.VersionMatches ||
				!rec.Product.ProbeComplete || rec.Product.ProbeScope != "current_user_and_machine" ||
				rec.RegistrationDrift != "registration_unchanged_since_exit" {
				p.Blockers = append(p.Blockers, "exact_windows_registration_not_verified")
			}
			if graphChanged[rec.PackageKey] {
				p.Blockers = append(p.Blockers, "recorded_prerequisite_evidence_changed")
			}
			if len(dedup) > 0 {
				p.Blockers = append(p.Blockers, "known_dependent_packages_present")
			}
			if len(p.Blockers) > 0 {
				p.State = "blocked"
			}
			out = append(out, p)
		}
	}
	if len(out) > maxMSILifecyclePlans {
		return nil, errors.New("MSI lifecycle plan exceeds bound")
	}
	return out, nil
}
