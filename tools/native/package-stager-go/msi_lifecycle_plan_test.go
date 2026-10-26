package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func includesBlocker(p msiLifecyclePlan, code string) bool {
	for _, found := range p.Blockers {
		if found == code {
			return true
		}
	}
	return false
}
func TestMSILifecycleNoRecordsAndLocks(t *testing.T) {
	plans, err := planMSILifecycle(nil, nil, false)
	if err != nil || len(plans) != 0 {
		t.Fatalf("empty plan: %+v %v", plans, err)
	}
	incomplete := msiAttemptStatus{PackageKey: "broken-package", LockPresent: true, State: "interrupted_or_active_without_receipt"}
	plans, err = planMSILifecycle([]msiAttemptStatus{incomplete}, nil, true)
	if err != nil || len(plans) != 3 {
		t.Fatalf("locked plan: %+v %v", plans, err)
	}
	for _, p := range plans {
		if p.State != "blocked" || p.MutationAuthorized || !p.ReadOnly || p.OSAttested || !includesBlocker(p, "profile_installation_lock_present") || !includesBlocker(p, "trusted_installation_receipt_missing") {
			t.Fatalf("unsafe lock planning: %+v", p)
		}
	}
}
func TestMSILifecycleExactRegisteredReceiptNeverAuthorizesMutation(t *testing.T) {
	base := sampleInstalledDependencyStatus("editor-core", "2.0.0")
	plans, e := planMSILifecycle([]msiAttemptStatus{base}, nil, false)
	if e != nil || len(plans) != 3 {
		t.Fatalf("plan refused: %v %+v", e, plans)
	}
	for i, op := range []string{"upgrade", "repair", "uninstall"} {
		p := plans[i]
		if p.Operation != op || p.State != "requires_operator_review" || p.MutationAuthorized || p.OSAttested || !p.ReadOnly || len(p.Blockers) != 0 || p.RecordedReceiptSha256 != base.ReceiptSha256 || len(p.Warnings) < 3 {
			t.Fatalf("untruthful review outcome: %+v", p)
		}
	}
	base.RegistrationDrift = "registration_changed_since_exit"
	plans, e = planMSILifecycle([]msiAttemptStatus{base}, nil, false)
	if e != nil || !includesBlocker(plans[0], "exact_windows_registration_not_verified") {
		t.Fatalf("registration drift authorized: %v %+v", e, plans)
	}
	base = sampleInstalledDependencyStatus("editor-core", "2.0.0")
	base.State = "msi_started_outcome_unknown"
	plans, e = planMSILifecycle([]msiAttemptStatus{base}, nil, false)
	if e != nil || !includesBlocker(plans[0], "installation_attempt_unresolved") {
		t.Fatalf("interrupted attempt authorized: %v %+v", e, plans)
	}
}
func TestMSILifecycleDependencyImpactAndEvidenceDrift(t *testing.T) {
	dep := sampleInstalledDependencyStatus("editor-core", "2.0.0")
	owner := sampleInstalledDependencyStatus("project-editor", "3.0.0")
	owner.Attempt.Dependencies = []msiDependencyEvidence{{PackageKey: dep.PackageKey, Version: dep.Attempt.Version, ProductCode: dep.Attempt.ProductCode, ProductVersion: dep.Attempt.ProductVersion, ReceiptSha256: dep.ReceiptSha256}}
	records := []msiAttemptStatus{dep, owner}
	edges, e := knownMSIDependencyEdges(records)
	if e != nil {
		t.Fatal(e)
	}
	plans, e := planMSILifecycle(records, edges, false)
	if e != nil || len(plans) != 6 {
		t.Fatalf("graph plan: %v %+v", e, plans)
	}
	for _, p := range plans[:3] {
		if !includesBlocker(p, "known_dependent_packages_present") || len(p.KnownDependents) != 1 || p.KnownDependents[0] != owner.PackageKey {
			t.Fatalf("dependent unprotected: %+v", p)
		}
	}
	if includesBlocker(plans[3], "known_dependent_packages_present") {
		t.Fatalf("wrong inverse dependent %+v", plans[3])
	}
	edges[0].RecordedReceiptMatches = false
	if _, e = planMSILifecycle(records, edges, false); e == nil {
		t.Fatal("forged graph accepted")
	}
	dep.ReceiptSha256 = strings.Repeat("d", 64)
	records = []msiAttemptStatus{dep, owner}
	edges, e = knownMSIDependencyEdges(records)
	plans, e = planMSILifecycle(records, edges, false)
	if e != nil || !includesBlocker(plans[0], "recorded_prerequisite_evidence_changed") || !includesBlocker(plans[3], "recorded_prerequisite_evidence_changed") {
		t.Fatalf("dependency change suppressed %v %+v", e, plans)
	}
}
func TestMSILifecycleRejectsDuplicateReceiptsAndUnknownEdges(t *testing.T) {
	item := sampleInstalledDependencyStatus("editor-core", "2.0.0")
	if _, err := planMSILifecycle([]msiAttemptStatus{item, item}, nil, false); err == nil {
		t.Fatal("duplicate accepted")
	}
	if _, err := planMSILifecycle([]msiAttemptStatus{item}, []msiDependencyEdge{{DependentPackageKey: item.PackageKey, DependencyPackageKey: "unknown-package"}}, false); err == nil {
		t.Fatal("foreign edge accepted")
	}
}

func TestMSILifecyclePlanBoundedDenseProfileAndStableJSON(t *testing.T) {
	records := make([]msiAttemptStatus, 0, maxMSIProfileEntries)
	for i := 0; i < maxMSIProfileEntries; i++ {
		key := fmt.Sprintf("package-%03d", i)
		record := sampleInstalledDependencyStatus(key, "2.0.0")
		records = append(records, record)
	}
	plans, err := planMSILifecycle(records, nil, false)
	if err != nil || len(plans) != maxMSILifecyclePlans {
		t.Fatalf("max profile could not be planned: %v %d", err, len(plans))
	}
	result := msiProfileStatus{Schema: 1, Complete: true, Records: records, LifecyclePlans: plans, DependencyEdges: []msiDependencyEdge{}}
	encoded, err := json.Marshal(result)
	if err != nil || len(encoded) > 768*1024 {
		t.Fatalf("native max inventory violates Qt output bound: %v bytes=%d", err, len(encoded))
	}
	for i := 0; i < len(plans); i++ {
		if plans[i].MutationAuthorized || plans[i].OSAttested {
			t.Fatal("review plan authorized a mutation")
		}
	}
	records = append(records, sampleInstalledDependencyStatus("overflow-package", "1.0.0"))
	if _, err := planMSILifecycle(records, nil, false); err == nil {
		t.Fatal("oversize profile admitted")
	}
}
