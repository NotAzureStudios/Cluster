package main

import (
    "os"
    "path/filepath"
    "testing"
)

func TestCommittedSignedStagingRetiresOnlyExactEvidence(t *testing.T) {
    dir:=t.TempDir()
    installer:=filepath.Join(dir,"Cluster-Installer.exe")
    candidate:=inspectedStagedServerUpdate{
        InstallerPath:installer,
        ReceiptPath:installer+".receipt.json",
        ManifestPath:installer+".manifest.json",
        Size:128,
    }
    for _,p:=range []string{candidate.InstallerPath,candidate.ReceiptPath,candidate.ManifestPath}{
        bytes:=[]byte("signed evidence")
        if p==installer {bytes=make([]byte,candidate.Size)}
        if err:=os.WriteFile(p,bytes,0600);err!=nil{t.Fatal(err)}
    }
    keep:=filepath.Join(dir,"other-release-evidence.txt")
    if err:=os.WriteFile(keep,[]byte("retain"),0600);err!=nil{t.Fatal(err)}
    if err:=retireCommittedStagingFiles(dir,candidate);err!=nil{t.Fatal(err)}
    for _,p:=range []string{candidate.InstallerPath,candidate.ReceiptPath,candidate.ManifestPath}{
        if _,err:=os.Stat(p);!os.IsNotExist(err){t.Fatalf("signed staging artifact not retired: %s: %v",p,err)}
    }
    if _,err:=os.Stat(keep);err!=nil{t.Fatalf("unrelated file deleted: %v",err)}
}

func TestSignedStagingRejectsUnsafeRetirementBeforeAnyDeletion(t *testing.T){
    dir:=t.TempDir()
    installer:=filepath.Join(dir,"Cluster-Installer.exe")
    original:=inspectedStagedServerUpdate{
        InstallerPath:installer,
        ManifestPath:installer+".manifest.json",
        ReceiptPath:installer+".receipt.json",
        Size:64,
    }
    initFiles:=func(){
        for _,p:=range []string{original.InstallerPath,original.ManifestPath,original.ReceiptPath}{
            content:=[]byte("evidence")
            if p==installer{content=make([]byte,original.Size)}
            if err:=os.WriteFile(p,content,0600);err!=nil{t.Fatal(err)}
        }
    }
    tests:=[]struct{name string;change func(*inspectedStagedServerUpdate)}{
        {"outside receipt",func(v *inspectedStagedServerUpdate){v.ReceiptPath=filepath.Join(filepath.Dir(dir),"outside.receipt.json")}},
        {"tampered installer name",func(v *inspectedStagedServerUpdate){v.InstallerPath=filepath.Join(dir,"../../../outside.exe")}},
        {"wrong exact manifest identity",func(v *inspectedStagedServerUpdate){v.ManifestPath=filepath.Join(dir,"other.manifest.json")}},
        {"changed signed size",func(v *inspectedStagedServerUpdate){v.Size=65}},
    }
    for _,tc:=range tests {
        t.Run(tc.name,func(t *testing.T){
            initFiles()
            value:=original
            tc.change(&value)
            if err:=retireCommittedStagingFiles(dir,value);err==nil{t.Fatal("unsafe signed staging retirement was accepted")}
            for _,p:=range []string{original.InstallerPath,original.ManifestPath,original.ReceiptPath}{
                if _,err:=os.Stat(p);err!=nil{t.Fatalf("failure deleted valid evidence before validation: %s",p)}
            }
        })
    }
}

func TestStagingClearsOlderStagedReleaseButKeepsNewer(t *testing.T) {
    dir:=t.TempDir()
    installer:=filepath.Join(dir,"Cluster-Installer.exe")
    write:=func(sequence string){
        for _,p:=range []string{installer,installer+".manifest.json"}{
            if err:=os.WriteFile(p,[]byte("MZ staged"),0600);err!=nil{t.Fatal(err)}
        }
        if err:=os.WriteFile(installer+".receipt.json",[]byte(`{"sequence":`+sequence+`}`),0600);err!=nil{t.Fatal(err)}
    }
    keep:=filepath.Join(dir,"unrelated.txt")
    if err:=os.WriteFile(keep,[]byte("retain"),0600);err!=nil{t.Fatal(err)}

    write("200100015")
    if err:=clearSupersededStaging(dir,installer,200100026);err!=nil{t.Fatal(err)}
    for _,p:=range []string{installer,installer+".receipt.json",installer+".manifest.json"}{
        if _,err:=os.Stat(p);!os.IsNotExist(err){t.Fatalf("older staged file not cleared: %s",p)}
    }
    if _,err:=os.Stat(keep);err!=nil{t.Fatalf("unrelated file deleted: %v",err)}

    write("200100030")
    if err:=clearSupersededStaging(dir,installer,200100026);err==nil{t.Fatal("a newer staged release must not be cleared")}
    if _,err:=os.Stat(installer);err!=nil{t.Fatalf("newer staged installer was removed: %v",err)}

    // An installer left without any receipt (interrupted staging) is stale.
    _ = os.Remove(installer+".receipt.json")
    if err:=clearSupersededStaging(dir,installer,200100026);err!=nil{t.Fatal(err)}
    if _,err:=os.Stat(installer);!os.IsNotExist(err){t.Fatal("receipt-less installer not cleared")}
}
