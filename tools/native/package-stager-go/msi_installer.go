package main

// The MSI path is a distinct, explicitly privileged protocol. A content-deploy
// grant NEVER authorizes process execution. Only independently pinned release
// and control keys, an install-specific grant, and an explicitly signed MSI
// member can reach this entry point. This is not machine-wide OS attestation.
import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

type msiInstaller struct {
	Kind           string `json:"kind"`
	Path           string `json:"path"`
	Sha256         string `json:"sha256"`
	Scope          string `json:"scope"`
	ProductCode    string `json:"productCode"`
	ProductVersion string `json:"productVersion"`
}
type msiPreview struct {
	Schema            int                 `json:"schema"`
	PackageKey        string              `json:"packageKey"`
	Version           string              `json:"version"`
	ArtifactSha256    string              `json:"artifactSha256"`
	MSIPath           string              `json:"msiPath"`
	MSISha256         string              `json:"msiSha256"`
	Scope             string              `json:"scope"`
	DependenciesReady bool                `json:"dependenciesReady"`
	Product           msiProductState     `json:"product"`
	Identity          msiIdentityEvidence `json:"identity"`
	State             string              `json:"state"`
	ReadOnly          bool                `json:"readOnly"`
	OSAttested        bool                `json:"osAttested"`
}
type msiAttempt struct {
	Schema                int                     `json:"schema"`
	PackageKey            string                  `json:"packageKey"`
	Version               string                  `json:"version"`
	ArtifactSha256        string                  `json:"artifactSha256"`
	MSISha256             string                  `json:"msiSha256"`
	MSIPath               string                  `json:"msiPath,omitempty"`
	ProductCode           string                  `json:"productCode"`
	ProductVersion        string                  `json:"productVersion"`
	State                 string                  `json:"state"`
	StartedAt             string                  `json:"startedAt"`
	LaunchCommittedAt     string                  `json:"launchCommittedAt,omitempty"`
	FinishedAt            string                  `json:"finishedAt,omitempty"`
	ExitCode              int                     `json:"exitCode,omitempty"`
	OSAttested            bool                    `json:"osAttested"`
	BootAnchor            *msiBootAnchor          `json:"bootAnchor,omitempty"`
	PreLaunchRegistration *msiProductState        `json:"preLaunchRegistration,omitempty"`
	PostExitRegistration  *msiProductState        `json:"postExitRegistration,omitempty"`
	Dependencies          []msiDependencyEvidence `json:"dependencies,omitempty"`
}

var msiPathPattern = regexp.MustCompile(`^[A-Za-z0-9_./-]+\.msi$`)
var msiProductCodePattern = regexp.MustCompile(`^\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\}$`)
var msiProductVersionPattern = regexp.MustCompile(`^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$`)

func validateMSIInstaller(m manifest, archive []byte) error {
	if m.Installer == nil {
		return nil
	}
	ins := m.Installer
	if m.Platform != "windows-x64" || ins.Kind != "windows-msi" || ins.Scope != "user" || len(ins.Path) > 220 ||
		!msiPathPattern.MatchString(ins.Path) || secureName(ins.Path) != nil || !validDigest(ins.Sha256) ||
		!msiProductCodePattern.MatchString(ins.ProductCode) || !msiProductVersionPattern.MatchString(ins.ProductVersion) {
		return errors.New("unsafe or unsupported signed MSI declaration")
	}
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return err
	}
	found := 0
	for _, f := range zr.File {
		if f.Name != ins.Path {
			continue
		}
		found++
		if found > 1 || !f.Mode().IsRegular() || f.UncompressedSize64 == 0 || f.UncompressedSize64 > maxExpandedSize {
			return errors.New("invalid signed MSI member")
		}
		r, err := f.Open()
		if err != nil {
			return err
		}
		magic := make([]byte, 8)
		if _, err := io.ReadFull(r, magic); err != nil || !bytes.Equal(magic, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}) {
			r.Close()
			return errors.New("MSI compound-file signature missing")
		}
		hash := sha256.New()
		hash.Write(magic)
		nRest, copyErr := io.Copy(hash, io.LimitReader(r, maxExpandedSize+1))
		n := nRest + int64(len(magic))
		closeErr := r.Close()
		if copyErr != nil || closeErr != nil || n != int64(f.UncompressedSize64) ||
			hex.EncodeToString(hash.Sum(nil)) != ins.Sha256 {
			return errors.New("signed MSI bytes or checksum mismatch")
		}
	}
	if found != 1 {
		return errors.New("signed MSI member missing")
	}
	return nil
}
func previewMSIInstaller(o options) (msiPreview, error) {
	var out msiPreview
	if o.Grant != "" || o.TrustedControlKeySha256 != "" {
		return out, errors.New("read-only preview refuses executable authorization")
	}
	m, archive, fingerprint, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	if m.Installer == nil {
		return out, errors.New("signed release has no installer declaration")
	}
	if (o.ExpectedPackageKey != "" && o.ExpectedPackageKey != m.PackageKey) ||
		(o.ExpectedVersion != "" && o.ExpectedVersion != m.Version) ||
		(o.ExpectedArtifactSha256 != "" && o.ExpectedArtifactSha256 != m.ArtifactSha256) {
		return out, errors.New("MSI does not match selected release")
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return out, err
	}
	if err = directoryNoLinks(root); err != nil {
		return out, err
	}
	if err = verifyStaged(root, m, archive, fingerprint); err != nil {
		return out, err
	}
	if err = verifySelectedDependencies(root, m); err != nil {
		return out, err
	}
	path := filepath.Join(root, "staged", m.ArtifactSha256, filepath.FromSlash(m.Installer.Path))
	if err = verifyRegularDigest(path, m.Installer.Sha256); err != nil {
		return out, err
	}
	identity, identityErr := inspectStagedMSIProperties(path, *m.Installer)
	if hostPlatform() == "windows-x64" && identityErr != nil {
		return out, fmt.Errorf("signed MSI Property identity verification refused: %w", identityErr)
	}
	product, queryErr := queryInstalledMSIProduct(m.Installer.ProductCode, m.Installer.ProductVersion)
	if queryErr != nil {
		product = msiProductState{State: "os_query_unavailable", ProductCode: m.Installer.ProductCode, ExpectedVersion: m.Installer.ProductVersion, ReadOnly: true, OSAttested: false}
	}
	return msiPreview{Schema: 1, PackageKey: m.PackageKey, Version: m.Version,
		ArtifactSha256: m.ArtifactSha256, MSIPath: m.Installer.Path, MSISha256: m.Installer.Sha256,
		Scope: "user", DependenciesReady: true, Product: product, Identity: identity, State: "msi_verified_not_executed", ReadOnly: true, OSAttested: false}, nil
}

// writeMSIAttemptReceipt writes a complete JSON receipt before any MSI
// execution. writeRawAtomic syncs the file before rename; directory sync is
// attempted where supported. A receipt is evidence, never retry permission.
func writeMSIAttemptReceipt(path string, attempt msiAttempt) error {
	data, err := json.Marshal(attempt)
	if err != nil {
		return err
	}
	if err := writeRawAtomic(path, data); err != nil {
		return err
	}
	return syncMSICustodyParent(path)
}

// The installer attempt lock outlives individual helper processes on a crash.
// Only its original creator may remove it during a normal return; a replaced
// directory represents another operation or tampering and must survive for
// operator review. Never break locks based on age or PID.
func acquireMSIInstallLock(parent, key string) (func(), error) {
	if !validPackageKey(key) {
		return nil, errors.New("invalid MSI lock identity")
	}
	if err := directoryNoLinks(parent); err != nil {
		return nil, err
	}
	lock := filepath.Join(parent, key+".lock")
	if err := os.Mkdir(lock, 0700); err != nil {
		return nil, errors.New("MSI operation active or interrupted; manual investigation required")
	}
	if err := syncMSICustodyDirectory(parent); err != nil {
		return nil, err // Leave the lock behind; a failed flush is not replay authority.
	}
	original, err := os.Lstat(lock)
	if err != nil || !original.IsDir() || original.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("MSI operation lock cannot be verified")
	}
	return func() {
		current, err := os.Lstat(lock)
		if err == nil && current.IsDir() && current.Mode()&os.ModeSymlink == 0 && os.SameFile(original, current) {
			_ = os.Remove(lock) // succeeds only for our original empty directory
		}
	}, nil
}

// Write the pre-launch record *before* grant consumption. A consumed grant
// without a receipt obscures the difference between non-execution and an
// interrupted install; it must not silently become a second install grant.
func prepareMSIInstall(receiptPath, root string, claim grantPayload, attempt msiAttempt) error {
	if attempt.State != "msi_prepared_not_launched" || attempt.LaunchCommittedAt != "" || attempt.FinishedAt != "" {
		return errors.New("invalid MSI preparation state")
	}
	if err := writeMSIAttemptReceipt(receiptPath, attempt); err != nil {
		return err
	}
	return consumeGrant(root, claim)
}

// Only the Windows-specific function launches msiexec, with fixed argv and no
// shell. Other platforms refuse operation. Caller cannot specify arguments.
func runVerifiedMSI(source *msiFrozenSource, baseline msiProductState, root string, m manifest, deps []msiDependencyEvidence) (int, error) {
	return runWindowsUserMSI(source, baseline, root, m, deps)
}
func installSupervisedMSI(o options, now time.Time) (msiAttempt, error) {
	var out msiAttempt
	if hostPlatform() != "windows-x64" {
		return out, errors.New("supervised MSI supported only on Windows x64")
	}
	m, archive, fingerprint, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	if m.Installer == nil {
		return out, errors.New("release does not declare a signed MSI")
	}
	if _, err := verifyDeploymentGrant(o, m, fingerprint, "install", now); err != nil {
		return out, err
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return out, err
	}
	if err = directoryNoLinks(root); err != nil {
		return out, err
	}
	if err = verifyStaged(root, m, archive, fingerprint); err != nil {
		return out, err
	}
	if err = verifySelectedDependencies(root, m); err != nil {
		return out, err
	}
	installerPath := filepath.Join(root, "staged", m.ArtifactSha256, filepath.FromSlash(m.Installer.Path))
	if err = verifyRegularDigest(installerPath, m.Installer.Sha256); err != nil {
		return out, err
	}
	if identity, identityErr := inspectStagedMSIProperties(installerPath, *m.Installer); identityErr != nil || !identity.Verified {
		return out, fmt.Errorf("signed MSI Property identity mismatch or unreadable: %v", identityErr)
	}
	parent := filepath.Join(root, "msi-attempts")
	if err = os.MkdirAll(parent, 0700); err != nil {
		return out, err
	}
	if err = directoryNoLinks(parent); err != nil {
		return out, err
	}
	// The per-Package lock cannot close the concurrent different-key race:
	// both installers could inspect an empty custody directory before either
	// publishes its first receipt. Serialize ALL profile-local MSI attempts,
	// including their Windows Installer execution, using an atomic directory.
	// A crash preserves this lock for operator review; it is never stolen.
	unlockAdmission, err := acquireMSIInstallLock(root, "msi-admission")
	if err != nil {
		return out, err
	}
	defer unlockAdmission()
	unlock, err := acquireMSIInstallLock(parent, m.PackageKey)
	if err != nil {
		return out, err
	}
	defer unlock()
	receipt := filepath.Join(parent, m.PackageKey+".json")
	// Never silently retry a previously started native installer, including
	// after a crash, partial failure, or successful msiexec return.
	if _, err = os.Lstat(receipt); err == nil {
		return out, errors.New("prior MSI attempt needs operator review; automatic retry refused")
	}
	if !os.IsNotExist(err) {
		return out, err
	}
	claim, err := verifyDeploymentGrant(o, m, fingerprint, "install", now)
	if err != nil {
		return out, err
	}
	// The package-key receipt is not enough: another signed Package can carry
	// the same ProductCode, or Windows may already register it. Refuse upgrade,
	// repair and cross-Package reinstallation before grant consumption.
	if err = requireNoForeignMSIAttemptForProduct(root, m.PackageKey, m.Installer.ProductCode); err != nil {
		return out, err
	}
	product, productErr := queryInstalledMSIProduct(m.Installer.ProductCode, m.Installer.ProductVersion)
	if err = requireFreshMSIProductRegistration(product, productErr, m.Installer.ProductCode, m.Installer.ProductVersion); err != nil {
		return out, err
	}
	// A selected managed-content pointer is not an installed MSI. Inspect each
	// signed prerequisite against its prior receipt AND live Windows registration.
	dependencies, err := inspectMSIInstalledDependencies(root, m)
	if err != nil {
		return out, fmt.Errorf("MSI dependency admission refused: %w", err)
	}
	// Persist a non-authorizing, fail-closed PRE-LAUNCH receipt before consuming
	// a one-use grant. A crash between grant consumption and receipt creation
	// previously left neither receipt nor reliable evidence for the operator.
	// A failed consume now leaves an inspectable preparation record, and the
	// caller cannot execute or automatically retry the installer.
	receiptStarted := time.Now().UTC()
	bootAnchor := captureMSIBootAnchor()
	out = msiAttempt{Schema: 1, PackageKey: m.PackageKey, Version: m.Version,
		ArtifactSha256: m.ArtifactSha256, MSISha256: m.Installer.Sha256, MSIPath: m.Installer.Path,
		ProductCode: m.Installer.ProductCode, ProductVersion: m.Installer.ProductVersion,
		State: "msi_prepared_not_launched", StartedAt: receiptStarted.Format(time.RFC3339Nano),
		BootAnchor: bootAnchor, OSAttested: false, Dependencies: dependencies}
	if err = prepareMSIInstall(receipt, root, claim, out); err != nil {
		return out, err
	}
	// Reread immediately before execution. A changed MSI is blocked with its
	// prepared receipt intact, rather than misreported as a launched process.
	if err = verifyRegularDigest(installerPath, m.Installer.Sha256); err != nil {
		return out, err
	}
	// Reinspect Windows Installer immediately before marking launch committed.
	// Another Windows application can install the same product outside this
	// profile's lock. An intervening registration leaves the prepared receipt
	// intact for human review rather than launching a repair/reinstall with an
	// already-consumed one-use grant.
	latestProduct, latestErr := queryInstalledMSIProduct(m.Installer.ProductCode, m.Installer.ProductVersion)
	if err = requireFreshMSIProductRegistration(latestProduct, latestErr, m.Installer.ProductCode, m.Installer.ProductVersion); err != nil {
		return out, fmt.Errorf("MSI registration changed after admission; manual review required: %w", err)
	}
	if err = requireUnchangedMSIInstalledDependencies(root, m, dependencies); err != nil {
		return out, err
	}
	if err = requireNoConflictingMSILifecycle(root, m.Installer.ProductCode); err != nil {
		return out, err
	}
	// Acquire and validate a read-only Windows handle denying write/delete
	// sharing BEFORE declaring launch commitment. This handle stays open
	// through process exit and closes before releasing global admission.
	frozenSource, err := acquireMSIFrozenSource(installerPath, m.Installer.Sha256)
	if err != nil {
		return out, fmt.Errorf("MSI source could not be frozen; prepared receipt retained: %w", err)
	}
	defer frozenSource.close()
	// This transition is the last step BEFORE msiexec is invoked. If Cluster
	// crashes after it, execution is ambiguous and automatic retry is refused.
	out.PreLaunchRegistration = &latestProduct
	out.State = "msi_started_outcome_unknown"
	out.LaunchCommittedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err = writeMSIAttemptReceipt(receipt, out); err != nil {
		return out, err
	}
	exit, execErr := runVerifiedMSI(frozenSource, latestProduct, root, m, dependencies)
	out.ExitCode = exit
	// Snapshot registration even on a failed or timed-out msiexec attempt.
	// An OS query failure becomes explicit unavailable evidence, never success.
	post := observeMSIPostExitRegistration(m.Installer.ProductCode, m.Installer.ProductVersion, queryInstalledMSIProduct)
	out.PostExitRegistration = &post
	out.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if execErr != nil {
		out.State = "msi_failed_or_outcome_unknown"
	} else if exit == 0 {
		out.State = "msi_exit_zero_not_os_attested"
	} else if exit == 3010 {
		out.State = "msi_restart_required_not_os_attested"
	} else {
		out.State = "msi_failed_or_outcome_unknown"
	}
	if err = writeMSIAttemptReceipt(receipt, out); err != nil {
		return out, fmt.Errorf("installer result unknown; receipt write failed: %w", err)
	}
	if execErr != nil {
		return out, fmt.Errorf("MSI process failed: %w", execErr)
	}
	if exit != 0 && exit != 3010 {
		return out, fmt.Errorf("MSI returned exit code %d", exit)
	}
	return out, nil
}

// Installer execution never accepts command-line arguments from renderer-controlled fields.
