//go:build !windows

package main

import "errors"

func runWebServerUpdateAction(root,action string)error{
 return errors.New("web Server update actions require the native Windows Server Manager")
}
