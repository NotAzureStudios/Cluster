package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOfflineDiagnosticsAreReadOnlyAndFailOnDamagedDatabase(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root,"data","postgresql")
	if err:=os.MkdirAll(data,0700);err!=nil {t.Fatal(err)}
	if err:=os.WriteFile(filepath.Join(data,"PG_VERSION"),[]byte("17\n"),0600);err!=nil {t.Fatal(err)}
	report:=collectNativeOfflineDiagnostics(root)
	if report.Healthy {t.Fatal("incompatible database version accepted")}
	var bad bool
	for _,check:=range report.Checks {
		if check.Name=="PostgreSQL data"&&check.Status=="fail" {bad=true}
		if strings.Contains(strings.ToLower(check.Detail),"password") {t.Fatal("diagnostics unexpectedly contain secret values")}
	}
	if !bad {t.Fatalf("missing physical-database alert: %+v",report)}
	if _,err:=os.Stat(filepath.Join(root,"apps"));!os.IsNotExist(err) {t.Fatalf("diagnostics created app artifacts: %v",err)}
	var buffer bytes.Buffer
	if err:=writeNativeOfflineDiagnostics(&buffer,report);err!=nil {t.Fatal(err)}
	var decoded nativeOfflineReport
	if err:=json.Unmarshal(buffer.Bytes(),&decoded);err!=nil {t.Fatal(err)}
	if decoded.Healthy {t.Fatal("serialized report marked incompatible data healthy")}
}
func TestOfflineDiagnosticsRejectDamagedOwnerWithoutSpawning(t *testing.T) {
	root:=t.TempDir()
	if err:=os.WriteFile(filepath.Join(root,".cluster-installer-managed.json"),[]byte(`{"managedBy":"other"}`),0600);err!=nil {t.Fatal(err)}
	report:=collectNativeOfflineDiagnostics(root)
	if report.Healthy {t.Fatal("foreign managed marker trusted")}
	for _,check:=range report.Checks {
		if check.Name=="installer ownership" {
			if check.Status!="fail" {t.Fatalf("expected invalid ownership: %+v",check)}
			return
		}
	}
	t.Fatal("missing ownership check")
}
