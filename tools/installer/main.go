// Cluster Installer: portable, prebuilt Windows Server deployment.
// Source compilation is available only as an explicit developer override.
package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// The ZIP is generated temporarily by build-cluster-installer.mjs and never
// checked into source. Do not embed an executable inside its own input archive.
//
//go:embed assets/bundled-source.zip Install-Cluster.ps1
var payload embed.FS

const installerName = "Cluster Installer"
const markerName = ".cluster-installer-managed.json"

// Release identity comes from the embedded, hash-verified payload. It is
// intentionally independent of timestamps, neighboring files and old installs.
type releaseIdentity struct {
	Schema        int    `json:"schema"`
	Release       string `json:"release"`
	Sequence      int    `json:"sequence"`
	SourceVersion string `json:"sourceVersion"`
	Channel       string `json:"channel"`
}

func embeddedReleaseInfo(bundle []byte) (releaseIdentity, error) {
	var release releaseIdentity
	archive, err := zip.NewReader(bytes.NewReader(bundle), int64(len(bundle)))
	if err != nil {
		return release, err
	}
	for _, item := range archive.File {
		if item.Name != "source/config/release-candidate.json" {
			continue
		}
		if item.UncompressedSize64 > 8192 {
			return release, errors.New("release metadata too large")
		}
		r, err := item.Open()
		if err != nil {
			return release, err
		}
		body, err := io.ReadAll(io.LimitReader(r, 8193))
		closeErr := r.Close()
		if err != nil {
			return release, err
		}
		if closeErr != nil {
			return release, closeErr
		}
		if len(body) > 8192 {
			return release, errors.New("release metadata too large")
		}
		if err = json.Unmarshal(body, &release); err != nil {
			return release, err
		}
		if release.Schema != 1 || release.Channel != "rc" || release.Release == "" || release.Sequence < 1 || release.SourceVersion == "" {
			return release, errors.New("invalid RC release identity")
		}
		return release, nil
	}
	return release, errors.New("installer source missing release candidate identity")
}
// The packaged Windows installer must contain a built-runtime admission receipt.
// The installer cannot silently fall back to compiling a source snapshot.
func embeddedPrebuiltInfo(bundle []byte, release releaseIdentity) error {
 archive, err := zip.NewReader(bytes.NewReader(bundle), int64(len(bundle)))
 if err != nil { return err }
 for _, item := range archive.File {
  if item.Name != "source/config/prebuilt-runtime.json" { continue }
  if item.UncompressedSize64 > 32768 { return errors.New("prebuilt metadata is too large") }
  r, err := item.Open()
  if err != nil { return err }
  body, err := io.ReadAll(io.LimitReader(r, 32769))
  closeErr := r.Close()
  if err != nil { return err }
  if closeErr != nil { return closeErr }
  if len(body) > 32768 { return errors.New("prebuilt metadata is too large") }
  var metadata struct {
   Schema int `json:"schema"`
   Product string `json:"product"`
   Kind string `json:"kind"`
   Release string `json:"release"`
   Sequence int `json:"sequence"`
   SourceVersion string `json:"sourceVersion"`
   Commit string `json:"commit"`
   RequiredArtifacts map[string]string `json:"requiredArtifacts"`
  }
  if err := json.Unmarshal(body, &metadata); err != nil { return err }
  if metadata.Schema != 1 || metadata.Product != "cluster-server" ||
   metadata.Kind != "prebuilt-windows-x64" || metadata.Release != release.Release ||
   metadata.Sequence != release.Sequence || metadata.SourceVersion != release.SourceVersion ||
   len(metadata.Commit) != 40 || len(metadata.RequiredArtifacts) < 10 {
    return errors.New("prebuilt installer metadata does not match its release")
   }
  return nil
 }
 return errors.New("prebuilt Windows runtime is missing; ordinary installation cannot compile source")
}
func readManagedSequence(marker string) (int, string) {
	body, err := os.ReadFile(marker)
	if err != nil {
		return 0, ""
	}
	var state struct {
		ManagedBy string `json:"managedBy"`
		Sequence  int    `json:"releaseSequence"`
		Release   string `json:"releaseCandidate"`
	}
	if json.Unmarshal(bytes.TrimPrefix(body, []byte{0xef, 0xbb, 0xbf}), &state) != nil || state.ManagedBy != "cluster-installer" {
		return 0, ""
	}
	return state.Sequence, state.Release
}

// New installers can upgrade older managed folders; older installers never
// automatically downgrade a newer release candidate.
func chooseEmbeddedRevision(installed, embedded string, installedSequence, candidateSequence int) bool {
	return installed != embedded && candidateSequence > installedSequence
}

func managedDirectory(executable string) string {
	// A single portable root beside the executable. Example:
	// D:\Cluster-Server\Cluster-Installer.exe -> D:\Cluster-Server\Cluster
	// Never overwrite D:\Cluster-Server itself (which may hold an existing server).
	return filepath.Join(filepath.Dir(executable), "Cluster")
}
func readMarker(marker string) (hash string, installedAt time.Time, ok bool) {
	body, err := os.ReadFile(marker)
	if err != nil {
		return "", time.Time{}, false
	}
	var m struct {
		ManagedBy   string `json:"managedBy"`
		ArchiveHash string `json:"archiveSha256"`
		Applied     string `json:"appliedUtc"`
	}
	if json.Unmarshal(bytes.TrimPrefix(body, []byte{0xef, 0xbb, 0xbf}), &m) != nil || m.ManagedBy != "cluster-installer" || len(m.ArchiveHash) != 64 {
		return "", time.Time{}, false
	}
	if _, err := hex.DecodeString(m.ArchiveHash); err != nil {
		return "", time.Time{}, false
	}
	when, _ := time.Parse(time.RFC3339Nano, m.Applied)
	return strings.ToLower(m.ArchiveHash), when, true
}
func writePayload(name, destination string) error {
	content, err := payload.ReadFile(name)
	if err != nil {
		return err
	}
	if existing, err := os.ReadFile(destination); err == nil && sha256.Sum256(existing) == sha256.Sum256(content) {
		return nil
	}
	tmp := destination + ".writing"
	if err = os.WriteFile(tmp, content, 0600); err != nil {
		return err
	}
	// Windows does not allow renaming over an existing file: remove only our own
	// generated script/archive after a verified staged write, never server files.
	if _, err = os.Stat(destination); err == nil {
		if err = os.Remove(destination); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	}
	if err = os.Rename(tmp, destination); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}
func run() error {
	if len(os.Args) > 2 {
		return errors.New("only one development source ZIP may be supplied")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	work := managedDirectory(exe)
	if err = os.MkdirAll(work, 0700); err != nil {
		return err
	}
	releaseLock, err := acquireInstallerLock()
	if err != nil {
		return err
	}
	defer releaseLock()
	ps := filepath.Join(work, "Install-Cluster.ps1")
	if err = writePayload("Install-Cluster.ps1", ps); err != nil {
		return err
	}
	installedHash, _, installed := readMarker(filepath.Join(work, "Server", markerName))
	installedSeq, _ := readManagedSequence(filepath.Join(work, "Server", markerName))
	bundled, err := payload.ReadFile("assets/bundled-source.zip")
	if err != nil {
		return err
	}
	identity, err := embeddedReleaseInfo(bundled)
	if err != nil { return err }
	developerSource := os.Getenv("CLUSTER_INSTALLER_DEV_SOURCE_BUILD") == "1"
	if !developerSource {
		if err := embeddedPrebuiltInfo(bundled, identity); err != nil { return err }
	}
	embeddedDigest := sha256.Sum256(bundled)
	embeddedHash := hex.EncodeToString(embeddedDigest[:])
	var archive string
	if len(os.Args) == 2 {
		if !developerSource { return errors.New("dragged ZIP installation is disabled for signed production installers; use explicit developer source mode") }
		archive, err = filepath.Abs(strings.TrimSpace(os.Args[1]))
		if err != nil {
			return err
		}
		if !strings.HasSuffix(strings.ToLower(archive), ".zip") {
			return errors.New("expected a full Cluster source ZIP (not an incremental patch)")
		}
	} else if !installed || chooseEmbeddedRevision(installedHash, embeddedHash, installedSeq, identity.Sequence) {
		// Use the revision embedded in this EXE, even if a stale ZIP is beside it.
		revisionDir := filepath.Join(work, "Revisions")
		if err = os.MkdirAll(revisionDir, 0700); err != nil {
			return err
		}
		archive = filepath.Join(revisionDir, "Bundled-Cluster-Source.zip")
		if err = writePayload("assets/bundled-source.zip", archive); err != nil {
			return err
		}
	}
	args := []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps, "-WorkRoot", work}
	if archive != "" {
		args = append(args, "-Archive", archive)
		if developerSource { args = append(args, "-AllowDevSourceBuild") }
	} else if installed {
		args = append(args, "-StartInstalled")
	} else {
		return errors.New("no embedded Cluster source selected for a fresh install")
	}
	fmt.Println(installerName, identity.Release)
	fmt.Println("Portable Cluster files:", work)
	if archive != "" {
		fmt.Println("Revision:", archive)
	} else {
		fmt.Println("Existing installation: start without recompiling")
	}
	if developerSource {
  fmt.Println("DEVELOPER ONLY: source compilation is enabled. Not for production releases.")
 } else {
  fmt.Println("Verified prebuilt runtime: no Node/Go compilation on installation.")
 }
	fmt.Println("Log:", filepath.Join(work, "installer.log"))
	cmd := exec.Command("powershell.exe", args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err = cmd.Run(); err != nil {
		return fmt.Errorf("installation did not complete: %w", err)
	}
	fmt.Println("Cluster Server Manager launch requested.")
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "\nCluster Installer error:", err)
		fmt.Fprintln(os.Stderr, "Press Enter to close. The installer log has been retained.")
		_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		os.Exit(1)
	}
}
