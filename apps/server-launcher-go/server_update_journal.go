package main

// Durable, bounded evidence for a future independently supervised update.
// This journal lives OUTSIDE Server/, which the installer replaces. A crash
// must leave enough evidence to require explicit recovery, never auto-retry.
import (
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "strings"
 "time"
)

const maxNativeUpdateJournalBytes int64 = 128 * 1024

type nativeServerUpdateJournal struct {
 path string
 id string
 file *os.File
}
type nativeServerUpdateJournalEvent struct {
 Schema int `json:"schema"`
 TransactionID string `json:"transactionId"`
 Phase serverUpdatePhase `json:"phase"`
 State string `json:"state"`
 UpdatedAt string `json:"updatedAt"`
}

func openNativeServerUpdateJournal(root,id string)(*nativeServerUpdateJournal,error){
 if !serverUpdateIDPattern.MatchString(id){return nil,errors.New("invalid update transaction ID")}
 if err:=validateManagedRepairRoot(root);err!=nil{return nil,err}
 parent,err:=filepath.Abs(filepath.Dir(root))
 if err!=nil{return nil,err}
 info,err:=os.Lstat(parent)
 if err!=nil{return nil,err}
 if !info.IsDir() || info.Mode()&os.ModeSymlink!=0{return nil,errors.New("untrusted updater journal parent")}
 dir:=filepath.Join(parent,"UpdateProgress")
 if err:=os.Mkdir(dir,0700);err!=nil && !os.IsExist(err){return nil,err}
 info,err=os.Lstat(dir)
 if err!=nil{return nil,err}
 if !info.IsDir() || info.Mode()&os.ModeSymlink!=0{return nil,errors.New("untrusted update journal folder")}
 target:=filepath.Join(dir,id+".jsonl")
 file,err:=os.OpenFile(target,os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600)
 if err!=nil{return nil,fmt.Errorf("update journal exists or cannot be created: %w",err)}
 return &nativeServerUpdateJournal{path:target,id:id,file:file},nil
}
func (j *nativeServerUpdateJournal) append(phase serverUpdatePhase,state string)error{
 if j==nil || j.file==nil{return errors.New("update journal is closed")}
 switch state {case "started","completed","failed","blocked","recovering":default:return errors.New("invalid update journal state")}
 // An event carries no free-form error messages, server secrets or paths.
 // Detailed diagnostics stay in the separately access-controlled native logs.
 if phase=="" || len(phase)>64 || strings.ContainsAny(string(phase),"\r\n"){
  return errors.New("invalid update journal phase")
 }
 info,err:=j.file.Stat()
 if err!=nil{return err}
 event:=nativeServerUpdateJournalEvent{Schema:1,TransactionID:j.id,Phase:phase,State:state,
  UpdatedAt:time.Now().UTC().Format(time.RFC3339Nano)}
 row,err:=json.Marshal(event)
 if err!=nil{return err}
 if info.Size()+int64(len(row)+1)>maxNativeUpdateJournalBytes{
  return errors.New("update progress journal is full; manual recovery required")
 }
 if _,err=j.file.Write(append(row,'\n'));err!=nil{return err}
 return j.file.Sync()
}
func (j *nativeServerUpdateJournal) close()error{
 if j==nil || j.file==nil{return nil}
 err:=j.file.Close()
 j.file=nil
 return err
}
