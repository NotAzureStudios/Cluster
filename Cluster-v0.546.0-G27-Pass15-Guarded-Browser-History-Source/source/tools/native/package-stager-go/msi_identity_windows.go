//go:build windows

package main

import (
	"errors"
	"fmt"
	"syscall"
	"unsafe"
)

// Read ProductCode and ProductVersion directly from the *staged MSI file* via
// Windows Installer database APIs in READ-ONLY mode. No msiexec, custom actions,
// transforms, repair, or elevation. The caller verifies the staged SHA-256.
func readMSIPropertyIdentity(path string) (string, string, error) {
	if err := verifyMSIPath(path); err != nil {
		return "", "", err
	}
	dll := syscall.NewLazyDLL("msi.dll")
	open := dll.NewProc("MsiOpenDatabaseW")
	viewOpen := dll.NewProc("MsiDatabaseOpenViewW")
	execute := dll.NewProc("MsiViewExecute")
	fetch := dll.NewProc("MsiViewFetch")
	value := dll.NewProc("MsiRecordGetStringW")
	closeHandle := dll.NewProc("MsiCloseHandle")
	for _, proc := range []*syscall.LazyProc{open, viewOpen, execute, fetch, value, closeHandle} {
		if err := proc.Find(); err != nil {
			return "", "", err
		}
	}
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return "", "", err
	}
	var db uintptr
	// (LPCWSTR)0 denotes MSIDBOPEN_READONLY.
	status, _, _ := open.Call(uintptr(unsafe.Pointer(name)), 0, uintptr(unsafe.Pointer(&db)))
	if status != 0 || db == 0 {
		return "", "", fmt.Errorf("MSI database open refused (%d)", status)
	}
	defer closeHandle.Call(db)

	readProperty := func(prop string) (string, error) {
		// prop is a local constant, not user input.
		sql, _ := syscall.UTF16PtrFromString("SELECT `Value` FROM `Property` WHERE `Property` = '" + prop + "'")
		var view uintptr
		rc, _, _ := viewOpen.Call(db, uintptr(unsafe.Pointer(sql)), uintptr(unsafe.Pointer(&view)))
		if rc != 0 || view == 0 {
			return "", fmt.Errorf("MSI Property table query refused (%d)", rc)
		}
		defer closeHandle.Call(view)
		rc, _, _ = execute.Call(view, 0)
		if rc != 0 {
			return "", fmt.Errorf("MSI Property table query execution refused (%d)", rc)
		}
		var record uintptr
		rc, _, _ = fetch.Call(view, uintptr(unsafe.Pointer(&record)))
		if rc != 0 || record == 0 {
			return "", errors.New("MSI Property table identity missing")
		}
		defer closeHandle.Call(record)
		buf := make([]uint16, 128)
		length := uint32(len(buf))
		rc, _, _ = value.Call(record, 1, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&length)))
		if rc != 0 || length == 0 || length >= uint32(len(buf)) {
			return "", errors.New("MSI Property table identity unreadable or oversized")
		}
		// Identity must be singular. Duplicate properties are ambiguous and unsafe.
		var extra uintptr
		rc, _, _ = fetch.Call(view, uintptr(unsafe.Pointer(&extra)))
		if extra != 259 { // ERROR_NO_MORE_ITEMS
			if extra != 0 {
				return "", errors.New("MSI Property table query incomplete")
			}
			closeHandle.Call(extra)
			return "", errors.New("duplicate MSI Property table identity")
		}
		return syscall.UTF16ToString(buf[:length]), nil
	}
	code, err := readProperty("ProductCode")
	if err != nil {
		return "", "", err
	}
	version, err := readProperty("ProductVersion")
	if err != nil {
		return "", "", err
	}
	return code, version, nil
}
