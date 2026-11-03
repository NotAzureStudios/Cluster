package main

// Only the independent native supervisor owns this one-shot hold.
// The Host and API read it as a fail-closed access barrier but cannot grant
// permission to remove it. A crashed update retains the hold until recovered.
import (
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "strings"
 "time"
)

type nativeServerUpdateHold struct {
 Schema int `json:"schema"`
 Kind string `json:"kind"`
 TransactionID string `json:"transactionId"`
 CreatedAt string `json:"createdAt"`
}

func nativeServerUpdateHoldPath(root string) string {
 return filepath.Join(root,"data","system","runtime","cluster-update-hold.json")
}
func readNativeServerUpdateHold(root string) (nativeServerUpdateHold,error) {
 var hold nativeServerUpdateHold
 path:=nativeServerUpdateHoldPath(root)
 info,err:=os.Lstat(path)
 if err!=nil{return hold,err}
 if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink!=0 || info.Size()<1 || info.Size()>2048 {
  return hold,errors.New("Server update hold is an invalid file; do not reopen access")
 }
 data,err:=os.ReadFile(path)
 if err!=nil{return hold,err}
 if err=json.Unmarshal(data,&hold);err!=nil{return hold,errors.New("Server update hold has invalid JSON")}
 if hold.Schema!=1 || hold.Kind!="cluster-native-server-update" ||
  !serverUpdateIDPattern.MatchString(hold.TransactionID) {
  return hold,errors.New("Server update hold identity is invalid")
 }
 return hold,nil
}

// Returns an error for preexisting or uninspectable holds, even if they match
// this transaction. Replays require explicit recovery rather than duplicate
// application of a new installer.
func acquireNativeServerUpdateHold(root,id string) error {
 if !serverUpdateIDPattern.MatchString(id){return errors.New("invalid Server update ID")}
 if err:=validateManagedRepairRoot(root);err!=nil{return fmt.Errorf("cannot hold an unmanaged Server: %w",err)}
 dir:=filepath.Dir(nativeServerUpdateHoldPath(root))
 for _,path:=range []string{filepath.Join(root,"data"),filepath.Join(root,"data","system"),dir}{
  info,err:=os.Lstat(path)
  if err!=nil{return err}
  if !info.IsDir() || info.Mode()&os.ModeSymlink!=0{return errors.New("Server update hold parent must be a real managed directory")}
 }
 hold:=nativeServerUpdateHold{Schema:1,Kind:"cluster-native-server-update",
  TransactionID:id,CreatedAt:time.Now().UTC().Format(time.RFC3339Nano)}
 content,err:=json.Marshal(hold)
 if err!=nil{return err}
 file,err:=os.OpenFile(nativeServerUpdateHoldPath(root),os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600)
 if err!=nil{return fmt.Errorf("another Server update hold exists or the hold path is unsafe: %w",err)}
 if _,err=file.Write(content);err!=nil{file.Close();return err}
 if err=file.Sync();err!=nil{file.Close();return err}
 if err=file.Close();err!=nil{return err}
 return nil
}

func releaseNativeServerUpdateHold(root,id string) error {
 if !serverUpdateIDPattern.MatchString(id){return errors.New("invalid Server update ID")}
 hold,err:=readNativeServerUpdateHold(root)
 if err!=nil{return err}
 if !strings.EqualFold(hold.TransactionID,id){return errors.New("different update owns the server write hold")}
 return os.Remove(nativeServerUpdateHoldPath(root))
}
