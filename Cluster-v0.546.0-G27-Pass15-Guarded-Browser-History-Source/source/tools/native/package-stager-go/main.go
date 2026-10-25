// Cluster Package Stager: verify an independently pinned Ed25519 identity
// and signed ZIP before extracting to a quarantined, immutable staging tree.
// This tool NEVER runs an extracted file or modifies the active installation.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

const signingContext = "CLUSTER_MANAGED_PACKAGE_V1\n"
const maxArtifactSize = 32 * 1024 * 1024
const maxContentArtifactSize = 4 * 1024 * 1024
const maxExpandedSize = 64 * 1024 * 1024
const maxFiles = 500

type manifest struct {
	Schema         int                 `json:"schema"`
	PackageKey     string              `json:"packageKey"`
	Version        string              `json:"version"`
	Platform       string              `json:"platform"`
	ArtifactSha256 string              `json:"artifactSha256"`
	ArtifactSize   int                 `json:"artifactSize"`
	Filename       string              `json:"filename"`
	Dependencies   []packageDependency `json:"dependencies,omitempty"`
	Installer      *msiInstaller       `json:"installer,omitempty"`
}
type packageDependency struct {
	PackageKey  string `json:"packageKey"`
	Version     string `json:"version"`
	Requirement string `json:"requirement"`
}

type options struct{ Kit, Archive, Manifest, Signature, PublicKey, TrustedKeySha256, TrustedControlKeySha256, Grant, Root, ExpectedArtifactSha256, ExpectedPackageKey, ExpectedVersion string }
type stageEvidence struct {
	Schema           int    `json:"schema"`
	PackageKey       string `json:"packageKey"`
	Version          string `json:"version"`
	Platform         string `json:"platform"`
	ArchiveSha256    string `json:"archiveSha256"`
	SigningKeySha256 string `json:"signingKeySha256"`
	State            string `json:"state"`
}

func hostPlatform() string {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "windows/amd64":
		return "windows-x64"
	case "linux/amd64":
		return "linux-x64"
	case "darwin/arm64":
		return "macos-arm64"
	default:
		return "unsupported"
	}
}

func secureName(name string) error {
	if name == "" || strings.ContainsAny(name, "\\:\x00") || strings.HasPrefix(name, "/") || strings.HasPrefix(name, "//") {
		return errors.New("unsafe archive path")
	}
	parts := strings.Split(name, "/")
	for i, part := range parts {
		if part == "" && i == len(parts)-1 && strings.HasSuffix(name, "/") {
			continue
		}
		if part == "" || part == "." || part == ".." || strings.TrimRight(part, ". ") != part {
			return errors.New("unsafe archive path segment")
		}
		for _, r := range part {
			if r < 32 || r == 127 {
				return errors.New("unsafe control character")
			}
		}
		b := strings.SplitN(strings.ToUpper(part), ".", 2)[0]
		if b == "CON" || b == "PRN" || b == "AUX" || b == "NUL" || (len(b) == 4 && (strings.HasPrefix(b, "COM") || strings.HasPrefix(b, "LPT")) && b[3] >= '1' && b[3] <= '9') {
			return errors.New("reserved Windows archive path")
		}
	}
	return nil
}

func verifyInput(o options) (manifest, []byte, string, error) {
	var m manifest
	if o.TrustedKeySha256 == "" || o.Root == "" {
		return m, nil, "", errors.New("independent trusted key SHA-256 and private root required")
	}
	var archive, input, signatureBytes, keyBytes []byte
	var err error
	if o.Kit != "" {
		if o.Archive != "" || o.Manifest != "" || o.Signature != "" || o.PublicKey != "" {
			return m, nil, "", errors.New("kit cannot be mixed with sidecar paths")
		}
		archive, input, signatureBytes, keyBytes, err = readStagingKit(o.Kit)
		if err != nil {
			return m, nil, "", err
		}
	} else {
		if o.Archive == "" || o.Manifest == "" || o.Signature == "" || o.PublicKey == "" {
			return m, nil, "", errors.New("all signed release sidecar files are required")
		}
		if archive, err = os.ReadFile(o.Archive); err != nil {
			return m, nil, "", err
		}
		if input, err = os.ReadFile(o.Manifest); err != nil {
			return m, nil, "", err
		}
		if signatureBytes, err = os.ReadFile(o.Signature); err != nil {
			return m, nil, "", err
		}
		if keyBytes, err = os.ReadFile(o.PublicKey); err != nil {
			return m, nil, "", err
		}
	}
	if len(archive) == 0 || len(archive) > maxArtifactSize || len(input) > 4096 || len(signatureBytes) > 4096 || len(keyBytes) > 4096 {
		return m, nil, "", errors.New("release or sidecar exceeds bound")
	}
	dec := json.NewDecoder(bytes.NewReader(input))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&m); err != nil {
		return m, nil, "", err
	}
	if err = dec.Decode(new(any)); err != io.EOF {
		return m, nil, "", errors.New("extra manifest content")
	}
	if (m.Installer == nil && len(archive) > maxContentArtifactSize) || m.Schema != 1 || m.ArtifactSize != len(archive) || m.Platform != hostPlatform() || !validPackageKey(m.PackageKey) || !regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$`).MatchString(m.Version) || !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,149}\.zip$`).MatchString(m.Filename) {
		return m, nil, "", errors.New("manifest incompatible")
	}
	if err := validateManifestDependencies(m); err != nil {
		return m, nil, "", err
	}
	if err := validateMSIInstaller(m, archive); err != nil {
		return m, nil, "", err
	}
	hash := sha256.Sum256(archive)
	actual := hex.EncodeToString(hash[:])
	if m.ArtifactSha256 != actual {
		return m, nil, "", errors.New("archive hash mismatch")
	}
	block, _ := pem.Decode(keyBytes)
	if block == nil || block.Type != "PUBLIC KEY" {
		return m, nil, "", errors.New("invalid trusted public key")
	}
	pubAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return m, nil, "", err
	}
	pub, ok := pubAny.(ed25519.PublicKey)
	if !ok {
		return m, nil, "", errors.New("only Ed25519 allowed")
	}
	keyDigest := sha256.Sum256(block.Bytes)
	keyHash := hex.EncodeToString(keyDigest[:])
	if keyHash != o.TrustedKeySha256 {
		return m, nil, "", errors.New("independent signing key pin mismatch")
	}
	canonical, err := json.Marshal(m)
	if err != nil {
		return m, nil, "", err
	}
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(signatureBytes)))
	if err != nil {
		return m, nil, "", err
	}
	if !ed25519.Verify(pub, append([]byte(signingContext), canonical...), sig) {
		return m, nil, "", errors.New("invalid release signature")
	}
	return m, archive, keyHash, nil
}

// Stage to a private temporary folder. No process execution, script hooks,
// symlink extraction or activation. Never replace an existing stage.
func stage(o options) (string, error) {
	m, archive, keyFingerprint, err := verifyInput(o)
	if err != nil {
		return "", err
	}
	// A target supplied by the UI is an identity constraint, NOT authorization.
	// Verify it against the independently pinned, signed manifest before touching disk.
	if (o.ExpectedArtifactSha256 != "" && o.ExpectedArtifactSha256 != m.ArtifactSha256) ||
		(o.ExpectedPackageKey != "" && o.ExpectedPackageKey != m.PackageKey) ||
		(o.ExpectedVersion != "" && o.ExpectedVersion != m.Version) {
		return "", errors.New("selected Package target does not match the signed staging kit")
	}
	files, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return "", err
	}
	if len(files.File) == 0 || len(files.File) > maxFiles {
		return "", errors.New("invalid entry count")
	}
	names := make(map[string]bool)
	var expanded uint64
	regular := 0
	for _, f := range files.File {
		if err := secureName(f.Name); err != nil {
			return "", err
		}
		if strings.EqualFold(f.Name, ".cluster-package-stage.json") {
			return "", errors.New("package reserved metadata filename")
		}
		lowered := strings.ToLower(f.Name)
		if names[lowered] {
			return "", errors.New("duplicate archive path")
		}
		names[lowered] = true
		mode := f.Mode()
		if mode&os.ModeSymlink != 0 || (!mode.IsRegular() && !mode.IsDir()) {
			return "", errors.New("unsupported archive file type")
		}
		if f.Method != zip.Store && f.Method != zip.Deflate {
			return "", errors.New("unsupported ZIP method")
		}
		expanded += f.UncompressedSize64
		if expanded > maxExpandedSize || f.UncompressedSize64 > maxExpandedSize {
			return "", errors.New("ZIP expanded size exceeded")
		}
		if f.UncompressedSize64 > 0 && (f.CompressedSize64 == 0 || f.UncompressedSize64 > f.CompressedSize64*100) {
			return "", errors.New("excessive compression expansion")
		}
		if !mode.IsDir() {
			regular++
		}
	}
	if regular == 0 {
		return "", errors.New("package contains no files")
	}
	// Caller must choose a trusted root: reject symlink roots and stage location.
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	if info, err := os.Lstat(root); err != nil || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("unsafe staging root")
	}
	if resolved, err := filepath.EvalSymlinks(root); err != nil || resolved != root {
		return "", errors.New("staging root contains a symlink")
	}
	stages := filepath.Join(root, "staged")
	if err := os.MkdirAll(stages, 0700); err != nil {
		return "", err
	}
	if info, err := os.Lstat(stages); err != nil || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("unsafe staging directory")
	}
	temp, err := os.MkdirTemp(stages, ".uncommitted-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temp)
	for _, f := range files.File {
		destination := filepath.Join(temp, filepath.FromSlash(f.Name))
		relative, err := filepath.Rel(temp, destination)
		if err != nil || strings.HasPrefix(relative, "..") || filepath.IsAbs(relative) {
			return "", errors.New("archive escapes staging root")
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(destination, 0700); err != nil {
				return "", err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			return "", err
		}
		reader, err := f.Open()
		if err != nil {
			return "", err
		}
		file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			reader.Close()
			return "", err
		}
		written, copyErr := io.Copy(file, io.LimitReader(reader, maxExpandedSize+1))
		closeErr := file.Close()
		readErr := reader.Close()
		if copyErr != nil || closeErr != nil || readErr != nil || written != int64(f.UncompressedSize64) {
			return "", errors.New("archive data or CRC verification failed")
		}
	}
	evidence := stageEvidence{Schema: 1, PackageKey: m.PackageKey, Version: m.Version, Platform: m.Platform, ArchiveSha256: m.ArtifactSha256, SigningKeySha256: keyFingerprint, State: "verified_staged_not_installed"}
	evidenceBytes, _ := json.MarshalIndent(evidence, "", "  ")
	if err := os.WriteFile(filepath.Join(temp, ".cluster-package-stage.json"), evidenceBytes, 0600); err != nil {
		return "", err
	}
	target := filepath.Join(stages, m.ArtifactSha256)
	// Do not replace an existing directory or silently overwrite its evidence.
	if _, err := os.Lstat(target); err == nil {
		return "", errors.New("this artifact has already been staged")
	} else if !os.IsNotExist(err) {
		return "", err
	}
	if err := os.Rename(temp, target); err != nil {
		return "", err
	}
	return target, nil
}

func main() {
	o := options{}
	action := flag.String("action", "stage", "stage | verify-stage | preview-files | audit-files | copy-missing-files | sync-files | replace-files | rollback-files | preview-installer | preview-upgrade | msi-rollback-review | msi-rollback-cascade | msi-incident-worklist | msi-rollback-status | rollback-msi | upgrade-msi | install-msi | msi-attempt-status | msi-profile-status | msi-repair-status | repair-msi | msi-uninstall-status | uninstall-msi | deploy-content | rollback-content | audit-managed | managed-status | activate | rollback | status | audit")
	destination := flag.String("destination", "", "existing user-selected destination folder for file preview/audit/sync/rollback")
	statusKey := flag.String("package-key", "", "package key for status")
	priorReceipt := flag.String("prior-receipt-sha256", "", "exact prior MSI installation receipt, upgrade review only")
	transferDigest := flag.String("transfer-sha256", "", "signed release archive SHA-256 for durable byte staging")
	transferSize := flag.Int64("transfer-size", 0, "expected transfer byte count, begin only")
	transferOffset := flag.Int64("transfer-offset", 0, "verified current byte offset, append only")
	transferChunkSize := flag.Int("transfer-chunk-size", 0, "exact stdin chunk bytes, append only (max 4 MiB)")
	transferOfferID := flag.String("transfer-offer-id", "", "nonsecret device-offer identity for transfer-bind")
	transferPackageID := flag.String("transfer-package-id", "", "offer Package identity")
	transferReleaseID := flag.String("transfer-release-id", "", "offer release identity")
	transferChannel := flag.String("transfer-channel", "", "offer channel")
	transferPlatform := flag.String("transfer-platform", "", "offer platform")
	stagingRoot := flag.String("staging-root", "", "native-controlled staging root for transfer-stage only")
	flag.StringVar(&o.Kit, "kit", "", "five-entry Cluster staging kit ZIP (stage or verify-stage)")
	flag.StringVar(&o.Archive, "archive", "", "signed ZIP archive")
	flag.StringVar(&o.Manifest, "manifest", "", "JSON manifest")
	flag.StringVar(&o.Signature, "signature", "", "base64 signature file")
	flag.StringVar(&o.PublicKey, "public-key", "", "Ed25519 public PEM")
	flag.StringVar(&o.TrustedKeySha256, "trusted-key-sha256", "", "independently pinned SHA-256 of public DER")
	flag.StringVar(&o.TrustedControlKeySha256, "trusted-control-key-sha256", "", "independent deployment-control public key SHA-256")
	flag.StringVar(&o.Grant, "grant", "", "server-signed short-lived managed deployment grant JSON")
	flag.StringVar(&o.ExpectedArtifactSha256, "expected-artifact-sha256", "", "optional selected release SHA-256; does not grant entitlement")
	flag.StringVar(&o.ExpectedPackageKey, "expected-package-key", "", "optional selected Package key")
	flag.StringVar(&o.ExpectedVersion, "expected-version", "", "optional selected Package version")
	flag.StringVar(&o.Root, "root", "", "isolated staging root")
	flag.Parse()
	if o.Kit != "" && *action != "stage" && *action != "verify-stage" && *action != "deploy-content" && *action != "rollback-content" && *action != "audit-managed" && *action != "preview-files" && *action != "audit-files" && *action != "copy-missing-files" && *action != "sync-files" && *action != "replace-files" && *action != "rollback-files" && *action != "preview-installer" && *action != "preview-upgrade" && *action != "upgrade-msi" && *action != "rollback-msi" && *action != "install-msi" && *action != "repair-msi" && *action != "uninstall-msi" {
		fmt.Fprintln(os.Stderr, "staging kit mode is only allowed for stage or verify-stage")
		os.Exit(2)
	}
	if o.ExpectedArtifactSha256 != "" && !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(o.ExpectedArtifactSha256) {
		fmt.Fprintln(os.Stderr, "invalid expected artifact digest")
		os.Exit(2)
	}
	if (*action != "transfer-stage" && *action != "stage" && *action != "verify-stage" && *action != "audit-managed" && *action != "preview-files" && *action != "audit-files" && *action != "copy-missing-files" && *action != "sync-files" && *action != "replace-files" && *action != "rollback-files" && *action != "preview-installer" && *action != "preview-upgrade") && (o.ExpectedArtifactSha256 != "" || o.ExpectedPackageKey != "" || o.ExpectedVersion != "") {
		fmt.Fprintln(os.Stderr, "stage target constraints cannot authorize activation")
		os.Exit(2)
	}
	if *priorReceipt != "" && *action != "preview-upgrade" {
		fmt.Fprintln(os.Stderr, "prior receipt only supported for read-only upgrade preview")
		os.Exit(2)
	}
	if *destination != "" && *action != "preview-files" && *action != "audit-files" && *action != "copy-missing-files" && *action != "sync-files" && *action != "replace-files" && *action != "rollback-files" {
		fmt.Fprintln(os.Stderr, "destination only supported in file preview/audit/sync/rollback")
		os.Exit(2)
	}
	if *stagingRoot != "" && *action != "transfer-stage" {
		fmt.Fprintln(os.Stderr, "staging root only allowed for transfer-stage")
		os.Exit(2)
	}
	if strings.HasPrefix(*action, "transfer-") {
		if o.Root == "" || *transferDigest == "" || o.Kit != "" || o.Archive != "" || o.Manifest != "" || o.Grant != "" || o.Signature != "" || o.PublicKey != "" || (*action != "transfer-stage" && o.TrustedKeySha256 != "") || o.TrustedControlKeySha256 != "" || *destination != "" {
			fmt.Fprintln(os.Stderr, "transfer staging accepts only private root, SHA-256 and bounded byte controls")
			os.Exit(2)
		}
		var checkpoint transferCheckpoint
		var err error
		if *action != "transfer-bind" && (*transferOfferID != "" || *transferPackageID != "" || *transferReleaseID != "" || *transferChannel != "" || *transferPlatform != "") {
			fmt.Fprintln(os.Stderr, "offer identity only permitted during transfer-bind")
			os.Exit(2)
		}
		switch *action {
		case "transfer-stage":
			if *stagingRoot == "" || o.TrustedKeySha256 == "" || o.ExpectedPackageKey == "" || o.ExpectedVersion == "" || o.ExpectedArtifactSha256 != *transferDigest {
				fmt.Fprintln(os.Stderr, "transfer-stage requires selected target and independent signing pin")
				os.Exit(2)
			}
			sidecars, readErr := io.ReadAll(io.LimitReader(os.Stdin, 8193))
			if readErr != nil {
				fmt.Fprintln(os.Stderr, "invalid signed sidecars")
				os.Exit(2)
			}
			evidence, stageErr := stageCommittedTransfer(o.Root, *stagingRoot, *transferDigest, o.ExpectedPackageKey, o.ExpectedVersion, o.TrustedKeySha256, sidecars)
			if stageErr != nil {
				fmt.Fprintln(os.Stderr, "retained staging refused:", stageErr)
				os.Exit(1)
			}
			encoded, _ := json.Marshal(evidence)
			fmt.Println("CLUSTER_STAGE_RESULT " + string(encoded))
			return
		case "transfer-diagnose":
			observed, inspectErr := diagnoseTransfer(o.Root, *transferDigest)
			if inspectErr != nil {
				fmt.Fprintln(os.Stderr, "native transfer diagnostic refused:", inspectErr)
				os.Exit(1)
			}
			output, _ := json.Marshal(observed)
			fmt.Println("CLUSTER_TRANSFER_DIAGNOSTIC " + string(output))
			return
		case "transfer-recover":
			recovered, recoveryErr := recoverTransfer(o.Root, *transferDigest)
			if recoveryErr != nil {
				fmt.Fprintln(os.Stderr, "retained transfer recovery refused:", recoveryErr)
				os.Exit(1)
			}
			output, _ := json.Marshal(recovered)
			fmt.Println("CLUSTER_TRANSFER_CHECKPOINT " + string(output))
			return
		case "transfer-bind":
			checkpoint, err = bindTransferOffer(o.Root, *transferDigest, transferOffer{
				DeploymentID: *transferOfferID, PackageID: *transferPackageID, ReleaseID: *transferReleaseID,
				Channel: *transferChannel, Platform: *transferPlatform,
			})
		case "transfer-begin":
			checkpoint, err = beginTransfer(o.Root, *transferDigest, *transferSize)
		case "transfer-append":
			if *transferChunkSize < 1 || *transferChunkSize > maxTransferChunk {
				fmt.Fprintln(os.Stderr, "invalid transfer chunk length")
				os.Exit(2)
			}
			bytes, readErr := io.ReadAll(io.LimitReader(os.Stdin, int64(maxTransferChunk)+1))
			if readErr != nil || len(bytes) != *transferChunkSize {
				fmt.Fprintln(os.Stderr, "transfer stdin length mismatch")
				os.Exit(2)
			}
			checkpoint, err = appendTransfer(o.Root, *transferDigest, *transferOffset, bytes)
		case "transfer-inspect":
			checkpoint, err = inspectTransfer(o.Root, *transferDigest)
		case "transfer-commit":
			checkpoint, err = commitTransfer(o.Root, *transferDigest)
		default:
			fmt.Fprintln(os.Stderr, "unknown transfer action")
			os.Exit(2)
		}
		if err != nil {
			if *action == "transfer-inspect" && os.IsNotExist(err) {
				fmt.Fprintln(os.Stderr, "CLUSTER_TRANSFER_NOT_FOUND")
				os.Exit(3)
			}
			fmt.Fprintln(os.Stderr, "durable transfer refused:", err)
			os.Exit(1)
		}
		out, _ := json.Marshal(checkpoint)
		fmt.Println("CLUSTER_TRANSFER_CHECKPOINT " + string(out))
		return
	}
	switch *action {
	case "msi-uninstall-status":
		if o.Root == "" || *statusKey == "" || o.Kit != "" || o.Archive != "" || o.Manifest != "" || o.Signature != "" || o.PublicKey != "" || o.Grant != "" || o.TrustedKeySha256 != "" || o.TrustedControlKeySha256 != "" {
			fmt.Fprintln(os.Stderr, "uninstall status accepts only a private root and Package key")
			os.Exit(2)
		}
		result, err := inspectMSIUninstall(o.Root, *statusKey)
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI uninstall status unreadable:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_UNINSTALL_STATUS " + string(encoded))
	case "msi-repair-status":
		if o.Grant != "" || o.TrustedControlKeySha256 != "" || o.Kit != "" || o.Archive != "" || o.Manifest != "" || o.Signature != "" || o.PublicKey != "" {
			fmt.Fprintln(os.Stderr, "repair inspection refuses executable authority and release material")
			os.Exit(2)
		}
		result, err := inspectMSIRepair(o.Root, *statusKey)
		if err != nil {
			fmt.Fprintln(os.Stderr, "repair inspection refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_REPAIR_STATUS " + string(encoded))
	case "msi-rollback-review":
		if o.Grant != "" || o.TrustedControlKeySha256 != "" || o.TrustedKeySha256 != "" || o.Kit != "" || o.Archive != "" || o.Manifest != "" || o.Signature != "" || o.PublicKey != "" || o.ExpectedArtifactSha256 != "" || o.ExpectedPackageKey != "" || o.ExpectedVersion != "" || *priorReceipt != "" {
			fmt.Fprintln(os.Stderr, "rollback review accepts only the private root and Package key")
			os.Exit(2)
		}
		result, err := inspectMSIRollbackReview(o.Root, *statusKey)
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI rollback review refused:", err)
			os.Exit(1)
		}
		encoded, e := json.Marshal(result)
		if e != nil || len(encoded) > 32*1024 {
			fmt.Fprintln(os.Stderr, "MSI rollback review too large")
			os.Exit(1)
		}
		fmt.Println("CLUSTER_MSI_ROLLBACK_REVIEW " + string(encoded))
	case "msi-rollback-cascade":
		if o.Grant != "" || o.TrustedControlKeySha256 != "" || o.TrustedKeySha256 != "" || o.Kit != "" || o.Archive != "" || o.Manifest != "" || o.Signature != "" || o.PublicKey != "" || o.ExpectedArtifactSha256 != "" || o.ExpectedPackageKey != "" || o.ExpectedVersion != "" || *priorReceipt != "" {
			fmt.Fprintln(os.Stderr, "cascade review accepts only the private root and Package key")
			os.Exit(2)
		}
		result, err := inspectMSIRollbackCascade(o.Root, *statusKey)
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI rollback cascade refused:", err)
			os.Exit(1)
		}
		encoded, err := json.Marshal(result)
		if err != nil || len(encoded) > 64*1024 {
			fmt.Fprintln(os.Stderr, "MSI rollback cascade too large")
			os.Exit(1)
		}
		fmt.Println("CLUSTER_MSI_ROLLBACK_CASCADE " + string(encoded))
	case "msi-incident-worklist":
		if o.Grant != "" || o.TrustedControlKeySha256 != "" || o.TrustedKeySha256 != "" || o.Kit != "" || o.Archive != "" || o.Manifest != "" || o.Signature != "" || o.PublicKey != "" || o.ExpectedArtifactSha256 != "" || o.ExpectedPackageKey != "" || o.ExpectedVersion != "" || *priorReceipt != "" || *statusKey != "" {
			fmt.Fprintln(os.Stderr, "MSI incident worklist accepts only a private profile root")
			os.Exit(2)
		}
		result, err := inspectMSIIncidentWorklist(o.Root)
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI incident worklist refused:", err)
			os.Exit(1)
		}
		encoded, err := json.Marshal(result)
		if err != nil || len(encoded) > 128*1024 {
			fmt.Fprintln(os.Stderr, "MSI incident worklist too large")
			os.Exit(1)
		}
		fmt.Println("CLUSTER_MSI_INCIDENT_WORKLIST " + string(encoded))
	case "msi-rollback-status":
		if o.Grant != "" || o.TrustedControlKeySha256 != "" || o.Kit != "" || o.Archive != "" || o.Manifest != "" || o.Signature != "" || o.PublicKey != "" {
			fmt.Fprintln(os.Stderr, "MSI rollback journal inspection accepts no executable authority")
			os.Exit(2)
		}
		result, err := inspectMSIRollback(o.Root, *statusKey)
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI rollback journal unreadable:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_ROLLBACK_STATUS " + string(encoded))
	case "msi-upgrade-status":
		if o.Grant != "" || o.TrustedControlKeySha256 != "" || o.Kit != "" || o.Archive != "" || o.Manifest != "" || o.Signature != "" || o.PublicKey != "" {
			fmt.Fprintln(os.Stderr, "MSI upgrade status is read-only and accepts no release or grant")
			os.Exit(2)
		}
		result, err := inspectMSIUpgrade(o.Root, *statusKey)
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI upgrade journal refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_UPGRADE_STATUS " + string(encoded))
	case "msi-profile-status":
		if o.Grant != "" || o.TrustedControlKeySha256 != "" || o.Kit != "" || o.Archive != "" || o.Manifest != "" || o.Signature != "" || o.PublicKey != "" || *statusKey != "" {
			fmt.Fprintln(os.Stderr, "MSI profile inventory cannot receive a target, authorization or release material")
			os.Exit(2)
		}
		result, err := inspectMSIProfile(o.Root)
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI profile inventory refused:", err)
			os.Exit(1)
		}
		encoded, marshalErr := json.Marshal(result)
		if marshalErr != nil || len(encoded) > 768*1024 {
			fmt.Fprintln(os.Stderr, "MSI profile inventory exceeds native response size limit")
			os.Exit(1)
		}
		fmt.Println("CLUSTER_MSI_PROFILE_STATUS " + string(encoded))
	case "msi-attempt-status":
		if o.Grant != "" || o.TrustedControlKeySha256 != "" || o.Kit != "" || o.Archive != "" || o.Manifest != "" || o.Signature != "" || o.PublicKey != "" {
			fmt.Fprintln(os.Stderr, "MSI attempt status cannot receive authorization or release material")
			os.Exit(2)
		}
		result, err := inspectMSIAttempt(o.Root, *statusKey)
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI attempt evidence refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_ATTEMPT_STATUS " + string(encoded))
	case "preview-upgrade":
		if !validDigest(*priorReceipt) || o.Grant != "" || o.TrustedControlKeySha256 != "" || *statusKey != "" {
			fmt.Fprintln(os.Stderr, "read-only MSI upgrade review requires only an exact prior receipt and signed release")
			os.Exit(2)
		}
		result, err := inspectMSIUpgradeReadiness(o, *priorReceipt)
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI upgrade readiness blocked:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_UPGRADE_READINESS " + string(encoded))
	case "preview-installer":
		result, err := previewMSIInstaller(o)
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI preflight refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_PREVIEW " + string(encoded))
	case "rollback-msi":
		result, err := rollbackSupervisedMSI(o, time.Now())
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI rollback refused or outcome unknown:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_ROLLBACK_RESULT " + string(encoded))
	case "upgrade-msi":
		result, err := upgradeSupervisedMSI(o, time.Now())
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI upgrade refused or outcome unknown:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_UPGRADE_RESULT " + string(encoded))
	case "uninstall-msi":
		result, err := uninstallSupervisedMSI(o, time.Now())
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI uninstall refused or incomplete:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_UNINSTALL_RESULT " + string(encoded))
	case "repair-msi":
		result, err := repairSupervisedMSI(o, time.Now())
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI repair refused or incomplete:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_REPAIR_RESULT " + string(encoded))
	case "install-msi":
		result, err := installSupervisedMSI(o, time.Now())
		if err != nil {
			fmt.Fprintln(os.Stderr, "MSI installation refused or incomplete:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MSI_RESULT " + string(encoded))
	case "sync-files", "replace-files", "rollback-files":
		out, err := syncFolder(o, *destination, *action == "rollback-files", *action == "replace-files")
		if err != nil {
			fmt.Fprintln(os.Stderr, "Destination file update refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(out)
		fmt.Println("CLUSTER_FILE_SYNC_RESULT " + string(encoded))
	case "copy-missing-files":
		result, err := applyMissingManagedFiles(o, *destination)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Managed file copy refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_FILE_UPDATE_RESULT " + string(encoded))
	case "audit-files":
		result, err := auditDestinationFiles(o, *destination)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Destination audit refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_FILE_AUDIT_RESULT " + string(encoded))
	case "preview-files":
		result, err := compareManagedDestination(o, *destination)
		if err != nil {
			fmt.Fprintln(os.Stderr, "File update preview refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(result)
		fmt.Println("CLUSTER_FILE_UPDATE_PREVIEW " + string(encoded))
	case "stage":
		dest, err := stage(o)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Package staging refused:", err)
			os.Exit(1)
		}
		fmt.Println("Verified, staged, not installed:", dest)
		// Machine-readable evidence is produced by the verifier, not inferred from
		// a selected filename or a browser claim. This is not OS attestation.
		data, err := os.ReadFile(filepath.Join(dest, ".cluster-package-stage.json"))
		if err == nil {
			var evidence stageEvidence
			if json.Unmarshal(data, &evidence) == nil {
				result, _ := json.Marshal(evidence)
				fmt.Println("CLUSTER_STAGE_RESULT " + string(result))
			}
		}
	case "verify-stage":
		out, err := auditStagedContent(o)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Package stage audit refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(out)
		fmt.Println("CLUSTER_STAGE_AUDIT_RESULT " + string(encoded))
	case "deploy-content", "rollback-content":
		op := "deploy"
		if *action == "rollback-content" {
			op = "rollback"
		}
		result, err := deployManagedContent(o, op, time.Now())
		if err != nil {
			fmt.Fprintln(os.Stderr, "Managed Package operation refused:", err)
			os.Exit(1)
		}
		output, _ := json.Marshal(result)
		fmt.Println("CLUSTER_MANAGED_CONTENT_RESULT " + string(output))
	case "audit-managed":
		out, err := auditManagedContent(o)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Managed Package integrity audit refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(out)
		fmt.Println("CLUSTER_MANAGED_AUDIT_RESULT " + string(encoded))
	case "managed-status":
		if o.Grant != "" || o.TrustedControlKeySha256 != "" {
			fmt.Fprintln(os.Stderr, "status does not accept authorization material")
			os.Exit(2)
		}
		state, err := managedStatus(o.Root, *statusKey)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Managed content status unavailable:", err)
			os.Exit(1)
		}
		output, _ := json.Marshal(state)
		fmt.Println(string(output))
	case "activate", "rollback":
		selected, err := selectContent(o, *action == "rollback")
		if err != nil {
			fmt.Fprintln(os.Stderr, "Package selection refused:", err)
			os.Exit(1)
		}
		result, _ := json.Marshal(selected)
		fmt.Println(string(result))
	case "audit":
		out, err := auditSelectedContent(o)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Package audit refused:", err)
			os.Exit(1)
		}
		encoded, _ := json.Marshal(out)
		fmt.Println(string(encoded))
	case "status":
		p, err := selectionStatus(o.Root, *statusKey)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Package status unavailable:", err)
			os.Exit(1)
		}
		result, _ := json.Marshal(p)
		fmt.Println(string(result))
	default:
		fmt.Fprintln(os.Stderr, "unknown action")
		os.Exit(2)
	}
}
