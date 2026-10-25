package main

import (
	"strings"
	"testing"
	"time"
)

func TestRollbackGrantBindsOriginalUpgradeAndBothInstallers(t *testing.T) {
	now := time.Now()
	o, _ := fixture(t, "presets/data.txt", []byte("signed rollback target"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	m, _, fp, err := verifyInput(o)
	if err != nil {
		t.Fatal(err)
	}
	hashes := []string{strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64), strings.Repeat("d", 64)}
	grant := grantFixture(t, o, "msi-rollback", now, hashes...)
	claim, err := verifyDeploymentGrant(grant, m, fp, "msi-rollback", now)
	if err != nil || claim.PriorReceiptSha256 != hashes[0] || claim.PriorMSISha256 != hashes[1] ||
		claim.UpgradeJournalSha256 != hashes[2] || claim.SuccessorMSISha256 != hashes[3] {
		t.Fatalf("rollback signing scope corrupted: %v %+v", err, claim)
	}
	for _, op := range []string{"rollback", "deploy", "install", "upgrade", "repair", "uninstall"} {
		if _, err := verifyDeploymentGrant(grant, m, fp, op, now); err == nil {
			t.Fatalf("rollback grant authorized %s", op)
		}
		var reverse options
		switch op {
		case "upgrade":
			reverse = grantFixture(t, o, op, now, hashes[:2]...)
		case "repair", "uninstall":
			reverse = grantFixture(t, o, op, now, hashes[0])
		default:
			reverse = grantFixture(t, o, op, now)
		}
		if _, err := verifyDeploymentGrant(reverse, m, fp, "msi-rollback", now); err == nil {
			t.Fatalf("%s grant authorized rollback", op)
		}
	}
	for name, input := range map[string][]string{
		"missing all": {}, "missing journal": hashes[:2], "missing successor": hashes[:3],
		"invalid receipt":            {"BAD", hashes[1], hashes[2], hashes[3]},
		"invalid predecessor source": {hashes[0], "BAD", hashes[2], hashes[3]},
		"invalid journal":            {hashes[0], hashes[1], "BAD", hashes[3]},
		"invalid successor source":   {hashes[0], hashes[1], hashes[2], "BAD"},
	} {
		t.Run(name, func(t *testing.T) {
			bad := grantFixture(t, o, "msi-rollback", now, input...)
			if _, err := verifyDeploymentGrant(bad, m, fp, "msi-rollback", now); err == nil {
				t.Fatal("forged or missing scope accepted")
			}
		})
	}
	if _, err := deployManagedContent(grant, "rollback", now); err == nil {
		t.Fatal("MSI rollback grant authorized content mutation")
	}
}
