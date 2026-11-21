//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// configureProcessTree starts Git in its own process group so cancelling it
// also stops git-lfs, ssh and remote helpers it spawned. A surviving child
// can hold files open and keep an LFS transfer running after the user
// cancelled it.
func configureProcessTree(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
