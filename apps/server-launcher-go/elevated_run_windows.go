//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unsafe"
)

var (
	procShellExecuteExW     = shell32.NewProc("ShellExecuteExW")
	procWaitForSingleObject = kernel32.NewProc("WaitForSingleObject")
	procGetExitCodeProcess  = kernel32.NewProc("GetExitCodeProcess")
	procCoInitializeEx      = syscall.NewLazyDLL("ole32.dll").NewProc("CoInitializeEx")
	procCoUninitialize      = syscall.NewLazyDLL("ole32.dll").NewProc("CoUninitialize")
)

const (
	seeMaskNoCloseProcess = 0x00000040
	waitInfinite          = 0xFFFFFFFF
	errorCancelled        = 1223
	coinitApartmentOLE1   = 0x2 | 0x4 // COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE
)

// SHELLEXECUTEINFOW; Go's field alignment matches the Windows layout.
type shellExecuteInfo struct {
	cbSize       uint32
	fMask        uint32
	hwnd         uintptr
	lpVerb       *uint16
	lpFile       *uint16
	lpParameters *uint16
	lpDirectory  *uint16
	nShow        int32
	hInstApp     uintptr
	lpIDList     uintptr
	lpClass      *uint16
	hkeyClass    uintptr
	dwHotKey     uint32
	hIcon        uintptr
	hProcess     uintptr
}

var errElevationDeclined = errors.New("administrator approval was declined")

// runSelfElevatedAndWait runs this ClusterServer.exe with arguments through a
// UAC prompt and waits for it to finish, returning an error for a non-zero
// exit or a declined prompt.
func runSelfElevatedAndWait(owner uintptr, args ...string) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	escaped := make([]string, 0, len(args))
	for _, arg := range args {
		escaped = append(escaped, syscall.EscapeArg(arg))
	}
	// ShellExecuteEx expects COM on the calling thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if hr, _, _ := procCoInitializeEx.Call(0, coinitApartmentOLE1); int32(hr) >= 0 {
		defer procCoUninitialize.Call()
	}
	info := shellExecuteInfo{
		fMask:        seeMaskNoCloseProcess,
		hwnd:         owner,
		lpVerb:       utf16("runas"),
		lpFile:       utf16(executable),
		lpParameters: utf16(strings.Join(escaped, " ")),
		lpDirectory:  utf16(filepath.Dir(executable)),
		nShow:        0,
	}
	info.cbSize = uint32(unsafe.Sizeof(info))
	ok, _, callErr := procShellExecuteExW.Call(uintptr(unsafe.Pointer(&info)))
	if ok == 0 {
		if errno, isErrno := callErr.(syscall.Errno); isErrno && errno == errorCancelled {
			return errElevationDeclined
		}
		return fmt.Errorf("could not start the administrator step: %v", callErr)
	}
	if info.hProcess == 0 {
		return errors.New("the administrator step did not report a process")
	}
	defer procCloseHandle.Call(info.hProcess)
	procWaitForSingleObject.Call(info.hProcess, waitInfinite)
	var code uint32
	if ok, _, err := procGetExitCodeProcess.Call(info.hProcess, uintptr(unsafe.Pointer(&code))); ok == 0 {
		return fmt.Errorf("could not read the administrator step result: %v", err)
	}
	if code != 0 {
		return fmt.Errorf("the administrator step exited with code %d", code)
	}
	return nil
}
