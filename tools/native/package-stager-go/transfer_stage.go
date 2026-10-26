package main

// Move a committed, independently hashed transport archive into the ordinary
// signed staging verifier. No download challenge or install/deploy grant is
// accepted. The ONLY trust root is the separately provisioned SPKI pin.
import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type transferStageSidecars struct {
	Manifest        json.RawMessage `json:"manifest"`
	SignatureBase64 string          `json:"signatureBase64"`
	PublicKeyPem    string          `json:"publicKeyPem"`
}

func stageCommittedTransfer(transportRoot, stageRoot, digest, key, version, pin string, sidecarJSON []byte) (stageEvidence, error) {
	var result stageEvidence
	if transportRoot == "" || stageRoot == "" || !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(digest) ||
		!validPackageKey(key) || !regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$`).MatchString(version) ||
		!regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(pin) || len(sidecarJSON) < 100 || len(sidecarJSON) > 8192 {
		return result, errors.New("invalid transfer-stage identity or sidecar envelope")
	}
	var signed transferStageSidecars
	if err := strictJSON(sidecarJSON, &signed); err != nil {
		return result, err
	}
	if len(signed.Manifest) < 40 || len(signed.Manifest) > 4096 || len(signed.SignatureBase64) != 88 ||
		!regexp.MustCompile(`^[A-Za-z0-9+/]{86}==$`).MatchString(signed.SignatureBase64) ||
		len(signed.PublicKeyPem) < 100 || len(signed.PublicKeyPem) > 4096 ||
		!strings.HasPrefix(signed.PublicKeyPem, "-----BEGIN PUBLIC KEY-----") {
		return result, errors.New("invalid signed sidecars")
	}
	// Verify the signed manifest claims against requested identity before any
	// staging root is created. Later stage() verifies the actual Ed25519 proof.
	var declared manifest
	if err := strictJSON(signed.Manifest, &declared); err != nil {
		return result, err
	}
	if declared.ArtifactSha256 != digest || declared.PackageKey != key || declared.Version != version {
		return result, errors.New("signed manifest does not match retained target")
	}
	meta, part, archive, lock, err := transferPaths(transportRoot, digest)
	if err != nil {
		return result, err
	}
	unlock, err := transferLock(lock)
	if err != nil {
		return result, err
	}
	defer unlock()
	checkpoint, err := readTransferCheckpoint(meta, part, archive)
	if err != nil {
		return result, err
	}
	if checkpoint.State != "committed" || checkpoint.Digest != digest || checkpoint.PrefixSha256 != digest ||
		checkpoint.ExpectedBytes != int64(declared.ArtifactSize) {
		return result, errors.New("not an independently verified committed archive")
	}
	if _, err := checkedTransferFile(archive); err != nil {
		return result, err
	}
	// Sidecars are written to an OS-generated private directory, not a caller
	// path. They are destroyed after the existing independent verifier finishes.
	work, err := os.MkdirTemp(filepath.Dir(meta), ".signed-sidecars-")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(work)
	write := func(name string, data []byte) (string, error) {
		path := filepath.Join(work, name)
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return "", err
		}
		_, err = io.Copy(f, bytes.NewReader(data))
		if err == nil {
			err = f.Sync()
		}
		closed := f.Close()
		if err == nil {
			err = closed
		}
		return path, err
	}
	manifestPath, err := write("manifest.json", signed.Manifest)
	if err != nil {
		return result, err
	}
	signaturePath, err := write("signature.txt", []byte(signed.SignatureBase64))
	if err != nil {
		return result, err
	}
	publicPath, err := write("public-key.pem", []byte(signed.PublicKeyPem))
	if err != nil {
		return result, err
	}
	o := options{Root: stageRoot, Archive: archive, Manifest: manifestPath, Signature: signaturePath, PublicKey: publicPath,
		TrustedKeySha256: pin, ExpectedArtifactSha256: digest, ExpectedPackageKey: key, ExpectedVersion: version}
	dest, err := stage(o)
	if err != nil {
		return result, err
	}
	data, err := os.ReadFile(filepath.Join(dest, ".cluster-package-stage.json"))
	if err != nil {
		return result, err
	}
	if err := strictJSON(data, &result); err != nil {
		return result, err
	}
	if result.State != "verified_staged_not_installed" || result.ArchiveSha256 != digest ||
		result.PackageKey != key || result.Version != version || result.SigningKeySha256 != pin {
		return stageEvidence{}, errors.New("native stage evidence does not match signed target")
	}
	return result, nil
}
