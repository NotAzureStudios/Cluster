package main
import("testing";"os";"path/filepath";"time";"crypto/sha256";"encoding/hex")
func TestPortableDirectoryStaysBesideInstallerAndProtectsExistingServer(t *testing.T){
 exe:=filepath.Join(t.TempDir(),"Cluster-Server","Cluster-Installer.exe")
 got:=managedDirectory(exe);want:=filepath.Join(filepath.Dir(exe),"Cluster")
 if got!=want||got==filepath.Dir(exe){t.Fatalf("got %s want %s",got,want)}
}
func TestMarkerNeedsOwnership(t *testing.T){
 p:=filepath.Join(t.TempDir(),"marker")
 _=os.WriteFile(p,[]byte(`{"testOnly":true,"archiveSha256":"`+hex.EncodeToString(make([]byte,32))+`"}`),0600)
 if _,_,ok:=readMarker(p);ok{t.Fatal("legacy test marker accepted")}
 _=os.WriteFile(p,[]byte(`{"managedBy":"cluster-installer","archiveSha256":"`+hex.EncodeToString(make([]byte,32))+`","appliedUtc":"2026-10-26T06:00:00Z"}`),0600)
 if _,_,ok:=readMarker(p);!ok{t.Fatal("owned installer marker rejected")}
}
func TestArchiveSelection(t *testing.T){
 dir:=t.TempDir();early:=filepath.Join(dir,"Cluster-v0.545.0-Old-Source.zip");latest:=filepath.Join(dir,"Cluster-v0.546.0-New-Source.zip")
 _=os.WriteFile(early,[]byte("old"),0600);_=os.WriteFile(latest,[]byte("new"),0600)
 now:=time.Now();_=os.Chtimes(early,now.Add(-time.Hour),now.Add(-time.Hour));_=os.Chtimes(latest,now,now)
 got,err:=findRevision(dir,"",time.Time{});if err!=nil||got!=latest{t.Fatalf("selection %s %v",got,err)}
 digest:=sha256.Sum256([]byte("new"));got,err=findRevision(dir,hex.EncodeToString(digest[:]),now.Add(-time.Minute));if err!=nil||got!=""{t.Fatalf("same hash %s %v",got,err)}
 got,err=findRevision(dir,"",now.Add(time.Minute));if err!=nil||got!=""{t.Fatalf("older archive %s %v",got,err)}
}
