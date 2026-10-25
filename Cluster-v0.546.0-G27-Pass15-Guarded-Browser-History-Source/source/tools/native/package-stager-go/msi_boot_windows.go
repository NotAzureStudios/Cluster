//go:build windows

package main

import (
	"errors"
	"syscall"
	"time"
)

var msiGetTickCount64 = syscall.NewLazyDLL("kernel32.dll").NewProc("GetTickCount64")

// GetTickCount64 gives monotonic milliseconds since the OS started. Pair it
// with one UTC observation only for a conservative, advisory boot estimate.
// It is not a trusted boot ID and does not establish software installation.
func queryMSISystemUptime() (time.Time, time.Duration, error) {
	if err := msiGetTickCount64.Find(); err != nil {
		return time.Time{}, 0, err
	}
	begin := time.Now().UTC()
	milliseconds, _, _ := msiGetTickCount64.Call()
	end := time.Now().UTC()
	if uint64(milliseconds) > uint64((3650*24*time.Hour)/time.Millisecond) || end.Before(begin) {
		return time.Time{}, 0, errors.New("MSI uptime observation invalid")
	}
	return begin.Add(end.Sub(begin) / 2), time.Duration(milliseconds) * time.Millisecond, nil
}
