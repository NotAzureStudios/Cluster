//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

var getExtendedTCPTable = syscall.NewLazyDLL("iphlpapi.dll").NewProc("GetExtendedTcpTable")

// TCP_TABLE_OWNER_PID_LISTENER=3; AF_INET=2, AF_INET6=23.
func queryNativeTCPListeners(family uintptr, ipv6 bool) ([]tcpListenerOwner, error) {
	const tcpTableOwnerPIDListener = 3
	const insufficientBuffer = 122
	var size uint32
	result, _, _ := getExtendedTCPTable.Call(0, uintptr(unsafe.Pointer(&size)), 1, family, tcpTableOwnerPIDListener, 0)
	if result != 0 && result != insufficientBuffer {
		return nil, fmt.Errorf("TCP table query failed (%d)", result)
	}
	if size < 4 || size > 8*1024*1024 {
		return nil, fmt.Errorf("TCP table size rejected")
	}
	for attempt := 0; attempt < 2; attempt++ {
		buf := make([]byte, size)
		result, _, _ = getExtendedTCPTable.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 1, family, tcpTableOwnerPIDListener, 0)
		if result == 0 {
			return parseTCPListenerOwners(buf, ipv6), nil
		}
		if result != insufficientBuffer || size > 8*1024*1024 {
			return nil, fmt.Errorf("TCP table query failed (%d)", result)
		}
	}
	return nil, fmt.Errorf("TCP table changed during inspection")
}
func nativeListenerOwners() ([]tcpListenerOwner, error) {
	v4, err := queryNativeTCPListeners(2, false)
	if err != nil {
		return nil, err
	}
	v6, err := queryNativeTCPListeners(23, true)
	if err != nil {
		return nil, err
	}
	return append(v4, v6...), nil
}
