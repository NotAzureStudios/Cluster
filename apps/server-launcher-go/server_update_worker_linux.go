//go:build !windows

package main

import "errors"

// Native self-updates currently require Windows SCM ownership; never attempt
// to execute a Windows PE installer or mutate Linux-managed Postgres.
func runNativeServerUpdateInstall(root,channel string,brokerAuthorized bool)error{
 return errors.New("native signed Server installer application requires Windows Service ownership")
}

func nativeServerUpdateExecutorSupport(root string,installerBytes int64)(bool,string){
 return false,"Native signed Server application currently requires Windows Service supervision"
}
