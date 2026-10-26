//go:build windows

package main

// The per-user MSI process is born SUSPENDED and is assigned to a kernel
// kill-on-close Job Object BEFORE the first installer instruction runs.
// A helper crash closes its only job handle and terminates in-job descendants.
// Windows Installer's external system service/custom actions are NOT attested
// by this job; native execution remains a Windows 10 release gate.
import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

const (
	createSuspendedMSI             = 0x00000004
	createNoWindowMSI              = 0x08000000
	msiJobExtendedLimitInformation = 9
	msiJobKillOnClose              = 0x00002000
	// A bounded process timeout is not proof that Windows Installer rolled
	// back any changes; timeout always becomes an unknown-outcome receipt.
	maxMSIExecutionDuration = 15 * time.Minute
)

var msiKernel = syscall.NewLazyDLL("kernel32.dll")
var msiCreateJob = msiKernel.NewProc("CreateJobObjectW")
var msiSetJobLimits = msiKernel.NewProc("SetInformationJobObject")
var msiAssignJob = msiKernel.NewProc("AssignProcessToJobObject")
var msiResumeThread = msiKernel.NewProc("ResumeThread")

type msiJobBasicLimits struct {
	perProcessUserTimeLimit int64
	perJobUserTimeLimit     int64
	limitFlags              uint32
	minimumWorkingSetSize   uintptr
	maximumWorkingSetSize   uintptr
	activeProcessLimit      uint32
	affinity                uintptr
	priorityClass           uint32
	schedulingClass         uint32
}
type msiJobIOCounters struct {
	readOperationCount  uint64
	writeOperationCount uint64
	otherOperationCount uint64
	readTransferCount   uint64
	writeTransferCount  uint64
	otherTransferCount  uint64
}
type msiJobLimits struct {
	basic                 msiJobBasicLimits
	io                    msiJobIOCounters
	processMemoryLimit    uintptr
	jobMemoryLimit        uintptr
	peakProcessMemoryUsed uintptr
	peakJobMemoryUsed     uintptr
}

func createInstallerJob() (syscall.Handle, error) {
	handle, _, callErr := msiCreateJob.Call(0, 0)
	if handle == 0 {
		return 0, fmt.Errorf("create MSI job: %w", callErr)
	}
	job := syscall.Handle(handle)
	limits := msiJobLimits{}
	limits.basic.limitFlags = msiJobKillOnClose
	ok, _, err := msiSetJobLimits.Call(uintptr(job), msiJobExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limits)), unsafe.Sizeof(limits))
	if ok == 0 {
		syscall.CloseHandle(job)
		return 0, fmt.Errorf("configure MSI kill-on-close: %w", err)
	}
	return job, nil
}

// The Windows sharing contract is stronger than a pre-launch hash alone:
// FILE_SHARE_READ intentionally denies competing write/delete opens. We retain
// the handle across the full supervised process lifetime. An existing writer
// prevents acquisition instead of receiving a race window.
func acquireMSIFrozenSource(path, expectedSHA string) (*msiFrozenSource, error) {
	if !validDigest(expectedSHA) || verifyMSIPath(path) != nil {
		return nil, errors.New("MSI immutable source preflight refused")
	}
	if err := directoryNoLinks(filepath.Dir(path)); err != nil {
		return nil, err
	}
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	const openReparsePoint = 0x00200000
	handle, err := syscall.CreateFile(name, syscall.GENERIC_READ, syscall.FILE_SHARE_READ,
		nil, syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL|openReparsePoint, 0)
	if err != nil {
		return nil, fmt.Errorf("MSI source cannot be protected from modification: %w", err)
	}
	file := os.NewFile(uintptr(handle), path)
	held := &msiFrozenSource{path: path, sha256: expectedSHA, file: file}
	if err := held.verify(); err != nil {
		_ = held.close()
		return nil, err
	}
	return held, nil
}

func runWindowsUserMSI(source *msiFrozenSource, baseline msiProductState, root string, m manifest, dependencies []msiDependencyEvidence) (int, error) {
	return runWindowsUserMSIWithOperation(source, nil, baseline, root, m, dependencies, "install", "")
}
func runWindowsUserMSIRepair(source *msiFrozenSource, baseline msiProductState, root string, m manifest, dependencies []msiDependencyEvidence) (int, error) {
	return runWindowsUserMSIWithOperation(source, nil, baseline, root, m, dependencies, "repair", "")
}
func runWindowsUserMSIUninstall(source *msiFrozenSource, baseline msiProductState, root string, m manifest, dependencies []msiDependencyEvidence) (int, error) {
	return runWindowsUserMSIWithOperation(source, nil, baseline, root, m, dependencies, "uninstall", "")
}
func runWindowsUserMSIUpgrade(source, predecessor *msiFrozenSource, baseline msiProductState, root string, m manifest, dependencies []msiDependencyEvidence, priorReceiptSha string) (int, error) {
	return runWindowsUserMSIWithOperation(source, predecessor, baseline, root, m, dependencies, "upgrade", priorReceiptSha)
}
func runWindowsUserMSIRollback(predecessor, successor *msiFrozenSource, baseline msiProductState, root string, m manifest, upgradeJournalSha string) (int, error) {
	return runWindowsUserMSIWithOperation(predecessor, successor, baseline, root, m, nil, "msi-rollback", upgradeJournalSha)
}
func runWindowsUserMSIWithOperation(source, predecessor *msiFrozenSource, baseline msiProductState, root string, m manifest, dependencies []msiDependencyEvidence, operation, priorReceiptSha string) (int, error) {
	if operation != "install" && operation != "repair" && operation != "uninstall" && operation != "upgrade" && operation != "msi-rollback" {
		return -1, errors.New("unknown Windows MSI execution mode")
	}
	if err := source.verify(); err != nil {
		return -1, err
	}
	if operation == "upgrade" {
		if !validDigest(priorReceiptSha) {
			return -1, errors.New("missing upgrade predecessor receipt")
		}
		if predecessor == nil || m.Installer == nil || baseline.ProductCode != m.Installer.ProductCode ||
			baseline.ExpectedVersion == m.Installer.ProductVersion {
			return -1, errors.New("upgrade requires distinct signed version and held predecessor")
		}
		if _, err := compareMSIVersions(baseline.ExpectedVersion, m.Installer.ProductVersion); err != nil {
			return -1, err
		}
		if err := predecessor.verify(); err != nil {
			return -1, err
		}
	} else if operation == "msi-rollback" {
		if !validDigest(priorReceiptSha) || predecessor == nil || m.Installer == nil || baseline.ProductCode != m.Installer.ProductCode || baseline.ExpectedVersion == m.Installer.ProductVersion {
			return -1, errors.New("rollback requires completed upgrade journal and held successor")
		}
		if _, err := compareMSIVersions(m.Installer.ProductVersion, baseline.ExpectedVersion); err != nil {
			return -1, err
		}
		if err := predecessor.verify(); err != nil {
			return -1, err
		}
	} else if predecessor != nil || priorReceiptSha != "" {
		return -1, errors.New("predecessor handle may only be supplied for upgrade")
	}
	msi := source.path

	// Never resolve msiexec using PATH or a renderer-provided executable.
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GetSystemDirectoryW")
	buf := make([]uint16, 32768)
	n, _, callErr := proc.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 || n >= uintptr(len(buf)) {
		return -1, fmt.Errorf("Windows system directory unavailable: %v", callErr)
	}
	exe := filepath.Join(syscall.UTF16ToString(buf[:n]), "msiexec.exe")
	if stat, err := os.Lstat(exe); err != nil || !stat.Mode().IsRegular() {
		return -1, errors.New("trusted Windows Installer executable unavailable")
	}

	// Fail before process creation if kernel supervision is unavailable.
	job, err := createInstallerJob()
	if err != nil {
		return -1, err
	}
	defer syscall.CloseHandle(job)

	application, err := syscall.UTF16PtrFromString(exe)
	if err != nil {
		return -1, err
	}
	executableFlag := " /i "
	if operation == "repair" {
		executableFlag = " /fomus "
	}
	if operation == "uninstall" {
		executableFlag = " /x "
	}
	msiTarget := msi
	if operation == "uninstall" {
		msiTarget = m.Installer.ProductCode
	}
	fixedCommand := syscall.EscapeArg(exe) + executableFlag + syscall.EscapeArg(msiTarget) +
		" /qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1"
	command, err := syscall.UTF16FromString(fixedCommand)
	if err != nil {
		return -1, err
	}
	si := syscall.StartupInfo{Cb: uint32(unsafe.Sizeof(syscall.StartupInfo{})), Flags: syscall.STARTF_USESHOWWINDOW, ShowWindow: syscall.SW_HIDE}
	var pi syscall.ProcessInformation
	err = syscall.CreateProcess(application, &command[0], nil, nil, false,
		createSuspendedMSI|createNoWindowMSI, nil, nil, &si, &pi)
	if err != nil {
		return -1, fmt.Errorf("create suspended installer: %w", err)
	}
	defer syscall.CloseHandle(pi.Process)
	defer syscall.CloseHandle(pi.Thread)
	// Any failure after process creation must terminate the suspended child;
	// it is NEVER allowed to run outside the independently owned Job Object.
	started := false
	defer func() {
		if !started {
			_ = syscall.TerminateProcess(pi.Process, 1)
			_, _ = syscall.WaitForSingleObject(pi.Process, 5000)
		}
	}()
	ok, _, assignErr := msiAssignJob.Call(uintptr(job), uintptr(pi.Process))
	if ok == 0 {
		return -1, fmt.Errorf("installer Job Object assignment refused: %w", assignErr)
	}
	// Recheck the actual held bytes and pathname after creating the suspended
	// process, immediately before its first instruction. Any failure kills it.
	if err := source.verify(); err != nil {
		return -1, fmt.Errorf("MSI source changed before launch: %w", err)
	}
	// An external installer may have registered the signed ProductCode during
	// source protection or child creation. Two live reads must still match
	// the receipt before the suspended child is allowed to execute.
	if operation == "repair" || operation == "uninstall" || operation == "upgrade" || operation == "msi-rollback" {
		if err := requireCurrentUserMSIInstallScope(baseline.ProductCode); err != nil {
			return -1, err
		}
		current, queryErr := queryInstalledMSIProduct(baseline.ProductCode, baseline.ExpectedVersion)
		if err := requireExactMSIRepairRegistration(current, queryErr, baseline.ProductCode, baseline.ExpectedVersion); err != nil || current != baseline {
			return -1, errors.New("repair registration drifted before resume; process stays suspended")
		}
	} else if err := verifyMSILaunchAdmission(baseline.ProductCode, baseline.ExpectedVersion,
		baseline, queryInstalledMSIProduct); err != nil {
		return -1, err
	}
	if operation == "upgrade" {
		if err := predecessor.verify(); err != nil {
			return -1, err
		}
		if err := requireCommittedMSIUpgradeJournal(root, m, predecessor, baseline.ExpectedVersion, priorReceiptSha); err != nil {
			return -1, err
		}
	}
	if operation == "msi-rollback" {
		if err := predecessor.verify(); err != nil {
			return -1, err
		}
		if err := requireCommittedMSIRollbackJournal(root, m, source, predecessor, baseline.ExpectedVersion, priorReceiptSha); err != nil {
			return -1, err
		}
	}
	if operation == "install" {
		if err := requireNoConflictingMSILifecycle(root, m.Installer.ProductCode); err != nil {
			return -1, err
		}
	}
	// Last-moment prerequisite check before the first msiexec instruction.
	// Another installer outside Cluster can change dependency registration
	// while this child is suspended. A mismatch terminates that child.
	if operation != "msi-rollback" {
		if err := requireUnchangedMSIInstalledDependencies(root, m, dependencies); err != nil {
			return -1, err
		}
	}
	previousSuspendCount, _, resumeErr := msiResumeThread.Call(uintptr(pi.Thread))
	if previousSuspendCount == ^uintptr(0) {
		return -1, fmt.Errorf("resume supervised installer refused: %w", resumeErr)
	}
	started = true

	wait, err := syscall.WaitForSingleObject(pi.Process, uint32(maxMSIExecutionDuration/time.Millisecond))
	if err != nil {
		return -1, fmt.Errorf("wait for supervised installer: %w", err)
	}
	if wait != syscall.WAIT_OBJECT_0 {
		return -1, errors.New("MSI exceeded execution deadline; outcome unknown and manual review required")
	}
	var code uint32
	if err := syscall.GetExitCodeProcess(pi.Process, &code); err != nil {
		return -1, err
	}
	// Retain the protected handle through process completion. A drift at this
	// point means the exact executed source cannot be trusted as unchanged;
	// report unknown outcome even if msiexec returned a success-like code.
	if err := source.verify(); err != nil {
		return -1, fmt.Errorf("held MSI source changed during installer execution; outcome requires manual review: %w", err)
	}
	if operation == "upgrade" || operation == "msi-rollback" {
		if err := predecessor.verify(); err != nil {
			return -1, fmt.Errorf("held other MSI source changed during lifecycle execution; outcome unknown: %w", err)
		}
	}
	// A process exit is NOT OS product attestation, even for 0/3010.
	return int(code), nil
}

func verifyMSIPath(path string) error {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("unsafe MSI path")
	}
	return nil
}
