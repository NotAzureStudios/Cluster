//go:build windows

package main

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestWindowsServiceRecoveryOnlyForReadyHostCrashes(t *testing.T) {
	if delay,ok:=serviceHostRecoveryDelay(errServiceHostUnexpectedExit,0);!ok||delay!=5*time.Second { t.Fatalf("first crash retry: %s, %v",delay,ok) }
	if delay,ok:=serviceHostRecoveryDelay(errServiceHostUnexpectedExit,1);!ok||delay!=20*time.Second { t.Fatalf("second crash retry: %s, %v",delay,ok) }
	for _, n := range []int{-1,2,3,100} {
		if _,ok:=serviceHostRecoveryDelay(errServiceHostUnexpectedExit,n);ok { t.Fatalf("unbounded recovery at attempt %d",n) }
	}
	for _, err := range []error{
		context.Canceled,
		context.DeadlineExceeded,
		errors.New("Prisma migration failed"),
		errors.New("storage unavailable"),
		errors.New("Host exited before becoming ready"),
	} {
		if _,ok:=serviceHostRecoveryDelay(err,0);ok { t.Fatalf("non-crash error qualified for recovery: %v",err) }
	}
}
