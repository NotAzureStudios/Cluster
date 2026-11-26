package main

// Retire exactly the successful signed installer after the update has committed.
// A stale `.exe.receipt.json` makes the next release fail inspection (more
// than one candidate), and a stale installer filename prevents the next
// signed main-channel download from being staged at all. The durable update
// journal, cold PostgreSQL snapshot, and application rollback remain intact.
import (
    "encoding/json"
    "errors"
    "fmt"
    "os"
    "path/filepath"
    "strings"
)

func retireAppliedServerUpdate(root string, candidate inspectedStagedServerUpdate) error {
    if candidate.Sequence <= 0 || installedServerReleaseSequence(root) != candidate.Sequence {
        return errors.New("cannot retire staging before the installed release is committed")
    }
    dir,err:=stagedServerUpdateDirectory(root,candidate.Channel)
    if err!=nil{return err}
    return retireCommittedStagingFiles(dir,candidate)
}

func retireCommittedStagingFiles(dir string,candidate inspectedStagedServerUpdate)error{
    if candidate.InstallerPath=="" || !strings.EqualFold(filepath.Ext(candidate.InstallerPath),".exe") {
        return errors.New("applied installer path has invalid name")
    }
    // Validate ALL three exact file identities before deleting any. This
    // never recursively removes a directory, backup or unknown file.
    files:=[]struct{path string;size int64}{
        {candidate.ReceiptPath,4096},
        {candidate.ManifestPath,maxServerManifestBytes},
        {candidate.InstallerPath,candidate.Size},
    }
    expected:=[]string{
        candidate.InstallerPath+".receipt.json",
        candidate.InstallerPath+".manifest.json",
        candidate.InstallerPath,
    }
    for i,item:=range files{
        if !filepath.IsAbs(item.path) || !strings.EqualFold(filepath.Clean(item.path),filepath.Clean(expected[i])) ||
            !strings.EqualFold(filepath.Clean(filepath.Dir(item.path)),filepath.Clean(dir)) {
            return errors.New("refusing to retire a file outside the exact signed staging directory")
        }
        info,err:=os.Lstat(item.path)
        if err!=nil{return err}
        if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink!=0 || info.Size()<=0 ||
            (i==2 && info.Size()!=candidate.Size) ||
            (i!=2 && info.Size()>item.size) {
            return fmt.Errorf("applied signed staging file is no longer a valid regular file: %s",filepath.Base(item.path))
        }
    }
    for _,item:=range files {
        if err:=os.Remove(item.path);err!=nil{return fmt.Errorf("signed staging retirement incomplete: %w",err)}
    }
    return nil
}

// clearSupersededStaging removes a staged installer and its receipt/manifest
// when they belong to a release older than the one being staged now (the same
// release is left in place: it is already staged). Only the three exact sibling files in the staging directory are
// considered; anything that is not a plain regular file stops the update.
func clearSupersededStaging(dir,target string,nextSequence int)error{
    if !strings.EqualFold(filepath.Clean(filepath.Dir(target)),filepath.Clean(dir)) {
        return errors.New("refusing to clear a file outside the signed staging directory")
    }
    receiptPath:=target+".receipt.json"
    staged:=0
    if raw,err:=os.ReadFile(receiptPath);err==nil{
        var receipt struct{ Sequence int `json:"sequence"` }
        // An unreadable receipt is not evidence of anything; treat as stale.
        if json.Unmarshal(raw,&receipt)==nil { staged=receipt.Sequence }
    } else if !errors.Is(err,os.ErrNotExist){
        return err
    }
    if staged==nextSequence {
        return errors.New("this update is already downloaded and verified; apply it instead of downloading again")
    }
    if staged>nextSequence {
        return fmt.Errorf("a newer signed update (sequence %d) is already staged; apply it before staging %d",staged,nextSequence)
    }
    for _,path:=range []string{receiptPath,target+".manifest.json",target}{
        info,err:=os.Lstat(path)
        if errors.Is(err,os.ErrNotExist){continue}
        if err!=nil{return err}
        if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink!=0 {
            return fmt.Errorf("staged update file is not a regular file; inspect %s",filepath.Base(path))
        }
        if err:=os.Remove(path);err!=nil{return fmt.Errorf("could not clear the older staged update: %w",err)}
    }
    return nil
}
