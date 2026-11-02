package main

import (
	"encoding/json"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagedRepairRejectsUntrustedOrCopiedOwnership(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Cluster", "Server")
	if err := os.MkdirAll(root, 0700); err != nil { t.Fatal(err) }
	if err := validateManagedRepairRoot(root); err == nil { t.Fatal("repair accepted an unmanaged root") }
	marker := filepath.Join(root, ".cluster-installer-managed.json")
	if err := os.WriteFile(marker, []byte(`{"managedBy":"cluster-installer","installRoot":"C:\\foreign"}`), 0600); err != nil {t.Fatal(err)}
	if err := validateManagedRepairRoot(root); err == nil || !strings.Contains(err.Error(), "does not match") {t.Fatalf("copied ownership marker accepted: %v",err)}
	payload := `{"managedBy":"cluster-installer","installRoot":` + jsonRepairString(filepath.Dir(root)) + `}`
	if err := os.WriteFile(marker, []byte(payload), 0600); err != nil {t.Fatal(err)}
	if err := validateManagedRepairRoot(root); err != nil {t.Fatal(err)}
}

func jsonRepairString(text string) string {
	b, err := json.Marshal(text)
	if err != nil {panic(err)}
	return string(b)
}

func TestManagedRepairBlocksDamagedDatabaseWithoutMutation(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Cluster", "Server")
	data := filepath.Join(root, "data", "postgresql")
	if err := os.MkdirAll(data, 0700); err != nil { t.Fatal(err) }
	marker := filepath.Join(root, ".cluster-installer-managed.json")
	payload := `{"managedBy":"cluster-installer","installRoot":` + jsonRepairString(filepath.Dir(root)) + `}`
	if err := os.WriteFile(marker, []byte(payload), 0600); err != nil {t.Fatal(err)}
	sentinel := filepath.Join(data, "user-record")
	if err := os.WriteFile(sentinel, []byte("preserve me"), 0600); err != nil {t.Fatal(err)}
	if err := validateManagedRepairRoot(root); err == nil || !strings.Contains(err.Error(), "data is incomplete") {t.Fatalf("damaged database accepted: %v",err)}
	after,err := os.ReadFile(sentinel)
	if err != nil || string(after)!="preserve me" {t.Fatalf("user data mutated: %v",err)}
	if err := os.WriteFile(filepath.Join(data,"PG_VERSION"),[]byte("18\n"),0600);err!=nil {t.Fatal(err)}
	if err := validateManagedRepairRoot(root);err!=nil {t.Fatal(err)}
}

func TestManagedRepairReportIsStructuredAndFailsClosed(t *testing.T) {
	report := managedRepairReport{Ready:true}
	report.add("private Node","repaired","Pinned private runtime restored")
	report.add("application payload","blocked","Verified in-place installation package required")
	if report.Ready {t.Fatal("blocked step declared success")}
	var out bytes.Buffer
	if err:=writeManagedRepairReport(&out,report);err!=nil {t.Fatal(err)}
	if !strings.Contains(out.String(),`"ready": false`) {t.Fatalf("JSON result misreported repair outcome: %s",out.String())}
}

func TestManagedRepairDetectsMissingVolumeWithSavedDatabaseCredentials(t *testing.T) {
	root := filepath.Join(t.TempDir(),"Cluster","Server")
	if err:=os.MkdirAll(filepath.Join(root,"data","system","config"),0700);err!=nil {t.Fatal(err)}
	marker:=filepath.Join(root,".cluster-installer-managed.json")
	ownership:=`{"managedBy":"cluster-installer","installRoot":`+jsonRepairString(filepath.Dir(root))+`}`
	if err:=os.WriteFile(marker,[]byte(ownership),0600);err!=nil {t.Fatal(err)}
	if err:=os.WriteFile(filepath.Join(root,"data","system","config","embedded-postgres.env"),[]byte("PASSWORD=placeholder"),0600);err!=nil {t.Fatal(err)}
	if err:=validateManagedRepairRoot(root);err==nil || !strings.Contains(err.Error(),"storage is missing") {t.Fatalf("disconnected prior data volume should fail closed: %v",err)}
}
