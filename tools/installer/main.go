// Cluster Installer: portable, self-contained Windows source-build installer.
// No Node, Go, or PostgreSQL system installation is required on the target PC.
package main

import (
 "bufio"
 "crypto/sha256"
 "embed"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "os"
 "os/exec"
 "path/filepath"
 "sort"
 "strings"
 "time"
)

// The ZIP is generated temporarily by build-cluster-installer.mjs and never
// checked into source. Do not embed an executable inside its own input archive.
//go:embed assets/bundled-source.zip Install-Cluster.ps1
var payload embed.FS

const installerName = "Cluster Installer"
const markerName = ".cluster-installer-managed.json"

func managedDirectory(executable string) string {
 // A single portable root beside the executable. Example:
 // D:\Cluster-Server\Cluster-Installer.exe -> D:\Cluster-Server\Cluster
 // Never overwrite D:\Cluster-Server itself (which may hold an existing server).
 return filepath.Join(filepath.Dir(executable), "Cluster")
}
func readMarker(marker string) (hash string, installedAt time.Time, ok bool) {
 body, err := os.ReadFile(marker)
 if err != nil { return "",time.Time{},false }
 var m struct {
  ManagedBy string `json:"managedBy"`
  ArchiveHash string `json:"archiveSha256"`
  Applied string `json:"appliedUtc"`
 }
 if json.Unmarshal(body,&m)!=nil || m.ManagedBy!="cluster-installer" || len(m.ArchiveHash)!=64 {return "",time.Time{},false}
 if _,err:=hex.DecodeString(m.ArchiveHash);err!=nil{return "",time.Time{},false}
 when,_:=time.Parse(time.RFC3339Nano,m.Applied)
 return strings.ToLower(m.ArchiveHash),when,true
}
func writePayload(name, destination string) error {
 content,err:=payload.ReadFile(name);if err!=nil{return err}
 if existing,err:=os.ReadFile(destination);err==nil&&sha256.Sum256(existing)==sha256.Sum256(content){return nil}
 tmp:=destination+".writing"
 if err=os.WriteFile(tmp,content,0600);err!=nil{return err}
 // Windows does not allow renaming over an existing file: remove only our own
 // generated script/archive after a verified staged write, never server files.
 if _,err=os.Stat(destination);err==nil {if err=os.Remove(destination);err!=nil {_=os.Remove(tmp);return err}}
 if err=os.Rename(tmp,destination);err!=nil {_=os.Remove(tmp);return err}
 return nil
}
type revision struct {path string; modified time.Time}
func findRevision(dir, currentHash string, installedAt time.Time) (string,error) {
 entries,err:=os.ReadDir(dir);if os.IsNotExist(err){return "",nil};if err!=nil{return "",err}
 found:=[]revision{}
 for _,entry:=range entries {
  name:=entry.Name()
  if !entry.Type().IsRegular() || !strings.HasPrefix(strings.ToLower(name),"cluster-v") || !strings.HasSuffix(strings.ToLower(name),"source.zip"){continue}
  info,err:=entry.Info();if err!=nil{return "",err}
  if !installedAt.IsZero()&&!info.ModTime().After(installedAt){continue}
  found=append(found,revision{filepath.Join(dir,name),info.ModTime()})
 }
 sort.Slice(found,func(i,j int)bool{return found[i].modified.After(found[j].modified)})
 for _,candidate:=range found {
  file,err:=os.Open(candidate.path);if err!=nil{return "",err}
  digest:=sha256.New();_,err=io.Copy(digest,file);closeErr:=file.Close();if err!=nil{return "",err};if closeErr!=nil{return "",closeErr}
  if hex.EncodeToString(digest.Sum(nil))!=currentHash{return candidate.path,nil}
 }
 return "",nil
}
func run() error {
 if len(os.Args)>2 {return errors.New("drag only one complete Cluster source ZIP onto the installer")}
 exe,err:=os.Executable();if err!=nil{return err}
 work:=managedDirectory(exe)
 if err=os.MkdirAll(work,0700);err!=nil{return err}
 releaseLock,err:=acquireInstallerLock()
 if err!=nil{return err}
 defer releaseLock()
 ps:=filepath.Join(work,"Install-Cluster.ps1")
 if err=writePayload("Install-Cluster.ps1",ps);err!=nil{return err}
 installedHash,installedAt,installed:=readMarker(filepath.Join(work,"Server",markerName))
 var archive string
 if len(os.Args)==2 {
  archive,err=filepath.Abs(strings.TrimSpace(os.Args[1]));if err!=nil{return err}
  if !strings.HasSuffix(strings.ToLower(archive),".zip"){return errors.New("expected a full Cluster source ZIP (not an incremental patch)")}
 } else if installed {
  // Only use neighboring ZIPs automatically for an already-installed server.
  // On a fresh machine always use this installer's bundled revision, so an
  // unrelated older ZIP copied beside the icon cannot supersede it.
  archive,err=findRevision(filepath.Dir(exe),installedHash,installedAt);if err!=nil{return err}
 }
 args:=[]string{"-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",ps,"-WorkRoot",work}
 if archive!="" {
  args=append(args,"-Archive",archive)
 }else if installed {
  args=append(args,"-StartInstalled")
 }else{
  revisionDir:=filepath.Join(work,"Revisions")
  if err=os.MkdirAll(revisionDir,0700);err!=nil{return err}
  archive=filepath.Join(revisionDir,"Bundled-Cluster-Source.zip")
  if err=writePayload("assets/bundled-source.zip",archive);err!=nil{return err}
  args=append(args,"-Archive",archive)
 }
 fmt.Println(installerName)
 fmt.Println("Portable Cluster files:",work)
 if archive!="" {fmt.Println("Revision:",archive)} else {fmt.Println("Existing installation: start without recompiling")}
 fmt.Println("Downloads and builds are automatic; no manual toolchain setup.")
 fmt.Println("Log:",filepath.Join(work,"installer.log"))
 cmd:=exec.Command("powershell.exe",args...)
 cmd.Stdin,cmd.Stdout,cmd.Stderr=os.Stdin,os.Stdout,os.Stderr
 if err=cmd.Run();err!=nil{return fmt.Errorf("installation did not complete: %w",err)}
 fmt.Println("Cluster Server Manager launch requested.")
 return nil
}
func main(){if err:=run();err!=nil{fmt.Fprintln(os.Stderr,"\nCluster Installer error:",err);fmt.Fprintln(os.Stderr,"Press Enter to close. The installer log has been retained.");_,_=bufio.NewReader(os.Stdin).ReadString('\n');os.Exit(1)}}
