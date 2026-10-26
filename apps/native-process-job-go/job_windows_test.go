//go:build windows

package processjob

import (
	"os/exec"
	"testing"
)

func TestWindowsJobLifecycle(t *testing.T) {
	job, err := New()
	if err != nil {
		t.Fatal(err)
	}
	if err := job.Assign(nil); err == nil {
		t.Fatal("missing child was accepted")
	}
	if err := job.Close(); err != nil {
		t.Fatal(err)
	}
	if err := job.Close(); err != nil {
		t.Fatal("close must be idempotent: ", err)
	}
	if err := job.Assign(&exec.Cmd{}); err == nil {
		t.Fatal("closed job accepted missing child")
	}
}
func TestWindowsJobAssignment(t *testing.T) {
	job, err := New()
	if err != nil {
		t.Fatal(err)
	}
	defer job.Close()
	cmd := exec.Command("cmd.exe", "/c", "ping -n 3 127.0.0.1 >nul")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if err := job.Assign(cmd); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
}
