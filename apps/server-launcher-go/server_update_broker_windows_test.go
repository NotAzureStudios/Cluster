//go:build windows

package main

import (
    "path/filepath"
    "strings"
    "testing"
)

func TestPrivilegedBrokerDispatchNeverLivesInLocalServiceWritableServerData(t *testing.T) {
    root := filepath.Join("D:", "Cluster-Server", "Cluster", "Server")
    dir := updateBrokerDirectory(root)
    if dir != filepath.Join(filepath.Dir(root), "UpdateBroker") {
        t.Fatalf("unexpected update broker directory: %s", dir)
    }
    expected := filepath.Join(dir, "cluster-update-dispatch.json")
    if got := updateBrokerDispatchPath(root); got != expected {
        t.Fatalf("protected broker authorization is not kept in trusted directory: %s", got)
    }
    if strings.HasPrefix(strings.ToLower(updateBrokerDispatchPath(root)), strings.ToLower(filepath.Join(root,"data"))) {
        t.Fatal("broker-approved dispatch must not live inside LocalService-writable data")
    }
    if updateBrokerExecutable(root) != filepath.Join(dir, "ClusterUpdateBroker.exe") {
        t.Fatal("privileged Windows service image must live outside replaceable Server tree")
    }
}

func TestBrokerRegistrationCommandUsesOnlyFixedTrustedRoot(t *testing.T) {
    root := filepath.Join("D:", "Cluster-Server", "Cluster", "Server")
    command := updateBrokerCommand(root)
    if !strings.Contains(command, "--update-broker-service --root ") {
        t.Fatalf("missing exact broker SCM command identity: %s", command)
    }
    if strings.Contains(command, "--native-update-apply") ||
        strings.Contains(command, "--web-server-update") {
        t.Fatal("SCM service command cannot contain a one-shot application action")
    }
}
