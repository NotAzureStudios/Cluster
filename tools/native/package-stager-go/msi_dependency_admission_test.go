package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func sampleInstalledDependencyStatus(key, version string) msiAttemptStatus {
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	before, _ := classifyMSIEnumeratedProduct(code, "1.0.0", msiEnumeratedEnd, 0, "", 0, 0, "")
	registered, _ := classifyMSIEnumeratedProduct(code, "1.0.0", 0, 4, code, msiEnumeratedEnd, 0, "1.0.0")
	now := time.Now().UTC()
	attempt := msiAttempt{Schema: 1, PackageKey: key, Version: version,
		ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64), ProductCode: code,
		ProductVersion: "1.0.0", State: "msi_exit_zero_not_os_attested", StartedAt: now.Format(time.RFC3339Nano),
		LaunchCommittedAt: now.Add(time.Millisecond).Format(time.RFC3339Nano), FinishedAt: now.Add(2 * time.Millisecond).Format(time.RFC3339Nano),
		PreLaunchRegistration: &before, PostExitRegistration: &registered}
	return msiAttemptStatus{Schema: 1, PackageKey: key, State: attempt.State, HasReceipt: true,
		ReceiptSha256: strings.Repeat("c", 64), ReadOnly: true, OSAttested: false, RetryAuthorized: false,
		ManualReviewRequired: true, Attempt: &attempt, Product: &registered,
		RegistrationTransition: msiTransitionMatchObserved, RegistrationDrift: "registration_unchanged_since_exit"}
}

func TestMSIInstalledDependenciesRequireExactTerminalOSAndReceiptEvidence(t *testing.T) {
	base := sampleInstalledDependencyStatus("editor-core", "2.0.0")
	dep := packageDependency{PackageKey: "editor-core", Version: "2.0.0", Requirement: "msi-installed"}
	got, err := checkedMSIDependencyStatus(dep, base)
	if err != nil || got.PackageKey != dep.PackageKey || got.ReceiptSha256 != base.ReceiptSha256 {
		t.Fatalf("correct OS registration refused %v %+v", err, got)
	}
	cases := map[string]func(*msiAttemptStatus){
		"foreign package":      func(s *msiAttemptStatus) { s.PackageKey = "other" },
		"unreadable receipt":   func(s *msiAttemptStatus) { s.HasReceipt = false },
		"no attempt":           func(s *msiAttemptStatus) { s.Attempt = nil },
		"no registration":      func(s *msiAttemptStatus) { s.Product = nil },
		"bogus receipt digest": func(s *msiAttemptStatus) { s.ReceiptSha256 = "wrong" },
		"forged success":       func(s *msiAttemptStatus) { s.OSAttested = true },
		"untrusted read only":  func(s *msiAttemptStatus) { s.ReadOnly = false },
		"retry grant":          func(s *msiAttemptStatus) { s.RetryAuthorized = true },
		"wrong target version": func(s *msiAttemptStatus) { s.Attempt.Version = "3.0.0" },
		"pending restart": func(s *msiAttemptStatus) {
			s.State = "msi_restart_required_not_os_attested"
			s.Attempt.State = s.State
			s.Attempt.ExitCode = 3010
		},
		"unknown process result":     func(s *msiAttemptStatus) { s.State = "msi_failed_or_outcome_unknown"; s.Attempt.State = s.State },
		"missing launch":             func(s *msiAttemptStatus) { s.Attempt.LaunchCommittedAt = "" },
		"missing before observation": func(s *msiAttemptStatus) { s.Attempt.PreLaunchRegistration = nil },
		"missing after observation":  func(s *msiAttemptStatus) { s.Attempt.PostExitRegistration = nil },
		"post exit version moved": func(s *msiAttemptStatus) {
			s.Product.ReportedVersion = "1.0.1"
			s.Product.VersionMatches = false
			s.Product.State = "registered_version_mismatch"
		},
		"registration drift":        func(s *msiAttemptStatus) { s.RegistrationDrift = "registration_changed_since_exit" },
		"reported conflict":         func(s *msiAttemptStatus) { s.RegistrationTransition = msiTransitionConflictObserved },
		"reported forged OS health": func(s *msiAttemptStatus) { s.Product.OSAttested = true },
		"not fully enumerated":      func(s *msiAttemptStatus) { s.Product.ProbeComplete = false },
		"post exit changed":         func(s *msiAttemptStatus) { s.Attempt.PostExitRegistration.ReportedVersion = "1.0.2" },
	}
	for label, mutate := range cases {
		t.Run(label, func(t *testing.T) {
			sample := sampleInstalledDependencyStatus("editor-core", "2.0.0")
			mutate(&sample)
			if _, e := checkedMSIDependencyStatus(dep, sample); e == nil {
				t.Fatalf("unsafe %s accepted", label)
			}
		})
	}
}
func TestMSIDependencyAdmitRefusesMissingDuplicateAndLockedPrerequisites(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	count := 0
	reader := func(_ string, key string) (msiAttemptStatus, error) {
		count++
		return sampleInstalledDependencyStatus(key, "2.0.0"), nil
	}
	deps := []packageDependency{{PackageKey: "editor-core", Version: "2.0.0", Requirement: "msi-installed"}, {PackageKey: "video-core", Version: "2.0.0", Requirement: "msi-installed"}}
	result, e := inspectMSIDependenciesWithReader(root, "project-editor", deps, reader)
	if e != nil || len(result) != 2 || count != 2 {
		t.Fatalf("expected 2 validated dependencies %v %+v", e, result)
	}
	for _, tc := range [][]packageDependency{{deps[0], deps[0]}, {{PackageKey: "project-editor", Version: "2.0.0", Requirement: "msi-installed"}}, {{PackageKey: "bad key", Version: "2.0.0", Requirement: "msi-installed"}}, {{PackageKey: "editor-core", Version: "bad", Requirement: "msi-installed"}}} {
		if _, e := inspectMSIDependenciesWithReader(root, "project-editor", tc, reader); e == nil {
			t.Fatal("malformed signed dependency accepted", tc)
		}
	}
	if e := os.Mkdir(filepath.Join(dir, "editor-core.lock"), 0700); e != nil {
		t.Fatal(e)
	}
	if _, e := inspectMSIDependenciesWithReader(root, "project-editor", deps, reader); e == nil {
		t.Fatal("dependency operation lock accepted")
	}
	if e := os.Remove(filepath.Join(dir, "editor-core.lock")); e != nil {
		t.Fatal(e)
	}
	reader = func(_ string, key string) (msiAttemptStatus, error) {
		s := sampleInstalledDependencyStatus(key, "2.0.0")
		if key == "video-core" {
			s.Attempt.Version = "1.0.0"
		}
		return s, nil
	}
	if _, e := inspectMSIDependenciesWithReader(root, "project-editor", deps, reader); e == nil {
		t.Fatal("second dependency mismatch ignored")
	}
}
func TestMSIAttemptDependencyReceiptValidatesAndRemainsBounded(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	attempt := msiAttempt{Schema: 1, PackageKey: "project-editor", Version: "2.0.0", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64), ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "2.0.0", State: "msi_prepared_not_launched", StartedAt: now,
		Dependencies: []msiDependencyEvidence{{PackageKey: "editor-core", Version: "1.0.0", ProductCode: "{11111111-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0", ReceiptSha256: strings.Repeat("c", 64)}}}
	path := filepath.Join(dir, "project-editor.json")
	read := func() error {
		b, e := json.Marshal(attempt)
		if e != nil {
			return e
		}
		return os.WriteFile(path, b, 0600)
	}
	if e := read(); e != nil {
		t.Fatal(e)
	}
	status, e := inspectMSIAttempt(root, "project-editor")
	if e != nil || len(status.Attempt.Dependencies) != 1 {
		t.Fatalf("valid dependency receipt rejected %v %+v", e, status)
	}
	corrupt := map[string]func(*msiAttempt){
		"duplicate":       func(a *msiAttempt) { a.Dependencies = append(a.Dependencies, a.Dependencies[0]) },
		"own package":     func(a *msiAttempt) { a.Dependencies[0].PackageKey = "project-editor" },
		"missing digest":  func(a *msiAttempt) { a.Dependencies[0].ReceiptSha256 = "" },
		"invalid product": func(a *msiAttempt) { a.Dependencies[0].ProductCode = "bad" },
		"bad version":     func(a *msiAttempt) { a.Dependencies[0].Version = "v1" },
	}
	for name, change := range corrupt {
		t.Run(name, func(t *testing.T) {
			a := attempt
			a.Dependencies = append([]msiDependencyEvidence{}, attempt.Dependencies...)
			change(&a)
			b, _ := json.Marshal(a)
			os.WriteFile(path, b, 0600)
			if _, e := inspectMSIAttempt(root, "project-editor"); e == nil {
				t.Fatal("invalid dependency custody receipt accepted")
			}
		})
	}
	// Older installation records had no prerequisite snapshots.
	attempt.Dependencies = nil
	if e := read(); e != nil {
		t.Fatal(e)
	}
	if _, e := inspectMSIAttempt(root, "project-editor"); e != nil {
		t.Fatal("historical receipt no longer readable", e)
	}
}

func TestMSIProfileDependencyEdgesAreBoundedAndDetectDrift(t *testing.T) {
	dependent := sampleInstalledDependencyStatus("project-editor", "3.0.0")
	dependency := sampleInstalledDependencyStatus("editor-core", "2.0.0")
	evidence := msiDependencyEvidence{PackageKey: "editor-core", Version: "2.0.0", ProductCode: dependency.Attempt.ProductCode,
		ProductVersion: dependency.Attempt.ProductVersion, ReceiptSha256: dependency.ReceiptSha256}
	dependent.Attempt.Dependencies = []msiDependencyEvidence{evidence}
	result, e := knownMSIDependencyEdges([]msiAttemptStatus{dependent, dependency})
	if e != nil || len(result) != 1 || result[0].DependentPackageKey != "project-editor" || !result[0].RecordedReceiptMatches || !result[0].RecordedDependencyPresent {
		t.Fatalf("expected coherent graph: %v %+v", e, result)
	}
	dependency.ReceiptSha256 = strings.Repeat("d", 64)
	result, e = knownMSIDependencyEdges([]msiAttemptStatus{dependent, dependency})
	if e != nil || result[0].RecordedReceiptMatches || !result[0].RecordedDependencyPresent {
		t.Fatal("replaced dependency receipt accepted", e, result)
	}
	result, e = knownMSIDependencyEdges([]msiAttemptStatus{dependent})
	if e != nil || result[0].RecordedReceiptMatches || result[0].RecordedDependencyPresent {
		t.Fatal("missing dependency hidden", e, result)
	}
	dependent.Attempt.Dependencies = append(dependent.Attempt.Dependencies, evidence)
	if _, e = knownMSIDependencyEdges([]msiAttemptStatus{dependent}); e == nil {
		t.Fatal("duplicate dependency graph edge accepted")
	}
	if _, e = knownMSIDependencyEdges([]msiAttemptStatus{dependency, dependency}); e == nil {
		t.Fatal("duplicate Package identity accepted")
	}
}
func TestMSIProfileDependencyGraphReportsUnverifiedRatherThanRemovalPermission(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	receipt := msiAttempt{Schema: 1, PackageKey: "project-editor", Version: "3.0.0", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64),
		ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "3.0.0", State: "msi_prepared_not_launched", StartedAt: now,
		Dependencies: []msiDependencyEvidence{{PackageKey: "editor-core", Version: "2.0.0", ProductCode: "{11111111-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "2.0.0", ReceiptSha256: strings.Repeat("c", 64)}}}
	raw, _ := json.Marshal(receipt)
	if e := os.WriteFile(filepath.Join(dir, "project-editor.json"), raw, 0600); e != nil {
		t.Fatal(e)
	}
	profile, e := inspectMSIProfile(root)
	if e != nil || !profile.Complete || !profile.ManualReviewRequired || profile.LifecycleMutationAuthorized || len(profile.DependencyEdges) != 1 || profile.DependencyEdges[0].RecordedReceiptMatches || profile.DependencyEdges[0].RecordedDependencyPresent {
		t.Fatalf("incomplete dependency graph was authorized or suppressed %v %+v", e, profile)
	}
}

func TestMSIDependencyKindIsRequiredAndScopesNativeOSChecks(t *testing.T) {
	msid := packageDependency{PackageKey: "editor-core", Version: "2.0.0", Requirement: "msi-installed"}
	content := packageDependency{PackageKey: "texture-pack", Version: "1.1.0", Requirement: "content-selected"}
	msim := manifest{Schema: 1, PackageKey: "project-editor", Platform: "windows-x64", Installer: &msiInstaller{Kind: "windows-msi"}, Dependencies: []packageDependency{msid, content}}
	if e := validateManifestDependencies(msim); e != nil {
		t.Fatal("valid mixed typed dependencies refused", e)
	}
	for name, broken := range map[string]manifest{
		"MSI on Linux":                {PackageKey: msim.PackageKey, Platform: "linux-x64", Dependencies: msim.Dependencies},
		"MSI without installer":       {PackageKey: msim.PackageKey, Platform: "windows-x64", Dependencies: msim.Dependencies},
		"implicit legacy requirement": {PackageKey: msim.PackageKey, Platform: "windows-x64", Installer: msim.Installer, Dependencies: []packageDependency{{PackageKey: msid.PackageKey, Version: msid.Version}}},
		"invalid requirement":         {PackageKey: msim.PackageKey, Platform: "windows-x64", Installer: msim.Installer, Dependencies: []packageDependency{{PackageKey: msid.PackageKey, Version: msid.Version, Requirement: "always-installed"}}},
	} {
		t.Run(name, func(t *testing.T) {
			if e := validateManifestDependencies(broken); e == nil {
				t.Fatal("ambiguous MSI signed dependency accepted")
			}
		})
	}
	readerCalls := 0
	root := t.TempDir()
	// A content-only dependency does not require an MSI receipt and must not
	// make an OS registration query. Selected-content verification is separate.
	got, e := inspectMSIDependenciesWithReader(root, msim.PackageKey, []packageDependency{content}, func(_, _ string) (msiAttemptStatus, error) { readerCalls++; return msiAttemptStatus{}, nil })
	if e != nil || len(got) != 0 || readerCalls != 0 {
		t.Fatalf("content-only dependency wrongly required an OS installation %v %+v", e, got)
	}
	// A mixed signed manifest probes only its OS-installed prerequisite.
	got, e = inspectMSIDependenciesWithReader(root, msim.PackageKey, msim.Dependencies, func(_ string, key string) (msiAttemptStatus, error) {
		readerCalls++
		return sampleInstalledDependencyStatus(key, "2.0.0"), nil
	})
	if e != nil || len(got) != 1 || got[0].PackageKey != msid.PackageKey || readerCalls != 1 {
		t.Fatalf("mixed signed dependency did not scope OS admission %v %+v", e, got)
	}
}

func TestMSIMaximumSignedPrerequisiteReceiptRemainsReadable(t *testing.T) {
	baseline := sampleInstalledDependencyStatus("project-editor", "3.0.0").Attempt
	if baseline == nil {
		t.Fatal("no attempt fixture")
	}
	baseline.Dependencies = make([]msiDependencyEvidence, 0, 12)
	for i := 0; i < 12; i++ {
		baseline.Dependencies = append(baseline.Dependencies, msiDependencyEvidence{
			PackageKey: fmt.Sprintf("dependency-%02d", i), Version: "2.0.0",
			ProductCode:    fmt.Sprintf("{%08X-1234-ABCD-ABCD-1234567890AB}", i+1),
			ProductVersion: "2.0.0", ReceiptSha256: strings.Repeat("d", 64),
		})
	}
	if !validMSIDependencyEvidence(baseline.Dependencies, baseline.PackageKey) {
		t.Fatal("12 signed dependencies refused")
	}
	raw, e := json.Marshal(baseline)
	if e != nil || len(raw) > 4096 {
		t.Fatalf("signed 12-dependency receipt exceeds bounded reader: bytes=%d err=%v", len(raw), e)
	}
}
