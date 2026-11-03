package main

import (
 "bufio"
 "encoding/json"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func TestNativeUpdateJournalSurvivesServerReplacementAndRejectsReplay(t *testing.T){
 fixture:=makeStagedFixture(t)
 id:="77148eb8-8092-4ee6-b9ec-5c409b5a1214"
 journal,err:=openNativeServerUpdateJournal(fixture.root,id)
 if err!=nil{t.Fatal(err)}
 if err:=journal.append(updatePhaseAuthorized,"started");err!=nil{t.Fatal(err)}
 if err:=journal.append(updatePhaseAuthorized,"completed");err!=nil{t.Fatal(err)}
 if err:=journal.append(updatePhaseWriteHold,"started");err!=nil{t.Fatal(err)}
 if err:=journal.close();err!=nil{t.Fatal(err)}
 if filepath.Dir(filepath.Dir(journal.path))!=filepath.Dir(fixture.root){
  t.Fatalf("journal must survive replacement of Server/: %s",journal.path)
 }
 if _,err:=openNativeServerUpdateJournal(fixture.root,id);err==nil{
  t.Fatal("duplicate transaction was allowed to overwrite history")
 }
 file,err:=os.Open(journal.path)
 if err!=nil{t.Fatal(err)}
 defer file.Close()
 scan:=bufio.NewScanner(file)
 count:=0
 for scan.Scan(){
  var row nativeServerUpdateJournalEvent
  if err:=json.Unmarshal(scan.Bytes(),&row);err!=nil{t.Fatal(err)}
  if row.Schema!=1 || row.TransactionID!=id || row.UpdatedAt==""{t.Fatalf("invalid durable audit record %+v",row)}
  count++
 }
 if err:=scan.Err();err!=nil{t.Fatal(err)}
 if count!=3{t.Fatalf("want 3 events, got %d",count)}
}
func TestNativeUpdateJournalRefusesUntrustedState(t *testing.T){
 fixture:=makeStagedFixture(t)
 id:="77148eb8-8092-4ee6-b9ec-5c409b5a1214"
 journal,err:=openNativeServerUpdateJournal(fixture.root,id)
 if err!=nil{t.Fatal(err)}
 defer journal.close()
 if err:=journal.append(updatePhaseAuthorized,"secret:postgresql://pass@localhost/db");err==nil{
  t.Fatal("freeform state containing credentials was persisted")
 }
 if err:=journal.append(serverUpdatePhase("bad\nphase"),"failed");err==nil{
  t.Fatal("invalid phase accepted")
 }
 if _,err:=openNativeServerUpdateJournal(fixture.root,"../escape");err==nil{
  t.Fatal("arbitrary filename allowed")
 }
}
func TestNativeUpdateJournalDoesNotFollowProgressDirectoryLink(t *testing.T){
 fixture:=makeStagedFixture(t)
 dir:=filepath.Join(filepath.Dir(fixture.root),"UpdateProgress")
 outside:=t.TempDir()
 if err:=os.Symlink(outside,dir);err!=nil{
  t.Skipf("platform denies symlink creation: %v",err)
 }
 if _,err:=openNativeServerUpdateJournal(fixture.root,"77148eb8-8092-4ee6-b9ec-5c409b5a1214");err==nil{
  t.Fatal("symlink journal directory accepted")
 }
 if entries,err:=os.ReadDir(outside);err!=nil || len(entries)>0{
  t.Fatalf("untrusted path was written to: %v",err)
 }
}
func TestNativeUpdateJournalRecordDoesNotCarryOperatorSecrets(t *testing.T){
 fixture:=makeStagedFixture(t)
 id:="77148eb8-8092-4ee6-b9ec-5c409b5a1214"
 journal,err:=openNativeServerUpdateJournal(fixture.root,id)
 if err!=nil{t.Fatal(err)}
 if err:=journal.append(updatePhaseBackupVerified,"completed");err!=nil{t.Fatal(err)}
 if err:=journal.close();err!=nil{t.Fatal(err)}
 raw,err:=os.ReadFile(journal.path)
 if err!=nil{t.Fatal(err)}
 if strings.Contains(string(raw),"password") || strings.Contains(string(raw),"DATABASE_URL"){
  t.Fatal("journal leaked a credential-shaped payload")
 }
}
