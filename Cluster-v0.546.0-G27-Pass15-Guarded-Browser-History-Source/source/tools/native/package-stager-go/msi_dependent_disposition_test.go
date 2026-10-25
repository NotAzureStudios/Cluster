package main

import (
	"strings"
	"testing"
)

func settleCascadeDependent(t *testing.T, p *msiProfileStatus, key string) {
	t.Helper()
	var record *msiAttemptStatus
	for i := range p.Records {
		if p.Records[i].PackageKey == key {
			record = &p.Records[i]
			break
		}
	}
	if record == nil {
		t.Fatal("missing dependent", key)
	}
	product := msiProductState{State: "not_registered_for_user", ProductCode: record.Attempt.ProductCode,
		ExpectedVersion: record.Attempt.ProductVersion, ReadOnly: true, OSAttested: false,
		ProbeScope: "current_user_and_machine", ProbeComplete: true}
	record.Product = &product
	record.RegistrationDrift = "not_registered_for_current_user"
	journal := msiRepairReceipt{Schema: 1, Operation: "uninstall", PackageKey: key, State: "uninstall_exit_zero_not_os_attested",
		Version: record.Attempt.Version, ArtifactSha256: record.Attempt.ArtifactSha256, MSISha256: record.Attempt.MSISha256,
		ProductCode: record.Attempt.ProductCode, ProductVersion: record.Attempt.ProductVersion,
		PriorReceiptSha256: record.ReceiptSha256, StartedAt: "2026-10-24T15:00:00Z",
		LaunchCommittedAt: "2026-10-24T15:01:00Z", FinishedAt: "2026-10-24T15:02:00Z", ExitCode: 0}
	p.LifecycleRecords = append(p.LifecycleRecords, msiRepairStatus{Schema: 1, PackageKey: key, State: journal.State,
		HasReceipt: true, ReadOnly: true, ManualReviewRequired: true, ReceiptSha256: strings.Repeat("d", 64), Receipt: &journal})
}

func TestDependentDispositionRequiresExactUninstallJournalAndOSAbsence(t *testing.T) {
	p, key := cascadeFixture(t)
	if observedSettledMSIUninstall(p, "studio-project") {
		t.Fatal("original installed receipt counts as disposition")
	}
	settleCascadeDependent(t, &p, "studio-project")
	if !observedSettledMSIUninstall(p, "studio-project") {
		t.Fatal("exact uninstall and absent scoped OS registration rejected")
	}
	got, err := reviewMSIRollbackWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil })
	if err != nil || got.State != "blocked" || len(got.SettledDependents) != 1 || got.SettledDependents[0] != "studio-project" ||
		len(got.OutstandingDependents) != 1 || got.OutstandingDependents[0] != "studio-editor" {
		t.Fatalf("partial disposition %+v %v", got, err)
	}
	settleCascadeDependent(t, &p, "studio-editor")
	got, err = reviewMSIRollbackWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil })
	if err != nil || got.State != "reviewable_not_authorized" || len(got.KnownDependents) != 2 ||
		len(got.SettledDependents) != 2 || len(got.OutstandingDependents) != 0 || got.MutationAuthorized || got.RollbackAuthorized || got.OSAttested {
		t.Fatalf("complete disposition not safely recognized %+v %v", got, err)
	}
	cases := map[string]func(*msiProfileStatus){
		"not actually absent": func(x *msiProfileStatus) { x.Records[2].Product.State = "registered_version_match" },
		"ambiguous OS":        func(x *msiProfileStatus) { x.Records[2].Product.ProbeComplete = false },
		"other user scope":    func(x *msiProfileStatus) { x.Records[2].Product.ProbeScope = "current_user" },
		"uninstall still active": func(x *msiProfileStatus) {
			x.LifecycleRecords[1].Receipt.State = "uninstall_started_outcome_unknown"
			x.LifecycleRecords[1].State = x.LifecycleRecords[1].Receipt.State
		},
		"uninstall failed": func(x *msiProfileStatus) {
			x.LifecycleRecords[1].Receipt.State = "uninstall_failed_or_outcome_unknown"
			x.LifecycleRecords[1].State = x.LifecycleRecords[1].Receipt.State
		},
		"wrong install receipt": func(x *msiProfileStatus) { x.LifecycleRecords[1].Receipt.PriorReceiptSha256 = strings.Repeat("e", 64) },
		"wrong ProductCode": func(x *msiProfileStatus) {
			x.LifecycleRecords[1].Receipt.ProductCode = "{FFFFFFFF-1234-ABCD-ABCD-1234567890AB}"
		},
		"wrong MSI":        func(x *msiProfileStatus) { x.LifecycleRecords[1].Receipt.MSISha256 = strings.Repeat("f", 64) },
		"invalid outcome":  func(x *msiProfileStatus) { x.LifecycleRecords[1].Receipt.ExitCode = 3010 },
		"fake attestation": func(x *msiProfileStatus) { x.LifecycleRecords[1].OSAttested = true },
		"unsafe retry":     func(x *msiProfileStatus) { x.LifecycleRecords[1].RetryAuthorized = true },
	}
	for label, mutate := range cases {
		t.Run(label, func(t *testing.T) {
			fresh, _ := cascadeFixture(t)
			settleCascadeDependent(t, &fresh, "studio-project")
			settleCascadeDependent(t, &fresh, "studio-editor")
			// Fixture is independently reconstructed for every adversarial case.
			mutate(&fresh)
			outcome, e := reviewMSIRollbackWithProfile(t.TempDir(), key, fresh, func(_, _ string) error { return nil })
			if e == nil && outcome.State == "reviewable_not_authorized" {
				t.Fatalf("unsafe dependent disposition passed: %+v", outcome)
			}
		})
	}
}

func TestOwnedRollbackRetainsIndependentDependentUninstallJournals(t *testing.T) {
	p, key := cascadeFixture(t)
	settleCascadeDependent(t, &p, "studio-project")
	settleCascadeDependent(t, &p, "studio-editor")
	p.AdmissionLockPresent = true
	for i := range p.Records {
		p.Records[i].AdmissionLockPresent = true
	}
	p.Records[0].LockPresent = true
	journalSHA := p.LifecycleRecords[0].ReceiptSha256
	out, err := reviewRollbackWithOwnedProfile(t.TempDir(), key, journalSHA, p, false, func(_, _ string) error { return nil })
	if err != nil || out.State != "reviewable_not_authorized" || len(out.OutstandingDependents) != 0 {
		t.Fatalf("owned admission rejected settled dependents %+v %v", out, err)
	}
	r := msiRepairReceipt{Schema: 1, Operation: "msi-rollback", PackageKey: key, State: "msi-rollback_prepared_not_launched",
		PriorReceiptSha256: out.PriorReceiptSha256, PriorMSISha256: out.PredecessorMSISha256,
		SuccessorMSISha256: out.SuccessorMSISha256, UpgradeJournalSha256: journalSHA}
	p.LifecycleRecords = append(p.LifecycleRecords, msiRepairStatus{PackageKey: key, State: r.State, Receipt: &r})
	out, err = reviewRollbackWithOwnedProfile(t.TempDir(), key, journalSHA, p, true, func(_, _ string) error { return nil })
	if err != nil || out.State != "reviewable_not_authorized" || len(out.SettledDependents) != 2 {
		t.Fatalf("prepared admission rejected previous independent journals %+v %v", out, err)
	}
	p.LifecycleRecords[3].Receipt.UpgradeJournalSha256 = strings.Repeat("a", 64)
	if _, err = reviewRollbackWithOwnedProfile(t.TempDir(), key, journalSHA, p, true, func(_, _ string) error { return nil }); err == nil {
		t.Fatal("prepared rollback journal tamper not rejected")
	}
}

func TestCascadeAdvancesOneIndependentlyObservedDispositionAtATime(t *testing.T) {
	p, key := cascadeFixture(t)
	check := func(firstState, secondState, rootState string, settled int) {
		t.Helper()
		workbook, err := planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil })
		if err != nil || len(workbook.Steps) != 3 || workbook.Steps[0].State != firstState ||
			workbook.Steps[1].State != secondState || workbook.Steps[2].State != rootState {
			t.Fatalf("unexpected workflow after %d independent dispositions: %+v %v", settled, workbook, err)
		}
		for i, step := range workbook.Steps {
			if step.MutationAuthorized || !step.SeparateAuthorizationRequired || step.DispositionObserved != (i < settled) {
				t.Fatalf("automatic authority or forged observation after %d: %+v", settled, step)
			}
		}
	}
	check("independent_operator_review_required", "awaiting_prior_dispositions", "awaiting_prior_dispositions", 0)
	settleCascadeDependent(t, &p, "studio-project")
	check("observed_uninstall_registration_absent", "independent_operator_review_required", "awaiting_prior_dispositions", 1)
	settleCascadeDependent(t, &p, "studio-editor")
	check("observed_uninstall_registration_absent", "observed_uninstall_registration_absent", "independent_operator_review_required", 2)
	p.Records[1].Product.ProbeComplete = false
	workbook, err := planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil })
	if err == nil && len(workbook.Steps) == 3 && workbook.Steps[2].State == "independent_operator_review_required" {
		t.Fatal("an incomplete Windows scope probe permitted the last rollback")
	}
}
