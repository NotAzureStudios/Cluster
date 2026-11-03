//go:build windows

package main

import (
 "path/filepath"
 "strings"
 "syscall"
 "testing"
)

func TestNativeUpdaterSCMOwnershipIsExact(t *testing.T){
 root:=filepath.Join("D:","Cluster-Server","Cluster","Server")
 exe:=filepath.Join(root,"bin","ClusterServer.exe")
 current:=syscall.EscapeArg(exe)+" --service --root "+syscall.EscapeArg(root)
 if !nativeServiceCommandMatchesRoot(current,exe,root){t.Fatalf("native SCM registration rejected: %q",current)}
 tests:=[]string{
  current+" --extra",
  strings.Replace(current,"--service","--command-line",1),
  strings.Replace(current,"--root","--untrusted-root",1),
  strings.Replace(current,"ClusterServer.exe","AnotherServer.exe",1),
  strings.Replace(current,root,root+"-shadow",1),
  strings.Replace(current,root,root+"-shadow",2),
  "powershell.exe -Command Start-Process \""+exe+"\" --service --root "+root,
 }
 for _,tc:=range tests{
  if tc==current {continue}
  if nativeServiceCommandMatchesRoot(tc,exe,root){t.Fatalf("unexpected Windows Service registration was trusted: %q",tc)}
 }
 if !nativeServiceCommandMatchesRoot(strings.ToUpper(current),exe,root){t.Fatal("case-insensitive Windows service path rejected")}
}
func TestNewUpdateIDHasAcceptedRandomUUIDShape(t *testing.T){
 ids:=map[string]bool{}
 for i:=0;i<128;i++{
  id,err:=newNativeServerUpdateID()
  if err!=nil||!serverUpdateIDPattern.MatchString(id){t.Fatalf("new update ID invalid: %q: %v",id,err)}
  if ids[id]{t.Fatalf("update ID repeated")}
  ids[id]=true
 }
}
