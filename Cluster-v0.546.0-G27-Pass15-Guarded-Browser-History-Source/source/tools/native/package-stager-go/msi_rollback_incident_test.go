package main

import (
	"strings"
	"testing"
)

func TestCascadeIncidentCustodyAndSingleNextAction(t *testing.T) {
	check := func(p msiProfileStatus, key, next string, manual []string, actions []string) msiRollbackCascade {
		t.Helper()
		plan, err := planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil })
		if err != nil {
			t.Fatalf("plan failed: %v", err)
		}
		if plan.NextReviewablePackageKey != next || plan.ManualRecoveryRequired != (len(manual) > 0) ||
			strings.Join(plan.ManualReviewPackages, ",") != strings.Join(manual, ",") || len(plan.Steps) != len(actions) {
			t.Fatalf("incident projections wrong: %+v", plan)
		}
		for i, action := range actions {
			if plan.Steps[i].RecoveryAction != action || plan.Steps[i].MutationAuthorized || !plan.Steps[i].SeparateAuthorizationRequired {
				t.Fatalf("step %d wrong or authorizing: %+v", i, plan.Steps[i])
			}
		}
		return plan
	}
	p, key := cascadeFixture(t)
	none := check(p, key, "studio-project", nil, []string{"request_independent_authorization", "wait_for_independent_dispositions", "wait_for_independent_dispositions"})
	for _, step := range none.Steps {
		if step.LifecycleJournalSha256 != "" || step.LifecycleJournalState != "not_recorded" {
			t.Fatal("invented journal without evidence")
		}
	}
	settleCascadeDependent(t, &p, "studio-project")
	one := check(p, key, "studio-editor", nil, []string{"preserve_completed_disposition", "request_independent_authorization", "wait_for_independent_dispositions"})
	if one.Steps[0].LifecycleJournalSha256 != strings.Repeat("d", 64) || one.Steps[0].LifecycleJournalState != "uninstall_exit_zero_not_os_attested" {
		t.Fatal("settled journal SHA lost")
	}
	settleCascadeDependent(t, &p, "studio-editor")
	all := check(p, key, "studio-core", nil, []string{"preserve_completed_disposition", "preserve_completed_disposition", "request_independent_authorization"})
	if all.Steps[2].LifecycleJournalSha256 != "" || all.Steps[2].LifecycleJournalState != "not_recorded" {
		t.Fatal("upgrade journal passed off as rollback journal")
	}
	// A completed uninstall process whose ProductCode is still installed is
	// neither a disposition nor an authority to retry the destructive action.
	p.Records[1].Product.State = "registered_version_match"
	p.Records[1].Product.ReportedVersion = p.Records[1].Attempt.ProductVersion
	p.Records[1].Product.VersionMatches = true
	incident := check(p, key, "", []string{"studio-editor"}, []string{"preserve_completed_disposition", "manual_recovery_no_replay", "wait_for_independent_dispositions"})
	if incident.State != "blocked" || incident.Steps[1].State != "blocked" || incident.Steps[1].LifecycleJournalSha256 != strings.Repeat("d", 64) ||
		incident.Steps[1].LifecycleJournalState != "uninstall_exit_zero_not_os_attested" ||
		len(incident.Steps[1].Blockers) == 0 {
		t.Fatalf("contradictory installed OS probe hid incident: %+v", incident)
	}
	// Restart during suspended or launched execution must retain its unique
	// journal SHA without ever authorizing a retry or guessing a disposition.
	p.LifecycleRecords[2].Receipt.State = "uninstall_started_outcome_unknown"
	p.LifecycleRecords[2].State = "uninstall_started_outcome_unknown"
	launched := check(p, key, "", []string{"studio-editor"}, []string{"preserve_completed_disposition", "manual_recovery_no_replay", "wait_for_independent_dispositions"})
	if launched.Steps[1].LifecycleJournalState != "uninstall_started_outcome_unknown" || launched.Steps[1].DispositionObserved {
		t.Fatal("interrupted uninstall treated as successful")
	}
}

func TestCascadeIncidentForgeriesAreRefused(t *testing.T) {
	variants := map[string]func(*msiProfileStatus){
		"missing journal hash":       func(p *msiProfileStatus) { p.LifecycleRecords[1].ReceiptSha256 = "" },
		"tampered journal digest":    func(p *msiProfileStatus) { p.LifecycleRecords[1].ReceiptSha256 = "bogus" },
		"journal operation replaced": func(p *msiProfileStatus) { p.LifecycleRecords[1].Receipt.Operation = "repair" },
		"journal state mismatched":   func(p *msiProfileStatus) { p.LifecycleRecords[1].State = "uninstall_started_outcome_unknown" },
		"journal replay enabled":     func(p *msiProfileStatus) { p.LifecycleRecords[1].RetryAuthorized = true },
		"journal OS attested":        func(p *msiProfileStatus) { p.LifecycleRecords[1].OSAttested = true },
		"duplicate journal":          func(p *msiProfileStatus) { p.LifecycleRecords = append(p.LifecycleRecords, p.LifecycleRecords[1]) },
		"foreign journal Package":    func(p *msiProfileStatus) { p.LifecycleRecords[1].Receipt.PackageKey = "studio-core" },
	}
	for label, corrupt := range variants {
		t.Run(label, func(t *testing.T) {
			p, key := cascadeFixture(t)
			settleCascadeDependent(t, &p, "studio-project")
			corrupt(&p)
			if _, err := planMSIRollbackCascadeWithProfile(t.TempDir(), key, p, func(_, _ string) error { return nil }); err == nil {
				t.Fatal("forged or unsafe incident admitted", label)
			}
		})
	}
}
