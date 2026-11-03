package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
)

var rcDisplayPattern = regexp.MustCompile(`^1\.0\.0-rc\.[1-9][0-9]*$`)
var stableDisplayPattern = regexp.MustCompile(`^1\.0\.[1-9][0-9]*$`)

// displayReleaseVersion reads the installer-managed identity from the installed
// runtime marker. Never display a stale or cross-product release label.
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
		marker.ClusterVersion != version || !marker.ManagedInstaller ||
		!((marker.ReleaseChannel == "rc" && rcDisplayPattern.MatchString(marker.ReleaseCandidate)) ||
		  (marker.ReleaseChannel == "stable" && stableDisplayPattern.MatchString(marker.ReleaseCandidate) && marker.ReleaseCandidate == marker.ClusterVersion)) {
		return fallback
	}
	return marker.ReleaseCandidate
}
