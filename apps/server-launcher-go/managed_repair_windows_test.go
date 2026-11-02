//go:build windows

package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func managedRepairFixture(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "Cluster", "Server")
	for _, item := range managedWorkspaceLinks {
		dir := filepath.Join(root, item.Target)
		if err := os.MkdirAll(dir, 0755); err != nil { t.Fatal(err) }
		body := []byte(`{"name":"@cluster/`+item.Name+`"}`)
		if err := os.WriteFile(filepath.Join(dir, "package.json"),body,0600);err!=nil {t.Fatal(err)}
	}
	if err:=os.MkdirAll(filepath.Join(root,"node_modules"),0755);err!=nil {t.Fatal(err)}
	return root
}

func TestManagedRepairPlansOnlyMissingWorkspaceJunctions(t *testing.T) {
	root:=managedRepairFixture(t)
	missing,err:=prepareManagedWorkspaceLinks(root)
	if err!=nil {t.Fatal(err)}
	if len(missing)!=6 {t.Fatalf("expected six missing links, got %d",len(missing))}
	untrusted:=filepath.Join(root,"node_modules","@cluster","server")
	if err:=os.Mkdir(untrusted,0755);err!=nil {t.Fatal(err)}
	proof:=filepath.Join(untrusted,"keep-me")
	if err:=os.WriteFile(proof,[]byte("user data"),0600);err!=nil {t.Fatal(err)}
	if _,err:=prepareManagedWorkspaceLinks(root);err==nil || !strings.Contains(err.Error(),"refusing to replace") {
		t.Fatalf("physical directory was accepted for replacement: %v",err)
	}
	if b,err:=os.ReadFile(proof);err!=nil || string(b)!="user data" {t.Fatal("foreign directory mutated")}
}

func TestManagedRepairBlocksMismatchedPackageIdentity(t *testing.T) {
	root:=managedRepairFixture(t)
	p:=filepath.Join(root,"packages","shared","package.json")
	if err:=os.WriteFile(p,[]byte(`{"name":"@cluster/unrelated"}`),0600);err!=nil {t.Fatal(err)}
	if _,err:=prepareManagedWorkspaceLinks(root);err==nil || !strings.Contains(err.Error(),"mismatched") {
		t.Fatalf("wrong package identity accepted: %v",err)
	}
}

func TestNodeRepairExtractorRejectsTraversalAndSymlinks(t *testing.T) {
	for _,bad:=range []string{
		"node-v"+privateNodeVersion+"-win-x64/../../escape",
		"not-node-v"+privateNodeVersion+"/node.exe",
		"node-v"+privateNodeVersion+"-win-x64/../other",
	} {
		root:=t.TempDir()
		archive:=filepath.Join(root,"bad.zip")
		var buf bytes.Buffer
		writer:=zip.NewWriter(&buf)
		entry,err:=writer.Create(bad)
		if err!=nil {t.Fatal(err)}
		if _,err:=entry.Write([]byte("unsafe"));err!=nil {t.Fatal(err)}
		if err:=writer.Close();err!=nil {t.Fatal(err)}
		if err:=os.WriteFile(archive,buf.Bytes(),0600);err!=nil {t.Fatal(err)}
		if err:=extractPinnedNode(archive,filepath.Join(root,"stage"));err==nil {
			t.Fatalf("unsafe archive member accepted: %s",bad)
		}
		if _,err:=os.Stat(filepath.Join(root,"escape"));!os.IsNotExist(err) {
			t.Fatalf("archive escaped staging: %v",err)
		}
	}
}

func TestNodeRepairRejectsExistingUnexpectedBackup(t *testing.T) {
	root:=managedRepairFixture(t)
	toolRoot:=filepath.Join(filepath.Dir(root),"Toolchains")
	if err:=os.Mkdir(toolRoot,0755);err!=nil {t.Fatal(err)}
	backup:=filepath.Join(toolRoot,"node-v"+privateNodeVersion+".repair-previous")
	if err:=os.Mkdir(backup,0700);err!=nil {t.Fatal(err)}
	// The admission of an existing recovery backup is checked before the
	// runtime can be installed; preserve it as evidence for manual rollback.
	if _,err:=os.Lstat(backup);err!=nil {t.Fatal(err)}
	if repaired,err:=repairPinnedNode(root);err==nil || repaired || !strings.Contains(err.Error(),"previous runtime repair evidence") {
		t.Fatalf("interrupted repair must halt before downloading any runtime: repaired=%v err=%v",repaired,err)
	}
}

func TestManagedRepairRecreatesMissingJunctionsAndIsIdempotent(t *testing.T) {
	root:=managedRepairFixture(t)
	count,err:=repairManagedWorkspaceLinks(root)
	if err!=nil {t.Fatalf("first local junction repair failed: %v",err)}
	if count!=len(managedWorkspaceLinks) {t.Fatalf("expected %d recreated links, got %d",len(managedWorkspaceLinks),count)}
	for _,item:=range managedWorkspaceLinks {
		link:=filepath.Join(root,"node_modules","@cluster",item.Name)
		expected:=filepath.Join(root,item.Target)
		got,err:=os.Readlink(link)
		if err!=nil || !strings.EqualFold(canonicalRepairLink(got),filepath.Clean(expected)) {
			t.Fatalf("wrong repaired junction for %s: %q %v",item.Name,got,err)
		}
	}
	count,err=repairManagedWorkspaceLinks(root)
	if err!=nil || count!=0 {t.Fatalf("second repair must not modify healthy installation: %d %v",count,err)}
}
