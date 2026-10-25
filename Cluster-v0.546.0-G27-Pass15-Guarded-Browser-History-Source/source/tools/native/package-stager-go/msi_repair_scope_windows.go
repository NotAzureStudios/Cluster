//go:build windows

package main

import (
	"errors"
	"strings"
	"syscall"
	"unsafe"
)

func requireCurrentUserMSIInstallScope(code string) error {
	if !msiProductCodePattern.MatchString(code) {
		return errors.New("invalid ProductCode")
	}
	proc := syscall.NewLazyDLL("msi.dll").NewProc("MsiEnumProductsExW")
	if e := proc.Find(); e != nil {
		return e
	}
	product, e := syscall.UTF16PtrFromString(code)
	if e != nil {
		return e
	}
	query := func(index uintptr) (uint32, uint32, string) {
		var found [39]uint16
		var context uint32
		rc, _, _ := proc.Call(uintptr(unsafe.Pointer(product)), 0, msiContextCurrentAndMachine, index,
			uintptr(unsafe.Pointer(&found[0])), uintptr(unsafe.Pointer(&context)), 0, 0)
		return uint32(rc), context, syscall.UTF16ToString(found[:])
	}
	first, context, found := query(0)
	if first != 0 {
		return classifyCurrentUserMSIRepairScope(first, context, 0)
	}
	if !strings.EqualFold(found, code) {
		return errors.New("repair MSI enumerated foreign ProductCode")
	}
	second, _, _ := query(1)
	return classifyCurrentUserMSIRepairScope(first, context, second)
}
