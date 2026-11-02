package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeLogRotationBoundsFilesAndProtectsNonregularTargets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "windows-server.log")
	if err := os.WriteFile(path, []byte("1234567890"), 0600); err != nil { t.Fatal(err) }
	if err := rotateNativeSessionLog(path, 10, 2); err != nil { t.Fatal(err) }
	if _, err := os.Stat(path+".1"); err != nil { t.Fatal(err) }
	for i:=0;i<3;i++ {
		if err := os.WriteFile(path, []byte(strings.Repeat("x", 11)), 0600); err != nil { t.Fatal(err) }
		if err := rotateNativeSessionLog(path, 10, 2); err != nil { t.Fatal(err) }
	}
	for _, suffix := range []string{".1",".2"} { if _,err:=os.Stat(path+suffix);err!=nil {t.Fatal(err)} }
	if _,err:=os.Stat(path+".3");!os.IsNotExist(err) {t.Fatalf("backup retention exceeded, got %v",err)}
	if err := os.Mkdir(path, 0700); err != nil { t.Fatal(err) }
	if err := rotateNativeSessionLog(path, 10, 2); err == nil { t.Fatal("directory accepted as a log file") }
}

func TestNativeLogRedactsSecrets(t *testing.T) {
	raw := "DATABASE_URL=postgresql://someone:secret@localhost:54321/cluster SESSION_SECRET=123456 AUTHORIZATION: Bearer-token"
	logged := redactNativeLogLine(raw)
	for _, secret := range []string{"someone:secret","123456","Bearer-token"} {
		if strings.Contains(logged, secret) {t.Fatalf("secret leaked into log: %s",logged)}
	}
	uri := redactNativeLogLine("Cannot connect to postgresql://someone:secret@localhost:54321/cluster")
	if !strings.Contains(uri, "localhost:54321/cluster") || strings.Contains(uri, "someone:secret") {
		t.Fatalf("database URI redaction lost host diagnostics or leaked credentials: %s", uri)
	}
}

func TestManagedDatabaseRunnerRejectsMissingOrUnknownCommands(t *testing.T) {
	root := t.TempDir()
	if err:=runManagedDatabaseCommandContext(context.Background(),root,"node",nil,"install");err==nil || !strings.Contains(err.Error(),"unsupported") {t.Fatalf("unsupported command: %v",err)}
	if err:=runManagedDatabaseCommandContext(context.Background(),root,"node",nil,"deploy");err==nil || !strings.Contains(err.Error(),"missing") {t.Fatalf("missing bundled Prisma CLI: %v",err)}
}
