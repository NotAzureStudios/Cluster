package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeLineLogWriterRotatesDuringLongSessionAndRedactsSplitSecrets(t *testing.T) {
	root:=t.TempDir()
	path:=filepath.Join(root,"windows-service.log")
	writer,err:=openNativeLineLogWriter(path,70*1024,2)
	if err!=nil {t.Fatal(err)}
	secret:="postgresql://admin:cross-chunk-secret@127.0.0.1:54321/cluster"
	if _,err:=writer.Write([]byte("connection "+secret[:27]));err!=nil {t.Fatal(err)}
	if _,err:=writer.Write([]byte(secret[27:]+"\n"));err!=nil {t.Fatal(err)}
	for i:=0;i<650;i++ {
		if _,err:=writer.Write([]byte(strings.Repeat("operation completed with normal output.",7)+"\n"));err!=nil {t.Fatal(err)}
	}
	if err:=writer.Close();err!=nil {t.Fatal(err)}
	if _,err:=os.Stat(path+".1");err!=nil {t.Fatalf("no continuous rotation: %v",err)}
	for _,suffix:=range []string{"",".1",".2"} {
		b,err:=os.ReadFile(path+suffix)
		if os.IsNotExist(err) {continue}
		if err!=nil {t.Fatal(err)}
		if len(b)>70*1024 {t.Fatalf("log %s exceeded byte budget: %d",suffix,len(b))}
		if strings.Contains(string(b),"cross-chunk-secret") {t.Fatalf("credentials leaked into %s",suffix)}
	}
	if _,err:=os.Stat(path+".3");!os.IsNotExist(err) {t.Fatalf("too many log backups: %v",err)}
}

func TestNativeLineLogWriterBoundsUnterminatedLineMemory(t *testing.T) {
	path:=filepath.Join(t.TempDir(),"log.txt")
	writer,err:=openNativeLineLogWriter(path,70*1024,2)
	if err!=nil {t.Fatal(err)}
	if _,err:=writer.Write([]byte(strings.Repeat("x",500000)));err!=nil {t.Fatal(err)}
	if len(writer.pending)>nativeLogMaxLineBytes {t.Fatalf("unbounded pending memory: %d",len(writer.pending))}
	if _,err:=writer.Write([]byte("\n"));err!=nil {t.Fatal(err)}
	if err:=writer.Close();err!=nil {t.Fatal(err)}
	b,err:=os.ReadFile(path)
	if err!=nil {t.Fatal(err)}
	if !strings.Contains(string(b),"[line truncated") {t.Fatal("oversized diagnostic line silently omitted marker")}
	if len(b)>70*1024 {t.Fatalf("oversized line exceeded file budget: %d",len(b))}
}
