//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEmbeddedPostgresInitializesOnlyWhenDataPathAbsent(t *testing.T) {
	root:=t.TempDir()
	data:=filepath.Join(root,"postgresql")
	initialize,err:=inspectEmbeddedPostgresData(data)
	if err!=nil || !initialize {t.Fatalf("fresh database not admitted: %v, %v",initialize,err)}
	if err:=os.Mkdir(data,0700);err!=nil {t.Fatal(err)}
	if _,err:=inspectEmbeddedPostgresData(data);err==nil || !strings.Contains(err.Error(),"refusing to overwrite") {t.Fatalf("existing damaged DB not protected: %v",err)}
	sentinel:=filepath.Join(data,"valuable-file")
	if err:=os.WriteFile(sentinel,[]byte("DO NOT DELETE"),0600);err!=nil {t.Fatal(err)}
	if _,err:=inspectEmbeddedPostgresData(data);err==nil {t.Fatal("damaged database unexpectedly accepted")}
	if b,err:=os.ReadFile(sentinel);err!=nil || string(b)!="DO NOT DELETE" {t.Fatalf("existing data was modified: %s %v",b,err)}
	if err:=os.WriteFile(filepath.Join(data,"PG_VERSION"),[]byte("17\n"),0600);err!=nil {t.Fatal(err)}
	if _,err:=inspectEmbeddedPostgresData(data);err==nil || !strings.Contains(err.Error(),"mismatched") {t.Fatalf("incompatible major accepted: %v",err)}
	if err:=os.WriteFile(filepath.Join(data,"PG_VERSION"),[]byte("18\n"),0600);err!=nil {t.Fatal(err)}
	initialize,err=inspectEmbeddedPostgresData(data)
	if err!=nil || initialize {t.Fatalf("valid existing data must not be reinitialized: %v %v",initialize,err)}
}
func TestPublishNewPostgresDataNeverOverwritesExisting(t *testing.T) {
	root:=t.TempDir()
	destination:=filepath.Join(root,"postgresql")
	source:=filepath.Join(root,"postgresql.initializing")
	if err:=os.Mkdir(source,0700);err!=nil {t.Fatal(err)}
	if err:=os.WriteFile(filepath.Join(source,"PG_VERSION"),[]byte("18\n"),0600);err!=nil {t.Fatal(err)}
	if err:=os.Mkdir(destination,0700);err!=nil {t.Fatal(err)}
	sentinel:=filepath.Join(destination,"preserve.txt")
	if err:=os.WriteFile(sentinel,[]byte("user data"),0600);err!=nil {t.Fatal(err)}
	if err:=publishNewPostgresDataDirectory(source,destination);err==nil {t.Fatal("publish replaced existing data")}
	if b,err:=os.ReadFile(sentinel);err!=nil || string(b)!="user data" {t.Fatalf("destination mutated: %s %v",b,err)}
	if _,err:=os.Stat(filepath.Join(source,"PG_VERSION"));err!=nil {t.Fatalf("staged data lost on refusal: %v",err)}
	if err:=os.RemoveAll(destination);err!=nil {t.Fatal(err)}
	if err:=publishNewPostgresDataDirectory(source,destination);err!=nil {t.Fatal(err)}
	if b,err:=os.ReadFile(filepath.Join(destination,"PG_VERSION"));err!=nil || strings.TrimSpace(string(b))!="18" {t.Fatalf("new database publish failed: %s %v",b,err)}
}

func TestPostgresFirstBootGuardRejectsMissingPreviousDataVolume(t *testing.T) {
	root:=t.TempDir()
	credential:=filepath.Join(root,"embedded-postgres.env")
	sentinel:=filepath.Join(root,"postgresql-data-initialized.marker")
	if err:=checkEmbeddedPostgresFirstBoot(true,credential,sentinel);err!=nil {t.Fatalf("fresh first boot blocked: %v",err)}
	if err:=os.WriteFile(credential,[]byte("POSTGRES_PASSWORD=not-a-real-secret"),0600);err!=nil {t.Fatal(err)}
	if err:=checkEmbeddedPostgresFirstBoot(true,credential,sentinel);err==nil || !strings.Contains(err.Error(),"refusing to initialize") {t.Fatalf("missing data with existing credentials accepted: %v",err)}
	if err:=os.Remove(credential);err!=nil {t.Fatal(err)}
	if err:=os.WriteFile(sentinel,[]byte("postgresql-18.6\n"),0600);err!=nil {t.Fatal(err)}
	if err:=checkEmbeddedPostgresFirstBoot(true,credential,sentinel);err==nil || !strings.Contains(err.Error(),"refusing to initialize") {t.Fatalf("missing data with sentinel accepted: %v",err)}
	if err:=checkEmbeddedPostgresFirstBoot(false,credential,sentinel);err!=nil {t.Fatalf("healthy existing database should not be first-boot-blocked: %v",err)}
}
