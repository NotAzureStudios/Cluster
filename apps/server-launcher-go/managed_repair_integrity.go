package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// These source-built artifacts are retained by the managed installer. The
// diagnostic-only preflight and smoke scripts are pruned and MUST NOT be
// expected to exist in the deployed application.
var managedReleaseHashFiles = []string{
	"packages/shared/dist/index.js",
	"apps/server/dist/index.js",
	"apps/server/dist/generated/prisma/client.js",
	"apps/web/dist/index.html",
	"node_modules/@prisma/client/package.json",
	"bin/ClusterServer.exe",
	"bin/Cluster Server.exe",
	"bin/cluster-host.exe",
	"bin/cluster-update-helper.exe",
	"bin/cluster-workstation-service.exe",
}

func checkManagedReleaseArtifactHashes(root string) error {
	metadataPath := filepath.Join(root,"config","prebuilt-runtime.json")
	info,err := os.Lstat(metadataPath)
	if err != nil || !info.Mode().IsRegular() || info.Size()>128*1024 {
		return fmt.Errorf("prebuilt runtime integrity manifest is missing, linked or unexpectedly large")
	}
	body,err := os.ReadFile(metadataPath)
	if err != nil {return err}
	var meta struct {
		Schema int
		Product string
		Kind string
		SourceVersion string
		RequiredArtifacts map[string]string
	}
	if err:=json.Unmarshal(body,&meta);err!=nil {return fmt.Errorf("invalid prebuilt runtime integrity manifest: %w",err)}
	if meta.Schema!=1 || meta.Product!="cluster-server" || meta.Kind!="prebuilt-windows-x64" || meta.SourceVersion!=version {
		return fmt.Errorf("prebuilt release identity does not match the running native Server Manager")
	}
	for _,relative := range managedReleaseHashFiles {
		expected := meta.RequiredArtifacts[relative]
		if len(expected)!=64 {
			return fmt.Errorf("missing digest for installed artifact %s",relative)
		}
		if _,err:=hex.DecodeString(expected);err!=nil {
			return fmt.Errorf("invalid digest for installed artifact %s",relative)
		}
		full := filepath.Join(root,filepath.FromSlash(relative))
		info,err:=os.Lstat(full)
		if err!=nil || !info.Mode().IsRegular() || info.Size()<1 || info.Size()>256*1024*1024 {
			return fmt.Errorf("installed artifact %s is missing or unsafe",relative)
		}
		file,err:=os.Open(full)
		if err!=nil {return fmt.Errorf("cannot inspect artifact %s: %w",relative,err)}
		h:=sha256.New()
		n,copyErr:=io.Copy(h,io.LimitReader(file,256*1024*1024+1))
		closeErr:=file.Close()
		if copyErr!=nil || closeErr!=nil || n!=info.Size() {
			return fmt.Errorf("cannot verify artifact %s without inconsistent disk reads",relative)
		}
		if !strings.EqualFold(hex.EncodeToString(h.Sum(nil)),expected) {
			return fmt.Errorf("installed artifact checksum mismatch: %s",relative)
		}
	}
	return nil
}
