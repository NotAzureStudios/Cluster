package main

import (
	"strings"
	"testing"
)

func TestMSIIncidentWorklistRetainsEveryAttemptAndLifecycleJournal(t *testing.T) {
	p, key := cascadeFixture(t)
	settleCascadeDependent(t, &p, "studio-project")
	work, e := planMSIIncidentWorklist(p)
	if e != nil {
		t.Fatal(e)
	}
	if work.Schema != 1 || !work.Complete || !work.ReadOnly || work.OSAttested || work.MutationAuthorized || work.RetryAuthorized || work.State != "manual_recovery_required" {
		t.Fatalf("invalid worklist %+v", work)
	}
	if len(work.Items) != len(p.Records)+len(p.LifecycleRecords) {
		t.Fatalf("hidden cases %+v", work)
	}
	if work.Items[0].CaseID != "attempt:studio-core" || work.Items[1].CaseID != "attempt:studio-editor" || work.Items[2].CaseID != "attempt:studio-project" {
		t.Fatal(work.Items)
	}
	var upgraded, disposed bool
	for _, item := range work.Items {
		if !item.ReadOnly || item.OSAttested || item.RetryAuthorized || item.MutationAuthorized || item.CaseID == "" {
			t.Fatal(item)
		}
		if item.Operation == "upgrade" && item.PackageKey == key {
			upgraded = true
			if !item.PredecessorRecorded || !item.PredecessorMatches || item.RecoveryAction != "manual_lifecycle_review_no_replay" {
				t.Fatal(item)
			}
		}
		if item.Operation == "uninstall" && item.PackageKey == "studio-project" {
			disposed = true
			if !item.PredecessorMatches || item.ReceiptSha256 != strings.Repeat("d", 64) || item.RecoveryAction != "manual_lifecycle_review_no_replay" {
				t.Fatal(item)
			}
		}
	}
	if !upgraded || !disposed || work.ManualRecoveryCount < 2 {
		t.Fatal(work)
	}
}

func TestMSIIncidentWorklistOrphansRemainVisibleAndBlockable(t *testing.T) {
	p, key := cascadeFixture(t)
	_ = key
	// Remove the durable install record without removing its lifecycle journal.
	p.Records = p.Records[1:]
	p.LifecycleRecords = p.LifecycleRecords[:1]
	work, e := planMSIIncidentWorklist(p)
	if e != nil {
		t.Fatal(e)
	}
	orphan := work.Items[len(work.Items)-1]
	if orphan.Operation != "upgrade" || orphan.PredecessorRecorded || orphan.PredecessorMatches || orphan.RecoveryAction != "investigate_missing_or_changed_predecessor" {
		t.Fatalf("orphan hidden %+v", orphan)
	}
	p.AdmissionLockPresent = true
	for i := range p.Records {
		p.Records[i].AdmissionLockPresent = true
	}
	work, e = planMSIIncidentWorklist(p)
	if e != nil || !work.AdmissionLockPresent || work.State != "manual_recovery_required" {
		t.Fatalf("active lock lost %+v %v", work, e)
	}
}

func TestMSIIncidentWorklistRefusesForgedCustody(t *testing.T) {
	mutations := map[string]func(*msiProfileStatus){
		"missing digest":      func(p *msiProfileStatus) { p.LifecycleRecords[0].ReceiptSha256 = "" },
		"forged prior digest": func(p *msiProfileStatus) { p.LifecycleRecords[0].Receipt.PriorReceiptSha256 = "wrong" },
		"foreign journal":     func(p *msiProfileStatus) { p.LifecycleRecords[0].Receipt.PackageKey = "other" },
		"duplicate lifecycle": func(p *msiProfileStatus) { p.LifecycleRecords = append(p.LifecycleRecords, p.LifecycleRecords[0]) },
		"duplicate attempt":   func(p *msiProfileStatus) { p.Records = append(p.Records, p.Records[0]) },
		"permission forged":   func(p *msiProfileStatus) { p.LifecycleMutationAuthorized = true },
		"OS claim forged":     func(p *msiProfileStatus) { p.OSAttested = true },
		"incomplete":          func(p *msiProfileStatus) { p.Complete = false },
		"receipt state drift": func(p *msiProfileStatus) { p.LifecycleRecords[0].State = "upgrade_started_outcome_unknown" },
	}
	for label, modify := range mutations {
		t.Run(label, func(t *testing.T) {
			p, _ := cascadeFixture(t)
			modify(&p)
			if _, e := planMSIIncidentWorklist(p); e == nil {
				t.Fatal("unsafe profile accepted")
			}
		})
	}
}

func TestMSIIncidentWorklistEmptyProfileAndUnlaunchedAttempt(t *testing.T) {
	w, e := planMSIIncidentWorklist(msiProfileStatus{Schema: 1, ReadOnly: true, Complete: true})
	if e != nil || w.State != "empty" || len(w.Items) != 0 || w.ManualRecoveryCount != 0 {
		t.Fatalf("incorrect empty %+v %v", w, e)
	}
	p := msiProfileStatus{Schema: 1, ReadOnly: true, Complete: true, Records: []msiAttemptStatus{{PackageKey: "studio-core", ReadOnly: true, HasReceipt: false, LockPresent: true, State: "msi_missing_receipt"}}}
	w, e = planMSIIncidentWorklist(p)
	if e != nil || w.State != "manual_recovery_required" || len(w.Items) != 1 || w.Items[0].RecoveryAction != "investigate_install_attempt_no_replay" || w.Items[0].ReceiptSha256 != "" {
		t.Fatalf("missing receipt invisible %+v %v", w, e)
	}
}
