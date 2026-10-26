package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMSIRegistrationTransitionIsReadOnlyAndStateBound(t *testing.T) {
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	now := time.Now().UTC()
	original := msiAttempt{Schema: 1, PackageKey: "studio-tools", Version: "1.0.0", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64), ProductCode: code, ProductVersion: "1.0.0", State: "msi_exit_zero_not_os_attested", StartedAt: now.Format(time.RFC3339Nano), LaunchCommittedAt: now.Add(time.Millisecond).Format(time.RFC3339Nano), FinishedAt: now.Add(2 * time.Millisecond).Format(time.RFC3339Nano)}
	fresh := classifyMSIEnumeratedProduct
	before, err := fresh(code, "1.0.0", msiEnumeratedEnd, 0, "", 0, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	registered, err := fresh(code, "1.0.0", 0, 2, code, msiEnumeratedEnd, 0, "1.0.0")
	if err != nil {
		t.Fatal(err)
	}
	missing := before
	unavailable := unavailableMSIRegistration(code, "1.0.0")
	cases := []struct {
		name              string
		before, after     *msiProductState
		state, transition string
		accepted          bool
	}{
		{"historical", nil, nil, original.State, msiTransitionHistorical, true},
		{"pending", &before, nil, "msi_started_outcome_unknown", msiTransitionPrelaunchOnly, true},
		{"match", &before, &registered, original.State, msiTransitionMatchObserved, true},
		{"absent", &before, &missing, original.State, msiTransitionMissingObserved, true},
		{"query unavailable", &before, &unavailable, original.State, msiTransitionQueryUnavailable, true},
		{"post without before", nil, &registered, original.State, "", false},
		{"terminal missing post", &before, nil, original.State, "", false},
		{"prepared has pre", &before, nil, "msi_prepared_not_launched", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := original
			a.PreLaunchRegistration = tc.before
			a.PostExitRegistration = tc.after
			a.State = tc.state
			if tc.state == "msi_started_outcome_unknown" {
				a.FinishedAt = ""
			}
			if tc.state == "msi_prepared_not_launched" {
				a.LaunchCommittedAt = ""
				a.FinishedAt = ""
			}
			e := validateMSIRegistrationTransition(a)
			if (e == nil) != tc.accepted {
				t.Fatalf("accepted=%v err=%v", tc.accepted, e)
			}
			if tc.accepted && classifyMSIRegistrationTransition(a) != tc.transition {
				t.Fatalf("transition=%s", classifyMSIRegistrationTransition(a))
			}
		})
	}
	for label, mutate := range map[string]func(*msiAttempt){
		"forged attestation":          func(a *msiAttempt) { a.PostExitRegistration.OSAttested = true },
		"foreign code":                func(a *msiAttempt) { a.PostExitRegistration.ProductCode = "{00000000-0000-0000-0000-000000000000}" },
		"wrong version":               func(a *msiAttempt) { a.PreLaunchRegistration.ExpectedVersion = "2.0.0" },
		"faked scope":                 func(a *msiAttempt) { a.PostExitRegistration.ProbeScope = "" },
		"unverified prelaunch":        func(a *msiAttempt) { a.PreLaunchRegistration.ProbeComplete = false },
		"prelaunch registered":        func(a *msiAttempt) { *a.PreLaunchRegistration = registered },
		"bad version match":           func(a *msiAttempt) { a.PostExitRegistration.VersionMatches = false },
		"post recorded before finish": func(a *msiAttempt) { a.FinishedAt = "" },
	} {
		t.Run(label, func(t *testing.T) {
			a := original
			p := before
			q := registered
			a.PreLaunchRegistration = &p
			a.PostExitRegistration = &q
			mutate(&a)
			if validateMSIRegistrationTransition(a) == nil {
				t.Fatal("tampered registration evidence accepted")
			}
		})
	}
}

func TestMSIRegistrationTransitionSurvivesReceiptAndInventory(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	before, _ := classifyMSIEnumeratedProduct(code, "1.0.0", msiEnumeratedEnd, 0, "", 0, 0, "")
	after, _ := classifyMSIEnumeratedProduct(code, "1.0.0", 0, 4, code, msiEnumeratedEnd, 0, "1.0.0")
	now := time.Now().UTC()
	receipt := msiAttempt{Schema: 1, PackageKey: "studio-tools", Version: "2.0.0", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64), ProductCode: code, ProductVersion: "1.0.0", State: "msi_exit_zero_not_os_attested", StartedAt: now.Format(time.RFC3339Nano), LaunchCommittedAt: now.Add(time.Millisecond).Format(time.RFC3339Nano), FinishedAt: now.Add(2 * time.Millisecond).Format(time.RFC3339Nano), PreLaunchRegistration: &before, PostExitRegistration: &after}
	path := filepath.Join(dir, "studio-tools.json")
	write := func() {
		t.Helper()
		raw, _ := json.Marshal(receipt)
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write()
	state, err := inspectMSIAttempt(root, "studio-tools")
	if err != nil {
		t.Fatal(err)
	}
	if state.RegistrationTransition != msiTransitionMatchObserved || !state.ManualReviewRequired || state.RetryAuthorized || state.OSAttested || !state.ReadOnly {
		t.Fatalf("non-authorizing evidence lost: %+v", state)
	}
	profile, err := inspectMSIProfile(root)
	if err != nil {
		t.Fatal(err)
	}
	if !profile.Complete || len(profile.Records) != 1 || profile.Records[0].RegistrationTransition != msiTransitionMatchObserved {
		t.Fatalf("profile did not preserve read-only registration transition: %+v", profile)
	}
	receipt.PostExitRegistration.OSAttested = true
	write()
	if _, err := inspectMSIAttempt(root, "studio-tools"); err == nil {
		t.Fatal("forged post-exit attestation accepted")
	}
	if _, err := inspectMSIProfile(root); err == nil {
		t.Fatal("profile accepted forged post-exit attestation")
	}
}

func TestMSIPostExitRegistrationDoubleSampleRejectsMixedEpoch(t *testing.T) {
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	version := "1.0.0"
	absent, _ := classifyMSIEnumeratedProduct(code, version, msiEnumeratedEnd, 0, "", 0, 0, "")
	registered, _ := classifyMSIEnumeratedProduct(code, version, 0, 4, code, msiEnumeratedEnd, 0, version)
	for _, tc := range []struct {
		label    string
		values   []msiProductState
		failures map[int]bool
		want     string
	}{
		{"stable matching", []msiProductState{registered, registered}, nil, "registered_version_match"},
		{"stable absent", []msiProductState{absent, absent}, nil, "not_registered_for_user"},
		{"arrival during scan", []msiProductState{absent, registered}, nil, "os_query_unavailable"},
		{"removal during scan", []msiProductState{registered, absent}, nil, "os_query_unavailable"},
		{"failure on first query", []msiProductState{absent, registered}, map[int]bool{0: true}, "os_query_unavailable"},
		{"failure on second query", []msiProductState{registered, registered}, map[int]bool{1: true}, "os_query_unavailable"},
	} {
		t.Run(tc.label, func(t *testing.T) {
			i := 0
			got := observeMSIPostExitRegistration(code, version, func(string, string) (msiProductState, error) {
				j := i
				i++
				if tc.failures[j] {
					return tc.values[j], os.ErrPermission
				}
				return tc.values[j], nil
			})
			if i != 2 || got.State != tc.want || got.OSAttested || !got.ReadOnly {
				t.Fatalf("unsafe double sample: %+v calls=%d", got, i)
			}
		})
	}
}

func TestMSIRegistrationDriftNeverAttestsSoftwareHealth(t *testing.T) {
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	version := "1.0.0"
	registered, _ := classifyMSIEnumeratedProduct(code, version, 0, 4, code, msiEnumeratedEnd, 0, version)
	absent, _ := classifyMSIEnumeratedProduct(code, version, msiEnumeratedEnd, 0, "", 0, 0, "")
	attempt := msiAttempt{}
	if got := classifyMSIRegistrationDrift(attempt, registered); got != "no_post_exit_baseline" {
		t.Fatal(got)
	}
	attempt.PostExitRegistration = &registered
	for _, tc := range []struct {
		current msiProductState
		want    string
	}{
		{registered, "registration_unchanged_since_exit"},
		{absent, "registration_changed_since_exit"},
		{unavailableMSIRegistration(code, version), "registration_comparison_unavailable"},
	} {
		if got := classifyMSIRegistrationDrift(attempt, tc.current); got != tc.want {
			t.Fatalf("got %s want %s", got, tc.want)
		}
	}
}
