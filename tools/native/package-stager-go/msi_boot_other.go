//go:build !windows

package main

import (
	"errors"
	"time"
)

func queryMSISystemUptime() (time.Time, time.Duration, error) {
	return time.Time{}, 0, errors.New("Windows uptime observation unavailable on this platform")
}
