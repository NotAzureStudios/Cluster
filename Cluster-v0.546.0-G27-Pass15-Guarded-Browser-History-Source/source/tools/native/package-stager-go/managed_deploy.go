package main

// A strictly unprivileged managed-content deployment. The only authority for
// changing the managed pointer is a 60-second deployment grant signed by a
// dedicated server control key, separately pinned by the workstation.
// This does NOT execute files, install system software or attest OS health.
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
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const grantContext = "CLUSTER_MANAGED_DEPLOYMENT_GRANT_V1\n"

type grantEnvelope struct {
	Schema                int    `json:"schema"`
	PayloadBase64url      string `json:"payloadBase64url"`
	SignatureBase64url    string `json:"signatureBase64url"`
	PublicKeyPem          string `json:"publicKeyPem"`
	ControlKeyFingerprint string `json:"controlKeyFingerprint"`
	ExpiresAt             int64  `json:"expiresAt"`
}
type grantPayload struct {
	Schema               int    `json:"schema"`
	Operation            string `json:"operation"`
	PackageKey           string `json:"packageKey"`
	Version              string `json:"version"`
	Platform             string `json:"platform"`
	ArtifactSha256       string `json:"artifactSha256"`
	SigningKeySha256     string `json:"signingKeySha256"`
	ReleaseId            string `json:"releaseId"`
	RegistrationId       string `json:"registrationId"`
	UserId               string `json:"userId"`
	IssuedAt             int64  `json:"issuedAt"`
	ExpiresAt            int64  `json:"expiresAt"`
	Nonce                string `json:"nonce"`
	PriorReceiptSha256   string `json:"priorReceiptSha256,omitempty"`
	PriorMSISha256       string `json:"priorMsiSha256,omitempty"`
	UpgradeJournalSha256 string `json:"upgradeJournalSha256,omitempty"`
	SuccessorMSISha256   string `json:"successorMsiSha256,omitempty"`
}
type managedPointer struct {
	Schema     int        `json:"schema"`
	PackageKey string     `json:"packageKey"`
	Generation uint64     `json:"generation"`
	Active     selection  `json:"active"`
	Previous   *selection `json:"previous"`
	State      string     `json:"state"`
	UpdatedAt  string     `json:"updatedAt"`
}
type managedResult struct {
	Schema         int    `json:"schema"`
	PackageKey     string `json:"packageKey"`
	Version        string `json:"version"`
	ArtifactSha256 string `json:"artifactSha256"`
	Generation     uint64 `json:"generation"`
	State          string `json:"state"`
	Executed       bool   `json:"executed"`
	OSAttested     bool   `json:"osAttested"`
}

func strictJSON(data []byte, value any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing signed grant data")
	}
	return nil
}
func verifyDeploymentGrant(o options, m manifest, packageFingerprint string, operation string, now time.Time) (grantPayload, error) {
	var claim grantPayload
	if o.Grant == "" || len(o.TrustedControlKeySha256) != 64 || o.TrustedControlKeySha256 == o.TrustedKeySha256 {
		return claim, errors.New("independent control-key fingerprint and signed grant required")
	}
	info, err := os.Lstat(o.Grant)
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 8192 {
		return claim, errors.New("invalid or unsafe grant file")
	}
	input, err := os.ReadFile(o.Grant)
	if err != nil {
		return claim, err
	}
	var env grantEnvelope
	if err := strictJSON(input, &env); err != nil {
		return claim, err
	}
	if env.Schema != 1 || len(env.PublicKeyPem) > 2000 {
		return claim, errors.New("invalid grant envelope")
	}
	block, tail := pem.Decode([]byte(env.PublicKeyPem))
	if block == nil || block.Type != "PUBLIC KEY" || len(bytes.TrimSpace(tail)) != 0 {
		return claim, errors.New("invalid control public key")
	}
	publicAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return claim, err
	}
	public, ok := publicAny.(ed25519.PublicKey)
	if !ok {
		return claim, errors.New("control key must be Ed25519")
	}
	hash := sha256.Sum256(block.Bytes)
	keyFingerprint := hex.EncodeToString(hash[:])
	if keyFingerprint != o.TrustedControlKeySha256 || keyFingerprint != env.ControlKeyFingerprint {
		return claim, errors.New("control-key pin mismatch")
	}
	payloadBytes, err := base64.RawURLEncoding.Strict().DecodeString(env.PayloadBase64url)
	if err != nil || len(payloadBytes) > 4096 {
		return claim, errors.New("invalid grant payload")
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(env.SignatureBase64url)
	if err != nil || !ed25519.Verify(public, append([]byte(grantContext), payloadBytes...), signature) {
		return claim, errors.New("grant signature invalid")
	}
	if err := strictJSON(payloadBytes, &claim); err != nil {
		return claim, err
	}
	nowSec := now.Unix()
	if claim.Schema != 1 || claim.Operation != operation || claim.PackageKey != m.PackageKey || claim.Version != m.Version || claim.Platform != m.Platform || claim.ArtifactSha256 != m.ArtifactSha256 || claim.SigningKeySha256 != packageFingerprint || claim.ReleaseId == "" || claim.RegistrationId == "" || claim.UserId == "" || claim.ExpiresAt != env.ExpiresAt || claim.ExpiresAt-claim.IssuedAt != 60 || claim.IssuedAt > nowSec+5 || claim.ExpiresAt <= nowSec || claim.ExpiresAt > nowSec+65 {
		return claim, errors.New("grant expired or does not authorize this exact release and operation")
	}
	if ((operation == "repair" || operation == "uninstall" || operation == "upgrade" || operation == "msi-rollback") && !validDigest(claim.PriorReceiptSha256)) ||
		(operation != "repair" && operation != "uninstall" && operation != "upgrade" && operation != "msi-rollback" && claim.PriorReceiptSha256 != "") {
		return claim, errors.New("signed lifecycle grant missing exact prior installation receipt")
	}
	if ((operation == "upgrade" || operation == "msi-rollback") && !validDigest(claim.PriorMSISha256)) ||
		(operation != "upgrade" && operation != "msi-rollback" && claim.PriorMSISha256 != "") {
		return claim, errors.New("signed upgrade grant missing exact predecessor MSI checksum")
	}
	if (operation == "msi-rollback" && (!validDigest(claim.UpgradeJournalSha256) || !validDigest(claim.SuccessorMSISha256))) ||
		(operation != "msi-rollback" && (claim.UpgradeJournalSha256 != "" || claim.SuccessorMSISha256 != "")) {
		return claim, errors.New("signed MSI rollback is missing a completed upgrade journal or successor source digest")
	}
	nonce, err := base64.RawURLEncoding.Strict().DecodeString(claim.Nonce)
	if err != nil || len(nonce) != 24 {
		return claim, errors.New("invalid one-use grant nonce")
	}
	return claim, nil
}
func readManagedPointer(path, key string) (managedPointer, error) {
	p := managedPointer{Schema: 1, PackageKey: key, State: "managed_content_selected_not_executed"}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if !info.Mode().IsRegular() || info.Size() > 4096 {
		return p, errors.New("unsafe managed pointer")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return p, err
	}
	if err := strictJSON(data, &p); err != nil {
		return p, err
	}
	if p.Schema != 1 || p.PackageKey != key || p.Generation == 0 || p.State != "managed_content_selected_not_executed" || !validSelection(p.Active) || (p.Previous != nil && !validSelection(*p.Previous)) {
		return p, errors.New("invalid managed pointer")
	}
	return p, nil
}
func verifyManagedBytes(path string, archive []byte) error {
	if err := directoryNoLinks(path); err != nil {
		return err
	}
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return err
	}
	expected := map[string]bool{}
	for _, file := range zr.File {
		if err := secureName(file.Name); err != nil {
			return err
		}
		relative := strings.TrimSuffix(file.Name, "/")
		if file.FileInfo().IsDir() {
			continue
		}
		expected[relative] = true
		dest := filepath.Join(path, filepath.FromSlash(relative))
		info, err := os.Lstat(dest)
		if err != nil || !info.Mode().IsRegular() || info.Size() != int64(file.UncompressedSize64) {
			return errors.New("managed file replaced or missing")
		}
		actual, err := os.Open(dest)
		if err != nil {
			return err
		}
		source, err := file.Open()
		if err != nil {
			actual.Close()
			return err
		}
		ha, hb := sha256.New(), sha256.New()
		an, ae := io.Copy(ha, io.LimitReader(actual, maxExpandedSize+1))
		bn, be := io.Copy(hb, io.LimitReader(source, maxExpandedSize+1))
		ac, bc := actual.Close(), source.Close()
		if ae != nil || be != nil || ac != nil || bc != nil || an != bn || an != int64(file.UncompressedSize64) || !bytes.Equal(ha.Sum(nil), hb.Sum(nil)) {
			return errors.New("managed file checksum mismatch")
		}
	}
	return filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == path {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return errors.New("managed symlink refused")
		}
		rel, err := filepath.Rel(path, p)
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() || !expected[filepath.ToSlash(rel)] {
			return errors.New("unexpected managed file")
		}
		return nil
	})
}
func copyToManaged(root, key string, m manifest, archive []byte) error {
	parent := filepath.Join(root, "managed")
	if err := os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	if err := directoryNoLinks(parent); err != nil {
		return err
	}
	pkgDir := filepath.Join(parent, key)
	if err := os.MkdirAll(pkgDir, 0700); err != nil {
		return err
	}
	if err := directoryNoLinks(pkgDir); err != nil {
		return err
	}
	target := filepath.Join(pkgDir, m.ArtifactSha256)
	if _, err := os.Lstat(target); err == nil {
		return verifyManagedBytes(target, archive)
	} else if !os.IsNotExist(err) {
		return err
	}
	temp, err := os.MkdirTemp(pkgDir, ".pending-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return err
	}
	stageDir := filepath.Join(root, "staged", m.ArtifactSha256)
	for _, file := range zr.File {
		dest := filepath.Join(temp, filepath.FromSlash(file.Name))
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(dest, 0700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return err
		}
		src := filepath.Join(stageDir, filepath.FromSlash(file.Name))
		info, err := os.Lstat(src)
		if err != nil || !info.Mode().IsRegular() {
			return errors.New("unsafe staged file during managed copy")
		}
		in, err := os.Open(src)
		if err != nil {
			return err
		}
		out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			in.Close()
			return err
		}
		n, e := io.Copy(out, io.LimitReader(in, maxExpandedSize+1))
		ec, ic := out.Close(), in.Close()
		if e != nil || ec != nil || ic != nil || n != int64(file.UncompressedSize64) {
			return errors.New("incomplete managed copy")
		}
	}
	if err := verifyManagedBytes(temp, archive); err != nil {
		return err
	}
	if err := os.Rename(temp, target); err != nil {
		return err
	}
	return nil
}
func consumeGrant(root string, claim grantPayload) error {
	// A malformed nonce is never a valid one-use grant identity. This function
	// is called only after signature verification, but protects the ledger too.
	if claim.Nonce == "" || !validPackageKey(claim.PackageKey) || claim.Operation == "" {
		return errors.New("invalid signed deployment grant ledger identity")
	}
	if err := directoryNoLinks(root); err != nil {
		return err
	}
	ledger := filepath.Join(root, "grant-consumed")
	if err := os.MkdirAll(ledger, 0700); err != nil {
		return err
	}
	if err := directoryNoLinks(ledger); err != nil {
		return err
	}
	// The directory itself may be new. Persist its parent link before we ever
	// report a one-use grant as consumed, where filesystem support exists.
	if err := syncMSICustodyDirectory(root); err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(claim.Nonce))
	path := filepath.Join(ledger, hex.EncodeToString(digest[:]))
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("grant previously consumed or replay ledger unavailable: %w", err)
	}
	defer file.Close()
	evidence := []byte(claim.PackageKey + "\n" + claim.Operation + "\n")
	if n, e := file.Write(evidence); e != nil || n != len(evidence) {
		return errors.New("grant ledger write incomplete; replay prohibited")
	}
	if err := file.Sync(); err != nil {
		return err
	}
	// Re-open and check the newly-created directory entry while the original
	// exclusive-create handle remains open. This does not authorize replay if
	// an attacker swaps an entry; any ambiguity fails closed.
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || opened.Size() != int64(len(evidence)) {
		return errors.New("grant ledger record has invalid size or type")
	}
	visible, err := os.Lstat(path)
	if err != nil || !visible.Mode().IsRegular() || !os.SameFile(opened, visible) {
		return errors.New("grant ledger entry identity changed during publication")
	}
	if err := syncMSICustodyParent(path); err != nil {
		return err
	}
	return nil
}

func deployManagedContent(o options, operation string, now time.Time) (managedResult, error) {
	var out managedResult
	if operation != "deploy" && operation != "rollback" {
		return out, errors.New("unsupported managed operation")
	}
	m, archive, fp, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	grant, err := verifyDeploymentGrant(o, m, fp, operation, now)
	if err != nil {
		return out, err
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return out, err
	}
	if err := directoryNoLinks(root); err != nil {
		return out, err
	}
	if err := verifyStaged(root, m, archive, fp); err != nil {
		return out, err
	}
	// Prerequisites must already be selected before consuming the one-use grant.
	if err := verifySelectedDependencies(root, m); err != nil {
		return out, err
	}
	lockParent := filepath.Join(root, "managed-active")
	if err := os.MkdirAll(lockParent, 0700); err != nil {
		return out, err
	}
	if err := directoryNoLinks(lockParent); err != nil {
		return out, err
	}
	lockPath := filepath.Join(lockParent, m.PackageKey+".lock")
	if err := os.Mkdir(lockPath, 0700); err != nil {
		return out, fmt.Errorf("managed deployment lock unavailable: %w", err)
	}
	defer os.Remove(lockPath)
	pointerPath := filepath.Join(lockParent, m.PackageKey+".json")
	current, err := readManagedPointer(pointerPath, m.PackageKey)
	if err != nil {
		return out, err
	}
	next := selection{Version: m.Version, ArchiveSha256: m.ArtifactSha256, SigningKeySha256: fp}
	if operation == "rollback" {
		if current.Previous == nil || *current.Previous != next {
			return out, errors.New("rollback grant target is not previous managed release")
		}
	} else if current.Generation > 0 && current.Active == next {
		return out, errors.New("managed release already current")
	}
	if err := consumeGrant(root, grant); err != nil {
		return out, err
	}
	if err := copyToManaged(root, m.PackageKey, m, archive); err != nil {
		return out, err
	}
	prev := current.Active
	if current.Generation > 0 {
		current.Previous = &prev
	} else {
		current.Previous = nil
	}
	current.Active = next
	current.Generation++
	current.UpdatedAt = now.UTC().Format(time.RFC3339Nano)
	current.State = "managed_content_selected_not_executed"
	raw, err := json.Marshal(current)
	if err != nil {
		return out, err
	}
	// writePointer performs an fsynced atomic replacement and uses a private temp.
	// The managed pointer schema is structurally different but shares write discipline.
	if err := writeRawAtomic(pointerPath, raw); err != nil {
		return out, err
	}
	return managedResult{Schema: 1, PackageKey: m.PackageKey, Version: m.Version, ArtifactSha256: m.ArtifactSha256,
		Generation: current.Generation, State: current.State, Executed: false, OSAttested: false}, nil
}
func writeRawAtomic(path string, bytes []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".managed-pointer-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err := file.Chmod(0600); err != nil {
		file.Close()
		return err
	}
	if _, err := file.Write(bytes); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

// A current-or-previous managed copy can be audited against an independently
// pinned, signed release. The operation does not consume a grant, alter any
// pointers, start a process or make an installation claim. The caller must
// provide the exact signed kit being checked; local pointer metadata is not
// accepted as evidence of integrity.
type managedAudit struct {
	Schema           int    `json:"schema"`
	PackageKey       string `json:"packageKey"`
	Version          string `json:"version"`
	ArtifactSha256   string `json:"artifactSha256"`
	SigningKeySha256 string `json:"signingKeySha256"`
	Generation       uint64 `json:"generation"`
	Slot             string `json:"slot"`
	State            string `json:"state"`
	Executed         bool   `json:"executed"`
	OSAttested       bool   `json:"osAttested"`
}

func auditManagedContent(o options) (managedAudit, error) {
	var out managedAudit
	if o.Grant != "" || o.TrustedControlKeySha256 != "" {
		return out, errors.New("read-only audit refuses deployment grant material")
	}
	m, archive, fingerprint, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	if (o.ExpectedArtifactSha256 != "" && o.ExpectedArtifactSha256 != m.ArtifactSha256) ||
		(o.ExpectedPackageKey != "" && o.ExpectedPackageKey != m.PackageKey) ||
		(o.ExpectedVersion != "" && o.ExpectedVersion != m.Version) {
		return out, errors.New("managed audit does not match selected Package target")
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return out, err
	}
	if err := directoryNoLinks(root); err != nil {
		return out, err
	}
	// Read-only operation, no creation of empty state directories merely to audit.
	current, err := managedStatus(root, m.PackageKey)
	if err != nil {
		return out, err
	}
	candidate := selection{Version: m.Version, ArchiveSha256: m.ArtifactSha256, SigningKeySha256: fingerprint}
	slot := ""
	if current.Active == candidate {
		slot = "active"
	} else if current.Previous != nil && *current.Previous == candidate {
		slot = "previous"
	}
	if slot == "" {
		return out, errors.New("signed release is neither the current nor previous managed selection")
	}
	if err := verifyStaged(root, m, archive, fingerprint); err != nil {
		return out, err
	}
	parent := filepath.Join(root, "managed")
	pkgDir := filepath.Join(parent, m.PackageKey)
	contentDir := filepath.Join(pkgDir, m.ArtifactSha256)
	for _, dir := range []string{parent, pkgDir, contentDir} {
		if err := directoryNoLinks(dir); err != nil {
			return out, err
		}
	}
	if err := verifyManagedBytes(contentDir, archive); err != nil {
		return out, err
	}
	// A simultaneous deployment could change the pointer during verification.
	// Check the generation and selected slot again before reporting success.
	after, err := managedStatus(root, m.PackageKey)
	if err != nil {
		return out, err
	}
	if after.Generation != current.Generation || after.Active != current.Active ||
		(after.Previous == nil) != (current.Previous == nil) ||
		(after.Previous != nil && *after.Previous != *current.Previous) {
		return out, errors.New("managed selection changed during integrity audit")
	}
	return managedAudit{Schema: 1, PackageKey: m.PackageKey, Version: m.Version,
		ArtifactSha256: m.ArtifactSha256, SigningKeySha256: fingerprint,
		Generation: current.Generation, Slot: slot, State: "verified_managed_content_not_executed",
		Executed: false, OSAttested: false}, nil
}

func managedStatus(root, key string) (managedPointer, error) {
	var p managedPointer
	if !validPackageKey(key) {
		return p, errors.New("invalid Package key")
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return p, err
	}
	if err := directoryNoLinks(absolute); err != nil {
		return p, err
	}
	if err := directoryNoLinks(filepath.Join(absolute, "managed-active")); err != nil {
		return p, err
	}
	p, err = readManagedPointer(filepath.Join(absolute, "managed-active", key+".json"), key)
	if err != nil {
		return p, err
	}
	if p.Generation == 0 {
		return p, errors.New("no managed content")
	}
	return p, nil
}
