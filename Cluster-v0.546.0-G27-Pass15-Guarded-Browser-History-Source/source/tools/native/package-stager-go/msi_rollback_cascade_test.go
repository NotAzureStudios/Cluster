package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func distinctCascadeStatus(key, version string, n int) msiAttemptStatus {
	r := sampleInstalledDependencyStatus(key, version)
	code := fmt.Sprintf("{%08X-1234-ABCD-ABCD-1234567890AB}", n)
	r.Attempt.ProductCode = code
	r.Attempt.PreLaunchRegistration.ProductCode = code
	r.Attempt.PostExitRegistration.ProductCode = code
	r.Product.ProductCode = code
	r.ReceiptSha256 = fmt.Sprintf("%064x", n+500)
	return r
}
func cascadeFixture(t *testing.T) (msiProfileStatus, string) {
	t.Helper()
	p, key := rollbackReviewFixture()
	core := p.Records[0]
	editor := distinctCascadeStatus("studio-editor", "2.0.0", 1)
	project := distinctCascadeStatus("studio-project", "3.0.0", 2)
	editor.Attempt.Dependencies = []msiDependencyEvidence{{PackageKey: key, Version: core.Attempt.Version, ProductCode: core.Attempt.ProductCode, ProductVersion: core.Attempt.ProductVersion, ReceiptSha256: core.ReceiptSha256}}
	project.Attempt.Dependencies = []msiDependencyEvidence{{PackageKey: editor.PackageKey, Version: editor.Attempt.Version, ProductCode: editor.Attempt.ProductCode, ProductVersion: editor.Attempt.ProductVersion, ReceiptSha256: editor.ReceiptSha256}}
	p.Records = append(p.Records, editor, project)
	var err error
	p.DependencyEdges, err = knownMSIDependencyEdges(p.Records)
	if err != nil {
		t.Fatal(err)
	}
	return p, key
}
func TestMSIRollbackCascadeOrdersIndependentDispositions(t *testing.T) {
	p, key := cascadeFixture(t)
	calls := 0
	result, err := planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, digest string) error {
		calls++
		if !validDigest(digest) {
			return errors.New("bad digest")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "independent_dispositions_required" || !result.ReadOnly || result.OSAttested || result.MutationAuthorized || result.AutomaticExecution || calls != 2 || len(result.Blockers) != 0 || len(result.Steps) != 3 {
		t.Fatalf("invalid cascade %+v", result)
	}
	if strings.Join(result.RecoveryOrder, ",") != "studio-project,studio-editor,studio-core" {
		t.Fatal(result.RecoveryOrder)
	}
	for i, step := range result.Steps {
		if step.Index != i || step.PackageKey != result.RecoveryOrder[i] || !step.SeparateAuthorizationRequired || step.MutationAuthorized ||
			!validDigest(step.RecordedReceiptSha256) || len(step.Blockers) != 0 || len(step.WaitingFor) != i {
			t.Fatalf("bad step %d %+v", i, step)
		}
		if i < 2 && step.Operation != "uninstall" || i == 2 && step.Operation != "msi-rollback" {
			t.Fatalf("unsafe operation %+v", step)
		}
		if i == 0 && step.State != "independent_operator_review_required" || i > 0 && step.State != "awaiting_prior_dispositions" {
			t.Fatalf("wrong step state %+v", step)
		}
		for j, waiting := range step.WaitingFor {
			if waiting != result.RecoveryOrder[j] {
				t.Fatal(step)
			}
		}
	}
}
func TestMSIRollbackCascadeBlockedDependencyAndLateForeignHistory(t *testing.T) {
	p, key := cascadeFixture(t)
	editor := &p.Records[1]
	editor.RegistrationDrift = "registration_changed_since_exit"
	result, err := planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil })
	if err != nil || result.State != "blocked" || len(result.Blockers) != 1 || result.Steps[1].State != "blocked" || result.Steps[0].State == "blocked" || result.Steps[2].State == "blocked" {
		t.Fatalf("dependency drift hidden %+v %v", result, err)
	}
	p, _ = cascadeFixture(t)
	p.LifecycleRecords = append(p.LifecycleRecords, msiRepairStatus{PackageKey: "studio-project"})
	if _, err = planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil }); err == nil {
		t.Fatal("foreign lifecycle journal accepted")
	}
	p, _ = cascadeFixture(t)
	p.AdmissionLockPresent = true
	if _, err = planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil }); err == nil {
		t.Fatal("global lock ignored")
	}
	p, _ = cascadeFixture(t)
	p.DependencyEdges[0].RecordedReceiptMatches = false
	if _, err = planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil }); err == nil {
		t.Fatal("forged dependency accepted")
	}
	p, _ = cascadeFixture(t)
	p.LifecycleRecords[0].Receipt.PriorMSISha256 = "bad"
	if _, err = planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil }); err == nil {
		t.Fatal("forged upgrade allowed")
	}
}
func TestMSIRollbackCascadeUnretainedSourceAndSinglePackage(t *testing.T) {
	p, key := cascadeFixture(t)
	result, err := planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return errors.New("missing") })
	if err != nil || result.State != "blocked" || result.Steps[2].State != "blocked" || len(result.Steps[2].Blockers) != 2 {
		t.Fatalf("unverified MSI permitted %+v %v", result, err)
	}
	p, key = rollbackReviewFixture()
	result, err = planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil })
	if err != nil || result.State != "independent_dispositions_required" || len(result.Steps) != 1 || result.Steps[0].Operation != "msi-rollback" || result.Steps[0].State != "independent_operator_review_required" {
		t.Fatalf("single package %+v %v", result, err)
	}
}
func TestMSIRollbackCascadeLargeGraphBoundedAndStable(t *testing.T) {
	p, key := rollbackReviewFixture()
	for i := 0; i < maxMSIProfileEntries-1; i++ {
		r := distinctCascadeStatus(fmt.Sprintf("dependent-%03d", i), "2.0.0", i+1)
		previous := p.Records[len(p.Records)-1]
		r.Attempt.Dependencies = []msiDependencyEvidence{{PackageKey: previous.PackageKey, Version: previous.Attempt.Version, ProductCode: previous.Attempt.ProductCode, ProductVersion: previous.Attempt.ProductVersion, ReceiptSha256: previous.ReceiptSha256}}
		p.Records = append(p.Records, r)
	}
	var err error
	p.DependencyEdges, err = knownMSIDependencyEdges(p.Records)
	if err != nil {
		t.Fatal(err)
	}
	result, err := planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil })
	if err != nil || len(result.Steps) != maxMSIProfileEntries || len(result.Steps[maxMSIProfileEntries-1].WaitingFor) != maxMSIProfileEntries-1 {
		t.Fatalf("bounded chain %+v %v", result, err)
	}
	encoded, encodeErr := json.Marshal(result)
	if encodeErr != nil || len(encoded) > 64*1024 {
		t.Fatalf("max MSI cascade exceeds native/Qt response contract: %v bytes=%d", encodeErr, len(encoded))
	}
	p.Records = append(p.Records, sampleInstalledDependencyStatus("overflow-package", "2.0.0"))
	if _, err = planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil }); err == nil {
		t.Fatal("unbounded chain accepted")
	}
}
