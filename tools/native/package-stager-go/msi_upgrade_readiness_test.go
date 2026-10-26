package main

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func upgradeFixture() (manifest, msiProfileStatus, string) {
	old := sampleInstalledDependencyStatus("studio-core", "1.4.2")
	old.Attempt.MSIPath = "install/studio-core.msi"
	old.Attempt.ProductVersion = "1.4.2"
	old.Attempt.PreLaunchRegistration.ExpectedVersion = "1.4.2"
	old.Attempt.PostExitRegistration.ExpectedVersion = "1.4.2"
	old.Attempt.PostExitRegistration.ReportedVersion = "1.4.2"
	old.Product.ExpectedVersion = "1.4.2"
	old.Product.ReportedVersion = "1.4.2"
	code := old.Attempt.ProductCode
	m := manifest{PackageKey: "studio-core", Version: "1.5.0", Platform: "windows-x64", ArtifactSha256: strings.Repeat("d", 64), Installer: &msiInstaller{Kind: "windows-msi", Scope: "user", Path: "install/studio-core.msi", Sha256: strings.Repeat("e", 64), ProductCode: code, ProductVersion: "1.5.0"}}
	profile := msiProfileStatus{Schema: 1, ReadOnly: true, Complete: true, Records: []msiAttemptStatus{old}, DependencyEdges: []msiDependencyEdge{}, LifecycleRecords: []msiRepairStatus{}}
	return m, profile, old.ReceiptSha256
}
func TestUpgradeReadinessKeepsOriginalRollbackSourceAndNoMutationAuthority(t *testing.T) {
	m, p, sha := upgradeFixture()
	root := t.TempDir()
	saw := false
	check := func(path, hash string) error {
		saw = true
		expect := filepath.Join(root, "staged", p.Records[0].Attempt.ArtifactSha256, "install", "studio-core.msi")
		if path != expect || hash != p.Records[0].Attempt.MSISha256 {
			t.Fatalf("rollback custody mismatch %s %s", path, hash)
		}
		return nil
	}
	r, e := reviewMSIUpgradeWithProfile(root, m, sha, p, check)
	if e != nil || !saw || r.State != "reviewable_not_authorized" || !r.ReadOnly || r.MutationAuthorized || r.OSAttested ||
		r.PriorMSIPath != "install/studio-core.msi" || r.PriorReceiptSha256 != sha || r.PriorProductVersion != "1.4.2" || r.TargetProductVersion != "1.5.0" {
		t.Fatalf("unsafe readiness: %v %+v", e, r)
	}
	if _, e := reviewMSIUpgradeWithProfile(root, m, sha, p, func(string, string) error { return errors.New("retained MSI corrupted") }); e == nil {
		t.Fatal("missing rollback source admitted")
	}
}
func TestUpgradeReadinessRejectsDowngradeConflictsAndTamper(t *testing.T) {
	original, profile, sha := upgradeFixture()
	mutations := map[string]func(*manifest, *msiProfileStatus){
		"different ProductCode": func(m *manifest, _ *msiProfileStatus) {
			m.Installer.ProductCode = "{AABBCCDD-1234-5678-ABCD-1234567890AB}"
		},
		"same MSI version":           func(m *manifest, _ *msiProfileStatus) { m.Installer.ProductVersion = "1.4.2" },
		"downgrade":                  func(m *manifest, _ *msiProfileStatus) { m.Installer.ProductVersion = "1.4.1" },
		"major upgrade":              func(m *manifest, _ *msiProfileStatus) { m.Installer.ProductVersion = "2.0.0" },
		"same release":               func(m *manifest, _ *msiProfileStatus) { m.Version = "1.4.2" },
		"same artifact":              func(m *manifest, p *msiProfileStatus) { m.ArtifactSha256 = p.Records[0].Attempt.ArtifactSha256 },
		"wrong receipt digest":       func(_ *manifest, p *msiProfileStatus) { p.Records[0].ReceiptSha256 = strings.Repeat("f", 64) },
		"missing receipt":            func(_ *manifest, p *msiProfileStatus) { p.Records[0].HasReceipt = false },
		"missing original path":      func(_ *manifest, p *msiProfileStatus) { p.Records[0].Attempt.MSIPath = "" },
		"unsafe original path":       func(_ *manifest, p *msiProfileStatus) { p.Records[0].Attempt.MSIPath = "../evil.msi" },
		"unknown previous execution": func(_ *manifest, p *msiProfileStatus) { p.Records[0].State = "msi_failed_or_outcome_unknown" },
		"changed Windows registration": func(_ *manifest, p *msiProfileStatus) {
			p.Records[0].RegistrationDrift = "registration_changed_since_exit"
		},
		"per-machine or missing probe":     func(_ *manifest, p *msiProfileStatus) { p.Records[0].Product.ProbeComplete = false },
		"missing before registration":      func(_ *manifest, p *msiProfileStatus) { p.Records[0].Attempt.PreLaunchRegistration = nil },
		"different post-exit registration": func(_ *manifest, p *msiProfileStatus) { p.Records[0].Product.ReportedVersion = "1.4.3" },
		"journal present": func(_ *manifest, p *msiProfileStatus) {
			p.LifecycleRecords = []msiRepairStatus{{Schema: 1, PackageKey: "studio-core", HasReceipt: true}}
		},
		"global lock":  func(_ *manifest, p *msiProfileStatus) { p.AdmissionLockPresent = true },
		"Package lock": func(_ *manifest, p *msiProfileStatus) { p.Records[0].LockPresent = true },
		"known dependent": func(_ *manifest, p *msiProfileStatus) {
			p.DependencyEdges = []msiDependencyEdge{{DependentPackageKey: "studio-editor", DependencyPackageKey: "studio-core", RecordedReceiptMatches: true}}
		},
		"changed dependency": func(_ *manifest, p *msiProfileStatus) {
			p.DependencyEdges = []msiDependencyEdge{{DependentPackageKey: "studio-core", DependencyPackageKey: "asset-core", RecordedReceiptMatches: false}}
		},
		"foreign same ProductCode": func(_ *manifest, p *msiProfileStatus) {
			extra := sampleInstalledDependencyStatus("another-tool", "3.0.0")
			p.Records = append(p.Records, extra)
		},
	}
	for name, change := range mutations {
		t.Run(name, func(t *testing.T) {
			m := original
			p := profile
			copyRecord := p.Records[0]
			copyAttempt := *copyRecord.Attempt
			copyProduct := *copyRecord.Product
			copyBefore := *copyAttempt.PreLaunchRegistration
			copyAfter := *copyAttempt.PostExitRegistration
			copyAttempt.PreLaunchRegistration = &copyBefore
			copyAttempt.PostExitRegistration = &copyAfter
			copyRecord.Attempt = &copyAttempt
			copyRecord.Product = &copyProduct
			p.Records = []msiAttemptStatus{copyRecord}
			copyInstaller := *m.Installer
			m.Installer = &copyInstaller
			change(&m, &p)
			if _, e := reviewMSIUpgradeWithProfile(t.TempDir(), m, sha, p, func(string, string) error { return nil }); e == nil {
				t.Fatal("unsafe upgrade accepted")
			}
		})
	}
}
func TestWindowsMSIVersionProgressionIsStrict(t *testing.T) {
	for _, pair := range [][2]string{{"1.0.0", "1.0.1"}, {"1.5.200", "1.6.0"}, {"2.6.0", "2.10.0"}} {
		if _, e := compareMSIVersions(pair[0], pair[1]); e != nil {
			t.Fatal(pair, e)
		}
	}
	for _, pair := range [][2]string{{"1.0.1", "1.0.0"}, {"1.0.0", "1.0.0"}, {"1.2.0", "2.0.0"}, {"1.10.0", "1.9.50"}, {"1.0.0", "1.256.0"}, {"1.0.0", "1.0.65536"}, {"abc", "1.2.0"}} {
		if _, e := compareMSIVersions(pair[0], pair[1]); e == nil {
			t.Fatal("unsafe upgrade version allowed", pair)
		}
	}
}

func TestUpgradeReadinessRejectsMissingInstallerWithoutPanic(t *testing.T) {
	m, profile, sha := upgradeFixture()
	m.Installer = nil
	result, err := reviewMSIUpgradeWithProfile(t.TempDir(), m, sha, profile, func(string, string) error { return nil })
	if err == nil || result.MutationAuthorized || !result.ReadOnly || result.OSAttested {
		t.Fatalf("nil signed target should be rejected: %+v / %v", result, err)
	}
}
