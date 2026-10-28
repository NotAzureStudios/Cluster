//go:build windows
package main

import (
    "syscall"
    "unsafe"
)

var user32 = syscall.NewLazyDLL("user32.dll")
var messageBoxW = user32.NewProc("MessageBoxW")

func showLaunchError(message string) {
    text, _ := syscall.UTF16PtrFromString(message)
    title, _ := syscall.UTF16PtrFromString("Cluster Server")
    // MB_OK | MB_ICONERROR. A GUI-subsystem executable has no terminal.
    messageBoxW.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10)
}
