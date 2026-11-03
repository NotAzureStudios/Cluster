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
func TestNativeServiceOwnerAcceptsOnlyKnownPortableAndManagedLaunchers(t *testing.T){
 root:=filepath.Join("D:","Cluster-Server","Cluster","Server")
 paths:=nativeServerServicePaths(root)
 if len(paths)!=3{t.Fatalf("expected three exact managed launcher locations, got %+v",paths)}
 for _,path:=range paths{
  command:=syscall.EscapeArg(path)+" --service --root "+syscall.EscapeArg(root)
  if !nativeServiceCommandMatchesRoot(command,path,root){
   t.Fatalf("registered owned service path rejected: %s",path)
  }
  if nativeServiceCommandMatchesRoot(command,path,root+"-other"){
   t.Fatalf("Service path from different installation accepted: %s",path)
  }
 }
 portable:=filepath.Join(filepath.Dir(filepath.Dir(root)),"Cluster Server.exe")
 if paths[2]!=portable{t.Fatalf("portable launcher should be outside the Cluster WorkRoot: %s",paths[2])}
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
