//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

// The Server runs `git` from PATH. A service account, or a launcher started
// before Git was installed, has a PATH without it, and restarting the Server
// inherits the same stale PATH. Find Git for Windows the way a fresh logon
// would and put its cmd directory (which also provides git-lfs) first.
func gitRuntimeDirectory() string {
	if _, err := exec.LookPath("git"); err == nil {
		return ""
	}
	var candidates []string
	for _, root := range []syscall.Handle{syscall.HKEY_LOCAL_MACHINE, syscall.HKEY_CURRENT_USER} {
		if dir := registryString(root, `SOFTWARE\GitForWindows`, "InstallPath"); dir != "" {
			candidates = append(candidates, filepath.Join(dir, "cmd"))
		}
	}
	for _, path := range []string{
		registryString(syscall.HKEY_LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, "Path"),
		registryString(syscall.HKEY_CURRENT_USER, `Environment`, "Path"),
	} {
		candidates = append(candidates, filepath.SplitList(path)...)
	}
	for _, variable := range []string{"ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"} {
		if dir := os.Getenv(variable); dir != "" {
			candidates = append(candidates, filepath.Join(dir, "Git", "cmd"))
		}
	}
	if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
		candidates = append(candidates, filepath.Join(dir, "Programs", "Git", "cmd"))
	}
	for _, dir := range candidates {
		dir = strings.Trim(strings.TrimSpace(dir), `"`)
		if dir != "" && fileExists(filepath.Join(dir, "git.exe")) {
			return dir
		}
	}
	return ""
}

var procRegGetValue = syscall.NewLazyDLL("advapi32.dll").NewProc("RegGetValueW")

// REG_SZ or REG_EXPAND_SZ, expanded.
func registryString(root syscall.Handle, key, name string) string {
	const rrfRtRegSz, rrfRtRegExpandSz = 0x2, 0x4
	keyPtr, _ := syscall.UTF16PtrFromString(key)
	namePtr, _ := syscall.UTF16PtrFromString(name)
	size := uint32(0)
	if status, _, _ := procRegGetValue.Call(uintptr(root), uintptr(unsafe.Pointer(keyPtr)), uintptr(unsafe.Pointer(namePtr)), rrfRtRegSz|rrfRtRegExpandSz, 0, 0, uintptr(unsafe.Pointer(&size))); status != 0 || size < 2 {
		return ""
	}
	buffer := make([]uint16, size/2+1)
	if status, _, _ := procRegGetValue.Call(uintptr(root), uintptr(unsafe.Pointer(keyPtr)), uintptr(unsafe.Pointer(namePtr)), rrfRtRegSz|rrfRtRegExpandSz, 0, uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size))); status != 0 {
		return ""
	}
	return syscall.UTF16ToString(buffer)
}
