package main

import (
	"strings"
	"testing"
	"time"
)

// Pass41: operation-scoped signatures cannot confer any other OS mutation.
// There is deliberately NO upgrade executor registered in main.go yet.
func TestUpgradeGrantBindsBothPredecessorHashesAndCannotCrossAuthorize(t *testing.T) {
	now := time.Now()
	o, _ := fixture(t, "presets/data.txt", []byte("signed target artifact"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	m, _, fp, err := verifyInput(o)
	if err != nil {
		t.Fatal(err)
	}
	receipt, source := strings.Repeat("a", 64), strings.Repeat("b", 64)
	grant := grantFixture(t, o, "upgrade", now, receipt, source)
	claim, err := verifyDeploymentGrant(grant, m, fp, "upgrade", now)
	if err != nil || claim.PriorReceiptSha256 != receipt || claim.PriorMSISha256 != source {
		t.Fatalf("exact upgrade scope rejected: %v %+v", err, claim)
	}
	for _, op := range []string{"install", "repair", "uninstall", "deploy", "rollback"} {
		if _, err := verifyDeploymentGrant(grant, m, fp, op, now); err == nil {
			t.Fatalf("upgrade grant authorized %s", op)
		}
		reverse := grantFixture(t, o, op, now)
		if op == "repair" || op == "uninstall" {
			reverse = grantFixture(t, o, op, now, receipt)
		}
		if _, err := verifyDeploymentGrant(reverse, m, fp, "upgrade", now); err == nil {
			t.Fatalf("%s grant authorized upgrade", op)
		}
	}
	for name, hashes := range map[string][]string{
		"no predecessor": {}, "no retained source": {receipt},
		"invalid predecessor": {"BAD", source}, "invalid source": {receipt, "BAD"},
		"uppercase predecessor": {strings.Repeat("A", 64), source},
		"uppercase source":      {receipt, strings.Repeat("B", 64)},
	} {
		t.Run(name, func(t *testing.T) {
			candidate := grantFixture(t, o, "upgrade", now, hashes...)
			if _, err := verifyDeploymentGrant(candidate, m, fp, "upgrade", now); err == nil {
				t.Fatal("invalid predecessor authority accepted")
			}
		})
	}
	// Even a fully valid upgrade grant must not authorize an ordinary managed deployment.
	if _, err := deployManagedContent(grant, "deploy", now); err == nil {
		t.Fatal("upgrade grant authorized content deployment")
	}
}
