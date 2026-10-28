package main

import (
    "encoding/json"
    "os"
    "path/filepath"
    "reflect"
    "strings"
    "testing"
)

func setup(t *testing.T) entryPaths {
    t.Helper()
    return pathsForExecutable(filepath.Join(t.TempDir(), "Cluster Server.exe"))
}

func writeTestFile(t *testing.T, name string, contents []byte) {
    t.Helper()
    if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil { t.Fatal(err) }
    if err := os.WriteFile(name, contents, 0600); err != nil { t.Fatal(err) }
}

func installMarker(t *testing.T, paths entryPaths, managedBy, root string) {
    t.Helper()
    body, _ := json.Marshal(managedMarker{ManagedBy: managedBy, InstallRoot: root})
    writeTestFile(t, paths.Marker, body)
}

func TestPortablePathsStayBesideRootExe(t *testing.T) {
    p := setup(t)
    if p.ManagedRoot != filepath.Join(filepath.Dir(p.Installer), "Cluster") { t.Fatal(p.ManagedRoot) }
    if filepath.Dir(p.NativeManager) != filepath.Join(p.ServerRoot, "bin") { t.Fatal(p.NativeManager) }
}

func TestFreshStartUsesInstallerOnly(t *testing.T) {
    p := setup(t)
    writeTestFile(t, p.Installer, []byte("fake"))
    got, err := chooseLaunch(p)
    if err != nil || got.Path != p.Installer || len(got.Args) != 0 { t.Fatalf("%+v, %v", got, err) }
    if got.WorkDir != filepath.Dir(p.Installer) { t.Fatal(got.WorkDir) }
}

func TestInstalledServerAutostartsDependencies(t *testing.T) {
    p := setup(t)
    installMarker(t, p, "cluster-installer", p.ManagedRoot)
    writeTestFile(t, p.NativeManager, []byte("fake native manager"))
    got, err := chooseLaunch(p)
    if err != nil { t.Fatal(err) }
    if got.Path != p.NativeManager || got.WorkDir != p.ServerRoot { t.Fatalf("%+v", got) }
    want := []string{"--root", p.ServerRoot, "--interface", "--startup", "--browser"}
    if !reflect.DeepEqual(got.Args, want) { t.Fatalf("%q != %q", got.Args, want) }
}

func TestMissingInstallerIsActionable(t *testing.T) {
    _, err := chooseLaunch(setup(t))
    if err == nil || !strings.Contains(err.Error(), "Cluster-Installer.exe") { t.Fatal(err) }
}

func TestInvalidMarkerCannotLaunchForeignServer(t *testing.T) {
    for _, scenario := range []struct{ name, owner, root string }{
        {"foreign-owner", "random", ""}, {"wrong-root", "cluster-installer", filepath.Join("different", "Cluster")},
    } {
        t.Run(scenario.name, func(t *testing.T) {
            p := setup(t)
            installMarker(t, p, scenario.owner, scenario.root)
            writeTestFile(t, p.NativeManager, []byte("fake"))
            if _, err := chooseLaunch(p); err == nil { t.Fatal("foreign installation was trusted") }
        })
    }
}

func TestIncompleteOwnedServerIsNotExecuted(t *testing.T) {
    p := setup(t)
    installMarker(t, p, "cluster-installer", p.ManagedRoot)
    if _, err := chooseLaunch(p); err == nil { t.Fatal("incomplete installation was trusted") }
}

func TestUnmanagedServerNeverRuns(t *testing.T) {
    p := setup(t)
    writeTestFile(t, p.NativeManager, []byte("fake"))
    writeTestFile(t, p.Installer, []byte("fake installer"))
    got, err := chooseLaunch(p)
    if err != nil || got.Path != p.Installer { t.Fatalf("%+v %v", got, err) }
}

func TestUnreadableMarkerDoesNotTriggerBlindInstall(t *testing.T) {
    p := setup(t)
    if err := os.MkdirAll(p.Marker, 0755); err != nil { t.Fatal(err) }
    if _, err := chooseLaunch(p); err == nil { t.Fatal("directory at marker path was trusted") }
}

func TestLegacyUTF8BOMInstallMarker(t *testing.T) {
    p := setup(t)
    installMarker(t, p, "cluster-installer", p.ManagedRoot)
    raw, err := os.ReadFile(p.Marker); if err != nil { t.Fatal(err) }
    writeTestFile(t, p.Marker, append([]byte{0xef,0xbb,0xbf}, raw...))
    writeTestFile(t, p.NativeManager, []byte("fake"))
    got, err := chooseLaunch(p)
    if err != nil || got.Path != p.NativeManager { t.Fatalf("BOM-encoded legacy marker not accepted: %+v, %v", got, err) }
}
