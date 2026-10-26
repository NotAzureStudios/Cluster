//go:build windows
package main
import("fmt";"syscall";"unsafe")
var kernel32 = syscall.NewLazyDLL("kernel32.dll")
var createMutex = kernel32.NewProc("CreateMutexW")
var waitForSingleObject = kernel32.NewProc("WaitForSingleObject")
var releaseMutex = kernel32.NewProc("ReleaseMutex")
var closeHandle = kernel32.NewProc("CloseHandle")
func acquireInstallerLock()(func(),error){
 name,err:=syscall.UTF16PtrFromString("Local\\ClusterStudioInstallerV2");if err!=nil{return nil,err}
 handle,_,callErr:=createMutex.Call(0,0,uintptr(unsafe.Pointer(name)))
 if handle==0{return nil,fmt.Errorf("cannot create installer mutex: %w",callErr)}
 result,_,_:=waitForSingleObject.Call(handle,0)
 if result!=0&&result!=0x80 {closeHandle.Call(handle);return nil,fmt.Errorf("Cluster Installer is already running (wait result %#x)",result)}
 return func(){releaseMutex.Call(handle);closeHandle.Call(handle)},nil
}
