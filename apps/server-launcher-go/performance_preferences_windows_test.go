//go:build windows

package main

import (
    "encoding/json"
    "os"
    "path/filepath"
    "testing"
)

func TestPerformanceDashboardDefaultsVisibleAndRemembersChoice(t *testing.T) {
    if !nativePerformanceEnabled(nativePanelPreferences{}) {
        t.Fatal("performance panel must be visible on first run")
    }
    disabled := false
    enabled := true
    if nativePerformanceEnabled(nativePanelPreferences{PerformanceView: &disabled}) {
        t.Fatal("explicitly hidden dashboard must remain hidden")
    }
    if !nativePerformanceEnabled(nativePanelPreferences{PerformanceView: &enabled}) {
        t.Fatal("explicitly enabled dashboard must remain visible")
    }
    root := t.TempDir()
    if !nativePerformanceEnabled(loadNativePanelPreferences(root)) {
        t.Fatal("missing native preferences should show dashboard")
    }
    for _, visible := range []bool{false, true} {
        prefs := nativePanelPreferences{Configured: true, PerformanceView: &visible}
        if err := saveNativePanelPreferences(root, prefs); err != nil { t.Fatal(err) }
        stored := loadNativePanelPreferences(root)
        if nativePerformanceEnabled(stored) != visible {
            t.Fatalf("performance preference did not survive disk round trip: %t", visible)
        }
        raw, err := os.ReadFile(filepath.Join(root, "data", "system", "config", "windows-server-ui.json"))
        if err != nil { t.Fatal(err) }
        var fields map[string]any
        if err := json.Unmarshal(raw, &fields); err != nil { t.Fatal(err) }
        if fields["performanceView"] != visible {
            t.Fatalf("persisted preference mismatch, got %#v", fields["performanceView"])
        }
    }
}

func TestPerformancePreferenceLegacyMissingFieldDefaultsVisible(t *testing.T) {
    var prefs nativePanelPreferences
    if err := json.Unmarshal([]byte(`{"configured":true,"darkMode":true}`), &prefs); err != nil { t.Fatal(err) }
    if !nativePerformanceEnabled(prefs) { t.Fatal("legacy preferences should receive visible dashboard") }
}
