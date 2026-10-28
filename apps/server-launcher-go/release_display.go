package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
)

var rcDisplayPattern = regexp.MustCompile(`^1\.0\.0-rc\.[1-9][0-9]*$`)

// displayReleaseVersion reads the signed-off installer candidate label from
// the installed release marker. The internal API/toolchain version is separate.
// Never display a release label from an unrelated or stale installation.
func displayReleaseVersion(root string) string {
	fallback := "v" + version
	contents, err := os.ReadFile(filepath.Join(root, "CLUSTER_RELEASE.json"))
	if err != nil {
		return fallback
	}
	var marker struct {
		Schema           int    `json:"schema"`
		ClusterVersion   string `json:"clusterVersion"`
		ReleaseChannel   string `json:"releaseChannel"`
		ReleaseCandidate string `json:"releaseCandidate"`
		ManagedInstaller bool   `json:"managedInstaller"`
	}
	if json.Unmarshal(contents, &marker) != nil || marker.Schema != 1 ||
		marker.ClusterVersion != version || marker.ReleaseChannel != "rc" ||
		!marker.ManagedInstaller || !rcDisplayPattern.MatchString(marker.ReleaseCandidate) {
		return fallback
	}
	return marker.ReleaseCandidate
}
