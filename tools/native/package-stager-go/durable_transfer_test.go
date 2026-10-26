package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func digestForTest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func TestDurableTransferLifecycle(t *testing.T) {
	root := t.TempDir()
	payload := []byte("verified signed archive bytes split into three chunks")
	id := digestForTest(payload)
	checkpoint, err := beginTransfer(root, id, int64(len(payload)))
	if err != nil {
		t.Fatal(err)
	}
	if checkpoint.ReceivedBytes != 0 || checkpoint.State != "receiving" {
		t.Fatal(checkpoint)
	}
	if _, err = beginTransfer(root, id, int64(len(payload))); err == nil {
		t.Fatal("duplicate begin accepted")
	}
	for _, part := range [][]byte{payload[:10], payload[10:21], payload[21:]} {
		checkpoint, err = inspectTransfer(root, id)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = appendTransfer(root, id, checkpoint.ReceivedBytes+1, part); err == nil {
			t.Fatal("stale offset accepted")
		}
		if _, err = appendTransfer(root, id, checkpoint.ReceivedBytes, part); err != nil {
			t.Fatal(err)
		}
	}
	checkpoint, err = commitTransfer(root, id)
	if err != nil {
		t.Fatal(err)
	}
	if checkpoint.State != "committed" || checkpoint.ReceivedBytes != int64(len(payload)) {
		t.Fatal(checkpoint)
	}
	recorded, err := inspectTransfer(root, id)
	if err != nil || recorded.PrefixSha256 != id {
		t.Fatal("bad committed evidence", err)
	}
	_, part, archive, _, _ := transferPaths(root, id)
	if _, err = os.Stat(part); !os.IsNotExist(err) {
		t.Fatal("part still exists after commit")
	}
	result, err := os.ReadFile(archive)
	if err != nil || string(result) != string(payload) {
		t.Fatal("archive mismatch", err)
	}
	if _, err = appendTransfer(root, id, int64(len(payload)), []byte("x")); err == nil {
		t.Fatal("append after commit accepted")
	}
}
func TestDurableTransferRejectsTamperAndMismatch(t *testing.T) {
	root := t.TempDir()
	payload := []byte("complete bytes")
	digest := digestForTest(payload)
	if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, []byte("wrong")); err != nil {
		t.Fatal(err)
	}
	if _, err := commitTransfer(root, digest); err == nil {
		t.Fatal("incomplete transfer committed")
	}
	_, part, _, _, _ := transferPaths(root, digest)
	if err := os.WriteFile(part, []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("tampered disk bytes accepted")
	}
	if _, err := appendTransfer(root, digest, 5, []byte("x")); err == nil {
		t.Fatal("unsafe replay after tamper accepted")
	}
}
func TestDurableTransferHashMismatchBeforePromotion(t *testing.T) {
	root := t.TempDir()
	digest := digestForTest([]byte("good"))
	if _, err := beginTransfer(root, digest, 3); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, []byte("bad")); err != nil {
		t.Fatal(err)
	}
	if _, err := commitTransfer(root, digest); err == nil {
		t.Fatal("wrong full digest committed")
	}
}
func TestDurableTransferRefusesSymlinkCheckpointAndLock(t *testing.T) {
	root := t.TempDir()
	digest := digestForTest([]byte("abc"))
	if _, err := beginTransfer(root, digest, 3); err != nil {
		t.Fatal(err)
	}
	meta, _, _, lock, _ := transferPaths(root, digest)
	if err := os.WriteFile(lock, []byte("occupied"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, []byte("abc")); err == nil {
		t.Fatal("stranded lock accepted")
	}
	os.Remove(lock)
	if err := os.Remove(meta); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "external"), meta); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("checkpoint symlink accepted")
	}
}
func TestDurableTransferRejectsUnsafeIdentityAndOverrun(t *testing.T) {
	root := t.TempDir()
	id := strings.Repeat("a", 64)
	for _, candidate := range []string{"../outside", strings.Repeat("f", 63), strings.ToUpper(id)} {
		if _, err := beginTransfer(root, candidate, 5); err == nil {
			t.Fatalf("accepted %q", candidate)
		}
	}
	if _, err := beginTransfer(root, id, maxTransferSize+1); err == nil {
		t.Fatal("oversized transfer accepted")
	}
	if _, err := beginTransfer(root, id, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, id, 0, []byte("too long")); err == nil {
		t.Fatal("overrun accepted")
	}
	if _, err := appendTransfer(root, id, 0, make([]byte, maxTransferChunk+1)); err == nil {
		t.Fatal("large segment accepted")
	}
}

func TestDurableTransferOfferBindingAcrossRestart(t *testing.T) {
	root := t.TempDir()
	payload := []byte("a separately authorized native ZIP archive")
	digest := digestForTest(payload)
	if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	offer := transferOffer{DeploymentID: "deployment_abc", PackageID: "package_123", ReleaseID: "release_456", Channel: "stable", Platform: "windows-x64"}
	checkpoint, err := bindTransferOffer(root, digest, offer)
	if err != nil || checkpoint.Offer == nil || *checkpoint.Offer != offer {
		t.Fatalf("offer not bound: %+v, %v", checkpoint, err)
	}
	if _, err := appendTransfer(root, digest, 0, payload[:11]); err != nil {
		t.Fatal(err)
	}
	// Simulate restarting Qt/Go: only the written checkpoint survives.
	checkpoint, err = inspectTransfer(root, digest)
	if err != nil || checkpoint.Offer == nil || *checkpoint.Offer != offer || checkpoint.ReceivedBytes != 11 {
		t.Fatalf("restart checkpoint failed: %+v, %v", checkpoint, err)
	}
	if _, err := bindTransferOffer(root, digest, offer); err != nil {
		t.Fatal("idempotent bind", err)
	}
	wrong := offer
	wrong.DeploymentID = "another_deployment"
	if _, err := bindTransferOffer(root, digest, wrong); err == nil {
		t.Fatal("rebound an existing identity")
	}
	wrong = offer
	wrong.PackageID = "another_package"
	if _, err := bindTransferOffer(root, digest, wrong); err == nil {
		t.Fatal("changed the bound Package")
	}
	if _, err := appendTransfer(root, digest, 11, payload[11:]); err != nil {
		t.Fatal(err)
	}
	if _, err := commitTransfer(root, digest); err != nil {
		t.Fatal(err)
	}
	checkpoint, err = inspectTransfer(root, digest)
	if err != nil || checkpoint.Offer == nil || *checkpoint.Offer != offer {
		t.Fatal("offer not preserved across commit", err)
	}
}

func TestDurableTransferOfferRejectsBearerAndTampering(t *testing.T) {
	root := t.TempDir()
	digest := digestForTest([]byte("xyz"))
	if _, err := beginTransfer(root, digest, 3); err != nil {
		t.Fatal(err)
	}
	base := transferOffer{DeploymentID: "deployment_abc", PackageID: "pkg_123", ReleaseID: "release_345", Channel: "stable", Platform: "windows-x64"}
	for _, malformed := range []transferOffer{
		{DeploymentID: "Bearer secret", PackageID: base.PackageID, ReleaseID: base.ReleaseID, Channel: base.Channel, Platform: base.Platform},
		{DeploymentID: base.DeploymentID, PackageID: "../traversal", ReleaseID: base.ReleaseID, Channel: base.Channel, Platform: base.Platform},
		{DeploymentID: base.DeploymentID, PackageID: base.PackageID, ReleaseID: base.ReleaseID, Channel: "untrusted", Platform: base.Platform},
	} {
		if _, err := bindTransferOffer(root, digest, malformed); err == nil {
			t.Fatal("invalid offer accepted", malformed)
		}
	}
	if _, err := bindTransferOffer(root, digest, base); err != nil {
		t.Fatal(err)
	}
	meta, _, _, _, err := transferPaths(root, digest)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(meta)
	if err != nil {
		t.Fatal(err)
	}
	corrupted := strings.Replace(string(data), "deployment_abc", "Bearer token", 1)
	if err := os.WriteFile(meta, []byte(corrupted), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("corrupt persisted metadata accepted")
	}
}

// G19: A verified transport ZIP alone cannot stage anything. The signed
// sidecars and an independently provisioned pin must all match the checkpoint.
func TestStageCommittedTransferRequiresIndependentSignatureAndPin(t *testing.T) {
	signed, zipped := fixture(t, "assets/readme.txt", []byte("independent native stage"))
	transport := t.TempDir()
	digest := digestForTest(zipped)
	if _, err := beginTransfer(transport, digest, int64(len(zipped))); err != nil {
		t.Fatal(err)
	}
	manifestBytes, _ := os.ReadFile(signed.Manifest)
	sigBytes, _ := os.ReadFile(signed.Signature)
	keyBytes, _ := os.ReadFile(signed.PublicKey)
	envelope, err := json.Marshal(transferStageSidecars{Manifest: manifestBytes, SignatureBase64: string(sigBytes), PublicKeyPem: string(keyBytes)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stageCommittedTransfer(transport, signed.Root, digest, "test-package", "1.2.3", signed.TrustedKeySha256, envelope); err == nil {
		t.Fatal("uncommitted archive staged")
	}
	if _, err := appendTransfer(transport, digest, 0, zipped); err != nil {
		t.Fatal(err)
	}
	if _, err := commitTransfer(transport, digest); err != nil {
		t.Fatal(err)
	}
	if _, err := stageCommittedTransfer(transport, signed.Root, digest, "test-package", "1.2.4", signed.TrustedKeySha256, envelope); err == nil {
		t.Fatal("wrong selected version staged")
	}
	if _, err := stageCommittedTransfer(transport, signed.Root, digest, "test-package", "1.2.3", strings.Repeat("a", 64), envelope); err == nil {
		t.Fatal("wrong independent pin staged")
	}
	tampered := append([]byte(nil), envelope...)
	if i := strings.Index(string(tampered), "test-package"); i >= 0 {
		copy(tampered[i:i+12], "fake-package")
	}
	if _, err := stageCommittedTransfer(transport, signed.Root, digest, "test-package", "1.2.3", signed.TrustedKeySha256, tampered); err == nil {
		t.Fatal("tampered manifest staged")
	}
	verified, err := stageCommittedTransfer(transport, signed.Root, digest, "test-package", "1.2.3", signed.TrustedKeySha256, envelope)
	if err != nil || verified.State != "verified_staged_not_installed" || verified.ArchiveSha256 != digest {
		t.Fatal("trusted staging failed", err)
	}
	if _, err := stageCommittedTransfer(transport, signed.Root, digest, "test-package", "1.2.3", signed.TrustedKeySha256, envelope); err == nil {
		t.Fatal("duplicate stage should not replace content")
	}
}
