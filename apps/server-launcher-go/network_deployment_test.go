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

func testSnapshot(s *string) deploymentSnapshot {
	if s == nil {
		return deploymentSnapshot{}
	}
	digest := sha256.Sum256([]byte(*s))
	v := hex.EncodeToString(digest[:])
	return deploymentSnapshot{Present: true, Bytes: s, SHA256: &v}
}
func testDeploymentFixture(t *testing.T, old, next *string) string {
	t.Helper()
	config := filepath.Join(t.TempDir(), "cluster.config.json")
	t.Setenv("CLUSTER_CONFIG_FILE", config)
	if old != nil {
		if err := os.WriteFile(config, []byte(*old), 0600); err != nil {
			t.Fatal(err)
		}
	}
	p := networkDeployment{Schema: 1, ID: "00000000-0000-4000-8000-000000000001", State: "staged", CreatedAt: "2026-10-23T20:00:00Z", Before: testSnapshot(old), After: testSnapshot(next)}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(config+networkDeploymentSuffix, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return config
}
func requireDeploymentState(t *testing.T, config, state string) {
	t.Helper()
	p, err := readNativeDeployment(config)
	if err != nil {
		t.Fatal(err)
	}
	if p.State != state {
		t.Fatalf("state=%s want %s", p.State, state)
	}
}
func TestNativeRolloutConfirmation(t *testing.T) {
	before, next := `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3000}}`, `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3333}}`
	config := testDeploymentFixture(t, &before, &next)
	if err := os.WriteFile(config, []byte(next), 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyNativeNetworkDeployment(""); err != nil {
		t.Fatal(err)
	}
	requireDeploymentState(t, config, "verified")
	restored, err := rollbackNativeNetworkDeployment("")
	if err != nil || restored {
		t.Fatalf("verified rollout should not restore: %v %v", restored, err)
	}
	if err := verifyNativeNetworkDeployment(""); err != nil {
		t.Fatal(err)
	}
}
func TestNativeRolloutFailedStartRestoreOnce(t *testing.T) {
	before, next := `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3000}}`, `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3333}}`
	config := testDeploymentFixture(t, &before, &next)
	if err := os.WriteFile(config, []byte(next), 0600); err != nil {
		t.Fatal(err)
	}
	restored, err := rollbackNativeNetworkDeployment("")
	if err != nil || !restored {
		t.Fatalf("rollback: %v %v", restored, err)
	}
	raw, err := os.ReadFile(config)
	if err != nil || string(raw) != before {
		t.Fatalf("wrong restored bytes %s %v", raw, err)
	}
	requireDeploymentState(t, config, "rolled_back")
	restored, err = rollbackNativeNetworkDeployment("")
	if err != nil || restored {
		t.Fatalf("must not loop %v %v", restored, err)
	}
}
func TestNativeRolloutUncommittedPublication(t *testing.T) {
	before, next := `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3000}}`, `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3010}}`
	config := testDeploymentFixture(t, &before, &next)
	if err := os.WriteFile(config, []byte(next), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config+networkPublicationSuffix, []byte(`{"schema":1}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := rollbackNativeNetworkDeployment(""); err == nil {
		t.Fatal("must not race the PostgreSQL/file publication")
	}
	if err := verifyNativeNetworkDeployment(""); err == nil {
		t.Fatal("must not verify an unsettled commit")
	}
	raw, _ := os.ReadFile(config)
	if string(raw) != next {
		t.Fatal("modified live file while transaction pending")
	}
}
func TestNativeRolloutUnexpectedFileBlocksRollback(t *testing.T) {
	before, next := `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3000}}`, `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3010}}`
	config := testDeploymentFixture(t, &before, &next)
	if err := os.WriteFile(config, []byte("newer admin edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := rollbackNativeNetworkDeployment(""); err == nil {
		t.Fatal("modified settings cannot be overwritten")
	}
	if err := verifyNativeNetworkDeployment(""); err == nil {
		t.Fatal("modified settings cannot be called healthy rollout")
	}
	raw, _ := os.ReadFile(config)
	if string(raw) != "newer admin edit" {
		t.Fatal("changed unexpected file")
	}
}
func TestNativeRolloutInertBeforeSnapshot(t *testing.T) {
	before, next := `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3000}}`, `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3010}}`
	config := testDeploymentFixture(t, &before, &next)
	restored, err := rollbackNativeNetworkDeployment("")
	if err != nil || restored {
		t.Fatalf("inert rollout must not restart: %v %v", restored, err)
	}
	requireDeploymentState(t, config, "rolled_back")
	// New service boots with canonical old settings after aborted PostgreSQL commit.
	config2 := testDeploymentFixture(t, &before, &next)
	if err := verifyNativeNetworkDeployment(""); err != nil {
		t.Fatal(err)
	}
	requireDeploymentState(t, config2, "rolled_back")
}
func TestNativeRolloutMalformedAndMissing(t *testing.T) {
	t.Setenv("CLUSTER_CONFIG_FILE", filepath.Join(t.TempDir(), "missing.json"))
	if err := verifyNativeNetworkDeployment(""); err != nil {
		t.Fatal(err)
	}
	restored, err := rollbackNativeNetworkDeployment("")
	if err != nil || restored {
		t.Fatalf("no plan: %v %v", restored, err)
	}
	before, next := `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3000}}`, `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3010}}`
	config := testDeploymentFixture(t, &before, &next)
	for _, bad := range []string{`{}`, `{"schema":1,"state":"staged"}`, strings.Repeat("x", maxDeploymentBytes+1)} {
		if err := os.WriteFile(config+networkDeploymentSuffix, []byte(bad), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := rollbackNativeNetworkDeployment(""); err == nil {
			t.Fatal("malformed rollback accepted")
		}
	}
}
func TestNativeRolloutMissingBeforeConfig(t *testing.T) {
	next := "new-configuration"
	config := testDeploymentFixture(t, nil, &next)
	if err := os.WriteFile(config, []byte(next), 0600); err != nil {
		t.Fatal(err)
	}
	restored, err := rollbackNativeNetworkDeployment("")
	if err != nil || !restored {
		t.Fatalf("missing previous config: %v %v", restored, err)
	}
	_, err = os.Stat(config)
	if !os.IsNotExist(err) {
		t.Fatalf("old config should be absent: %v", err)
	}
	requireDeploymentState(t, config, "rolled_back")
}

func TestNativeRolloutInvalidPreviousSnapshotNeverOverwrites(t *testing.T) {
	old, next := `{"version":99,"settings":{"webPort":3000}}`, `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3010}}`
	config := testDeploymentFixture(t, &old, &next)
	if err := os.WriteFile(config, []byte(next), 0600); err != nil {
		t.Fatal(err)
	}
	if restored, err := rollbackNativeNetworkDeployment(""); err == nil || restored {
		t.Fatalf("invalid prior config must not be restored: %v %v", restored, err)
	}
	got, err := os.ReadFile(config)
	if err != nil || string(got) != next {
		t.Fatalf("candidate overwritten: %v %s", err, got)
	}
	requireDeploymentState(t, config, "staged")
}

func TestNativeRolloutTrailingJSONRejected(t *testing.T) {
	before, next := `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3000}}`, `{"version":2,"secretPolicy":"server-managed-only","settings":{"webPort":3010}}`
	config := testDeploymentFixture(t, &before, &next)
	file := config + networkDeploymentSuffix
	raw, _ := os.ReadFile(file)
	if err := os.WriteFile(file, append(raw, []byte(`{"state":"verified"}`)...), 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyNativeNetworkDeployment(""); err == nil {
		t.Fatal("trailing JSON must fail")
	}
}
