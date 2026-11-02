package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagedArtifactHashesDetectCorruptionWithoutModification(t *testing.T) {
	root:=t.TempDir()
	artifacts:=map[string]string{}
	for _,p:=range managedReleaseHashFiles {
		full:=filepath.Join(root,filepath.FromSlash(p))
		if err:=os.MkdirAll(filepath.Dir(full),0700);err!=nil {t.Fatal(err)}
		original:=[]byte("exact trusted artifact: "+p)
		if err:=os.WriteFile(full,original,0600);err!=nil {t.Fatal(err)}
		sum:=sha256.Sum256(original)
		artifacts[p]=hex.EncodeToString(sum[:])
	}
	metadata:=map[string]any{"schema":1,"product":"cluster-server","kind":"prebuilt-windows-x64","sourceVersion":version,"requiredArtifacts":artifacts}
	body,err:=json.Marshal(metadata);if err!=nil {t.Fatal(err)}
	p:=filepath.Join(root,"config","prebuilt-runtime.json")
	if err:=os.MkdirAll(filepath.Dir(p),0700);err!=nil {t.Fatal(err)}
	if err:=os.WriteFile(p,body,0600);err!=nil {t.Fatal(err)}
	if err:=checkManagedReleaseArtifactHashes(root);err!=nil {t.Fatalf("unmodified release rejected: %v",err)}
	target:=filepath.Join(root,"apps","server","dist","index.js")
	if err:=os.WriteFile(target,[]byte("tampered or damaged"),0600);err!=nil {t.Fatal(err)}
	if err:=checkManagedReleaseArtifactHashes(root);err==nil || !strings.Contains(err.Error(),"checksum mismatch") {
		t.Fatalf("damaged application was accepted: %v",err)
	}
	contents,err:=os.ReadFile(target)
	if err!=nil || string(contents)!="tampered or damaged" {t.Fatal("integrity scan modified installed payload")}
}

func TestManagedArtifactHashesRefuseUntrustedManifest(t *testing.T) {
	root:=t.TempDir()
	if err:=checkManagedReleaseArtifactHashes(root);err==nil {t.Fatal("missing integrity manifest accepted")}
}
