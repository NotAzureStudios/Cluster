//go:build linux

package main

import "fmt"

func repairManagedInstallation(root string) (managedRepairReport, error) {
	report := managedRepairReport{Ready:false,Actions:[]managedRepairAction{}}
	err := fmt.Errorf("managed self-repair is available only for the native Windows Server Manager; no files were modified")
	report.add("platform","blocked",err.Error())
	return report,err
}
