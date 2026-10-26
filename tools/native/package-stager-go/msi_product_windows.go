//go:build windows

package main

import (
	"errors"
	"strings"
	"syscall"
	"unsafe"
)

const (
	msiContextUserManaged       = 1
	msiContextUserUnmanaged     = 2
	msiContextMachine           = 4
	msiContextCurrentAndMachine = msiContextUserManaged | msiContextUserUnmanaged | msiContextMachine
)

// Query the signed ProductCode through MSIINSTALLCONTEXT_ALL, restricted to
// current-user and per-machine instances. A legacy MsiQueryProductStateW
// probe can miss a per-machine registration; it may NEVER gate fresh install.
// Other users' per-user installations are not enumerated, and even a complete
// probe is registration evidence, not software health or a retry grant.
func queryInstalledMSIProduct(code, expected string) (msiProductState, error) {
	unavailable := msiProductState{State: "os_query_unavailable", ProductCode: code,
		ExpectedVersion: expected, ReadOnly: true, OSAttested: false}
	if !msiProductCodePattern.MatchString(code) || !msiProductVersionPattern.MatchString(expected) {
		return unavailable, errors.New("invalid signed product identity")
	}
	dll := syscall.NewLazyDLL("msi.dll")
	enumerate := dll.NewProc("MsiEnumProductsExW")
	getInfo := dll.NewProc("MsiGetProductInfoExW")
	if err := enumerate.Find(); err != nil {
		return unavailable, err
	}
	if err := getInfo.Find(); err != nil {
		return unavailable, err
	}
	productPtr, err := syscall.UTF16PtrFromString(code)
	if err != nil {
		return unavailable, err
	}
	versionProp, _ := syscall.UTF16PtrFromString("VersionString")
	readAt := func(index uintptr) (uint32, uint32, string) {
		var found [39]uint16
		var context uint32
		rc, _, _ := enumerate.Call(uintptr(unsafe.Pointer(productPtr)), 0,
			msiContextCurrentAndMachine, index, uintptr(unsafe.Pointer(&found[0])),
			uintptr(unsafe.Pointer(&context)), 0, 0)
		return uint32(rc), context, syscall.UTF16ToString(found[:])
	}
	rc, context, foundCode := readAt(0)
	if rc == msiEnumeratedEnd || rc == msiProductUnknown || rc != 0 ||
		(context != msiContextUserManaged && context != msiContextUserUnmanaged && context != msiContextMachine) ||
		!strings.EqualFold(foundCode, code) {
		// No second probe is needed for complete absence, and unexpected
		// output/error codes are always rejected by the shared classifier.
		return classifyMSIEnumeratedProduct(code, expected, rc, context, foundCode, 0, 0, "")
	}
	next, _, _ := readAt(1)
	if next != msiEnumeratedEnd {
		return classifyMSIEnumeratedProduct(code, expected, rc, context, foundCode, next, 0, "")
	}
	version := make([]uint16, 128)
	count := uint32(len(version))
	result, _, _ := getInfo.Call(uintptr(unsafe.Pointer(productPtr)), 0, uintptr(context),
		uintptr(unsafe.Pointer(versionProp)), uintptr(unsafe.Pointer(&version[0])),
		uintptr(unsafe.Pointer(&count)))
	reported := ""
	if result == 0 && count < uint32(len(version)) {
		reported = syscall.UTF16ToString(version[:count])
	}
	return classifyMSIEnumeratedProduct(code, expected, rc, context, foundCode, next, uint32(result), reported)
}
