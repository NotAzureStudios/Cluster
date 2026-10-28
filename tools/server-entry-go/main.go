// Cluster Server.exe is the portable root-level entry point for Windows.
// It launches the installed native Server Manager, which in turn prepares and
// runs private Node, PostgreSQL, the API, and the web gateway. It does not
// create a second server implementation or require administrator privileges.
package main

import (
    "bytes"
    "encoding/json"
    "errors"
    "fmt"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
)

var releaseCandidate = "development"

type entryPaths struct {
    ManagedRoot string
    ServerRoot string
    Marker string
    NativeManager string
    Installer string
}

func pathsForExecutable(executable string) entryPaths {
    base := filepath.Dir(executable)
    managed := filepath.Join(base, "Cluster")
    server := filepath.Join(managed, "Server")
    return entryPaths{
        ManagedRoot: managed,
        ServerRoot: server,
        Marker: filepath.Join(server, ".cluster-installer-managed.json"),
        NativeManager: filepath.Join(server, "bin", "ClusterServer.exe"),
        Installer: filepath.Join(base, "Cluster-Installer.exe"),
    }
}

type managedMarker struct {
    ManagedBy string `json:"managedBy"`
    InstallRoot string `json:"installRoot"`
}

type launchDecision struct {
    Path string
    Args []string
    WorkDir string
}

func fileExists(name string) bool {
    info, err := os.Stat(name)
    return err == nil && info.Mode().IsRegular()
}

// Never run an unrelated binary found in a directory named "Cluster".
// Without an installed marker, a fresh first run delegates to the bundled
// installer instead of trusting arbitrary or partly-installed server files.
func chooseLaunch(paths entryPaths) (launchDecision, error) {
    markerBytes, err := os.ReadFile(paths.Marker)
    if err == nil {
        var marker managedMarker
        if err := json.Unmarshal(bytes.TrimPrefix(markerBytes, []byte{0xef, 0xbb, 0xbf}), &marker); err != nil ||
            marker.ManagedBy != "cluster-installer" ||
            !strings.EqualFold(filepath.Clean(marker.InstallRoot), filepath.Clean(paths.ManagedRoot)) {
            return launchDecision{}, errors.New("Cluster installation marker is invalid or belongs to another directory. Run Cluster-Installer.exe; do not copy an installed Server folder between computers")
        }
        if !fileExists(paths.NativeManager) {
            return launchDecision{}, fmt.Errorf("the installed native Server Manager is missing: %s. Repair or reinstall Cluster with Cluster-Installer.exe", paths.NativeManager)
        }
        return launchDecision{Path: paths.NativeManager,
            Args: []string{"--root", paths.ServerRoot, "--interface", "--startup", "--browser"},
            WorkDir: paths.ServerRoot}, nil
    }
    if !errors.Is(err, os.ErrNotExist) {
        return launchDecision{}, fmt.Errorf("cannot inspect the Cluster installation marker: %w", err)
    }
    if !fileExists(paths.Installer) {
        return launchDecision{}, fmt.Errorf("Cluster has not been installed yet. Cluster-Installer.exe must be beside Cluster Server.exe (expected %s)", paths.Installer)
    }
    return launchDecision{Path: paths.Installer, WorkDir: filepath.Dir(paths.Installer)}, nil
}

func launch(decision launchDecision) error {
    command := exec.Command(decision.Path, decision.Args...)
    command.Dir = decision.WorkDir
    if err := command.Start(); err != nil {
        return fmt.Errorf("failed to start %s: %w", decision.Path, err)
    }
    return command.Process.Release()
}

func run() error {
    executable, err := os.Executable()
    if err != nil { return fmt.Errorf("cannot find Cluster Server.exe location: %w", err) }
    decision, err := chooseLaunch(pathsForExecutable(executable))
    if err != nil { return err }
    return launch(decision)
}

func main() {
    if err := run(); err != nil {
        showLaunchError(fmt.Sprintf("Cluster Server %s\n\n%s", releaseCandidate, err))
        os.Exit(1)
    }
}
