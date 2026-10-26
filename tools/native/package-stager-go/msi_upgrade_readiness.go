package main

// Strictly observational minor-upgrade preflight. A change of ProductCode is
// a different (major-upgrade) operation and is NOT enabled by this review.
// Even reviewable means signed grant, authoring proof and Windows execution
// checks are still required before any mutation could be implemented.
import (
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

type msiUpgradeReadiness struct {
	Schema               int    `json:"schema"`
	PackageKey           string `json:"packageKey"`
	Version              string `json:"version"`
	ArtifactSha256       string `json:"artifactSha256"`
	ProductCode          string `json:"productCode"`
	State                string `json:"state"`
	ReadOnly             bool   `json:"readOnly"`
	MutationAuthorized   bool   `json:"mutationAuthorized"`
	OSAttested           bool   `json:"osAttested"`
	PriorReceiptSha256   string `json:"priorReceiptSha256"`
	PriorMSIPath         string `json:"priorMsiPath"`
	PriorMSISha256       string `json:"priorMsiSha256"`
	PriorProductVersion  string `json:"priorProductVersion"`
	TargetProductVersion string `json:"targetProductVersion"`
}

func compareMSIVersions(old, next string) (bool, error) {
	if !msiProductVersionPattern.MatchString(old) || !msiProductVersionPattern.MatchString(next) {
		return false, errors.New("unparseable MSI product version")
	}
	parse := func(raw string) ([3]int, error) {
		var nums [3]int
		for i, part := range strings.Split(raw, ".") {
			n, e := strconv.Atoi(part)
			if e != nil || n < 0 || (i < 2 && n > 255) || (i == 2 && n > 65535) {
				return nums, errors.New("MSI version outside Windows Installer bounds")
			}
			nums[i] = n
		}
		return nums, nil
	}
	a, e := parse(old)
	if e != nil {
		return false, e
	}
	b, e := parse(next)
	if e != nil {
		return false, e
	}
	// Restrict to same major version and strictly increasing minor/build.
	if a[0] != b[0] || (b[1] < a[1]) || (b[1] == a[1] && b[2] <= a[2]) {
		return false, errors.New("not a strictly increasing same-major MSI version")
	}
	return true, nil
}

// Injectable evidence allows adversarial tests to run without Windows Installer.
func reviewMSIUpgradeWithProfile(root string, m manifest, sha string, profile msiProfileStatus,
	verifyFile func(string, string) error) (msiUpgradeReadiness, error) {
	out := msiUpgradeReadiness{Schema: 1, PackageKey: m.PackageKey, Version: m.Version, ArtifactSha256: m.ArtifactSha256, State: "blocked_unverified", ReadOnly: true, MutationAuthorized: false, OSAttested: false}
	if m.Installer == nil {
		return out, errors.New("signed target has no MSI installer")
	}
	out.ProductCode = m.Installer.ProductCode
	if m.Installer.Scope != "user" || m.Platform != "windows-x64" || !validDigest(sha) || verifyFile == nil ||
		!profile.Complete || !profile.ReadOnly || profile.OSAttested || profile.RetryAuthorized || profile.AdmissionLockPresent ||
		profile.LifecycleMutationAuthorized || len(profile.LifecycleRecords) > 0 {
		return out, errors.New("upgrade evidence unavailable or lifecycle journal present")
	}
	if !msiProductCodePattern.MatchString(m.Installer.ProductCode) || !msiProductVersionPattern.MatchString(m.Installer.ProductVersion) {
		return out, errors.New("target MSI identity invalid")
	}
	var candidate *msiAttemptStatus
	for i := range profile.Records {
		if profile.Records[i].PackageKey == m.PackageKey {
			candidate = &profile.Records[i]
			break
		}
	}
	if candidate == nil || !candidate.HasReceipt || candidate.Attempt == nil || candidate.ReceiptSha256 != sha ||
		candidate.State != "msi_exit_zero_not_os_attested" || candidate.Attempt.State != candidate.State ||
		candidate.Attempt.ProductCode != m.Installer.ProductCode || candidate.Attempt.ProductVersion == m.Installer.ProductVersion ||
		candidate.Attempt.Version == m.Version || candidate.Attempt.ArtifactSha256 == m.ArtifactSha256 ||
		candidate.Attempt.PostExitRegistration == nil || candidate.Attempt.PreLaunchRegistration == nil ||
		candidate.RegistrationDrift != "registration_unchanged_since_exit" || candidate.Product == nil ||
		candidate.Product.State != "registered_version_match" || !candidate.Product.VersionMatches || !candidate.Product.ProbeComplete ||
		candidate.Product.ProbeScope != "current_user_and_machine" || *candidate.Product != *candidate.Attempt.PostExitRegistration ||
		candidate.Attempt.MSIPath == "" || !msiPathPattern.MatchString(candidate.Attempt.MSIPath) || secureName(candidate.Attempt.MSIPath) != nil ||
		!validDigest(candidate.Attempt.MSISha256) || !validDigest(candidate.Attempt.ArtifactSha256) ||
		candidate.LockPresent || candidate.AdmissionLockPresent {
		return out, errors.New("predecessor exact installed MSI receipt cannot be established")
	}
	if _, err := compareMSIVersions(candidate.Attempt.ProductVersion, m.Installer.ProductVersion); err != nil {
		return out, err
	}
	for _, other := range profile.Records {
		if other.PackageKey != m.PackageKey && (other.LockPresent || (other.HasReceipt && other.Attempt != nil && other.Attempt.ProductCode == m.Installer.ProductCode)) {
			return out, errors.New("foreign MSI custody blocks upgrade")
		}
	}
	for _, edge := range profile.DependencyEdges {
		if !edge.RecordedReceiptMatches || edge.DependencyPackageKey == m.PackageKey {
			return out, errors.New("upgrade blocked by dependent or changed dependency evidence")
		}
	}
	// This path comes exclusively from the validated prior attempt. Never take
	// arbitrary paths or rollback commands from the renderer/server grant.
	oldPath := filepath.Join(root, "staged", candidate.Attempt.ArtifactSha256, filepath.FromSlash(candidate.Attempt.MSIPath))
	if err := verifyFile(oldPath, candidate.Attempt.MSISha256); err != nil {
		return out, fmt.Errorf("predecessor installer not retained intact: %w", err)
	}
	out.State = "reviewable_not_authorized"
	out.PriorReceiptSha256 = sha
	out.PriorMSIPath = candidate.Attempt.MSIPath
	out.PriorMSISha256 = candidate.Attempt.MSISha256
	out.PriorProductVersion = candidate.Attempt.ProductVersion
	out.TargetProductVersion = m.Installer.ProductVersion
	return out, nil
}

func inspectMSIUpgradeReadiness(o options, priorSha string) (msiUpgradeReadiness, error) {
	var out msiUpgradeReadiness
	if o.Grant != "" || o.TrustedControlKeySha256 != "" {
		return out, errors.New("upgrade review refuses executable authorization")
	}
	m, archive, signingKey, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	if m.Installer == nil {
		return out, errors.New("signed release has no MSI upgrade target")
	}
	if (o.ExpectedPackageKey != "" && o.ExpectedPackageKey != m.PackageKey) || (o.ExpectedVersion != "" && o.ExpectedVersion != m.Version) || (o.ExpectedArtifactSha256 != "" && o.ExpectedArtifactSha256 != m.ArtifactSha256) {
		return out, errors.New("upgrade target changed")
	}
	root, err := filepath.Abs(o.Root)
	if err != nil || directoryNoLinks(root) != nil {
		return out, errors.New("unsafe MSI upgrade profile root")
	}
	if err = verifyStaged(root, m, archive, signingKey); err != nil {
		return out, err
	}
	if err = verifySelectedDependencies(root, m); err != nil {
		return out, err
	}
	sourcePath := filepath.Join(root, "staged", m.ArtifactSha256, filepath.FromSlash(m.Installer.Path))
	if err := verifyRegularDigest(sourcePath, m.Installer.Sha256); err != nil {
		return out, err
	}
	identity, identityErr := inspectStagedMSIProperties(sourcePath, *m.Installer)
	if identityErr != nil || !identity.Verified {
		return out, errors.New("signed upgrade MSI properties do not match")
	}
	if err := requireCurrentUserMSIInstallScope(m.Installer.ProductCode); err != nil {
		return out, err
	}
	profile, err := inspectMSIProfile(root)
	if err != nil {
		return out, err
	}
	return reviewMSIUpgradeWithProfile(root, m, priorSha, profile, verifyRegularDigest)
}
