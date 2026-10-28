package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDisplayReleaseVersion(t *testing.T) {
	originalVersion := version
	version = "0.546.0"
	defer func() { version = originalVersion }()
	root := t.TempDir()
	if got := displayReleaseVersion(root); got != "v"+version {
		t.Fatalf("fallback: %s", got)
	}
	for _, tc := range []struct{ marker, expected string }{
		{`{"schema":1,"clusterVersion":"0.546.0","releaseChannel":"rc","releaseCandidate":"1.0.0-rc.7","managedInstaller":true}`, "1.0.0-rc.7"},
		{`{"schema":1,"clusterVersion":"0.545.0","releaseChannel":"rc","releaseCandidate":"1.0.0-rc.7","managedInstaller":true}`, "v" + version},
		{`{"schema":1,"clusterVersion":"0.546.0","releaseChannel":"rc","releaseCandidate":"1.0.0-rc.7","managedInstaller":false}`, "v" + version},
		{`{"schema":1,"clusterVersion":"0.546.0","releaseChannel":"rc","releaseCandidate":"1.0.0-rc.7!","managedInstaller":true}`, "v" + version},
	} {
		if err := os.WriteFile(filepath.Join(root, "CLUSTER_RELEASE.json"), []byte(tc.marker), 0600); err != nil {
			t.Fatal(err)
		}
		if got := displayReleaseVersion(root); got != tc.expected {
			t.Fatalf("got %s wanted %s", got, tc.expected)
		}
	}
}
