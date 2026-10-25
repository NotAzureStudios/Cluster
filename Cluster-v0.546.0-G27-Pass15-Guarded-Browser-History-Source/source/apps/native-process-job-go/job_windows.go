//go:build windows

// Package processjob binds Cluster-managed process trees to Windows kernel job
// objects. Closing a job is a fail-safe against orphaned descendants.
package processjob

import (
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"unsafe"
)

const (
	jobObjectExtendedLimitInformation   = 9
	jobObjectBasicAccountingInformation = 1
	jobObjectLimitKillOnJobClose        = 0x00002000
	processSetQuota                     = 0x0100
	processTerminate                    = 0x0001
	processQueryLimitedInformation      = 0x1000
)

var kernel = syscall.NewLazyDLL("kernel32.dll")
var createJobObject = kernel.NewProc("CreateJobObjectW")
var setInformationJobObject = kernel.NewProc("SetInformationJobObject")
var assignProcessToJobObject = kernel.NewProc("AssignProcessToJobObject")
var openProcess = kernel.NewProc("OpenProcess")
var closeHandle = kernel.NewProc("CloseHandle")

type basicLimit struct {
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
type ioCounters struct {
	readOperationCount  uint64
	writeOperationCount uint64
	otherOperationCount uint64
	readTransferCount   uint64
	writeTransferCount  uint64
	otherTransferCount  uint64
}
type extendedLimit struct {
	basic                 basicLimit
	io                    ioCounters
	processMemoryLimit    uintptr
	jobMemoryLimit        uintptr
	peakProcessMemoryUsed uintptr
	peakJobMemoryUsed     uintptr
}

type basicAccounting struct {
	totalUserTime             int64
	totalKernelTime           int64
	thisPeriodTotalUserTime   int64
	thisPeriodTotalKernelTime int64
	totalPageFaultCount       uint32
	totalProcesses            uint32
	activeProcesses           uint32
	totalTerminatedProcesses  uint32
}

var queryInformationJobObject = kernel.NewProc("QueryInformationJobObject")

// Job is exclusively owned by the process supervisor. Never hand a job handle
// to a subprocess. Close terminates any descendants still in the job.
type Job struct {
	mu     sync.Mutex
	handle uintptr
}

func syscallError(op string, err error) error {
	if err == nil || err == syscall.Errno(0) {
		err = syscall.EINVAL
	}
	return fmt.Errorf("%s: %w", op, err)
}

func New() (*Job, error) {
	handle, _, callErr := createJobObject.Call(0, 0)
	if handle == 0 {
		return nil, syscallError("CreateJobObjectW", callErr)
	}
	limits := extendedLimit{}
	limits.basic.limitFlags = jobObjectLimitKillOnJobClose
	ok, _, err := setInformationJobObject.Call(handle, jobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), unsafe.Sizeof(limits))
	if ok == 0 {
		closeHandle.Call(handle)
		return nil, syscallError("SetInformationJobObject", err)
	}
	return &Job{handle: handle}, nil
}

// Assign is called immediately after Cmd.Start and before announcing readiness.
// Caller MUST terminate and Wait the child if Assign fails. A failed assignment
// must never silently fall back to an unmanaged server process.
func (j *Job) Assign(cmd *exec.Cmd) error {
	if j == nil || cmd == nil || cmd.Process == nil {
		return fmt.Errorf("cannot assign a missing Cluster process")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.handle == 0 {
		return fmt.Errorf("cannot assign process to a closed job")
	}
	process, _, err := openProcess.Call(processSetQuota|processTerminate|processQueryLimitedInformation, 0, uintptr(cmd.Process.Pid))
	if process == 0 {
		return syscallError("OpenProcess for job assignment", err)
	}
	defer closeHandle.Call(process)
	ok, _, assignErr := assignProcessToJobObject.Call(j.handle, process)
	if ok == 0 {
		return syscallError("AssignProcessToJobObject", assignErr)
	}
	return nil
}

// ActiveProcesses proves that at least one descendant remains kernel-bound
// after a spawning helper has exited. A detached database process must not be
// mistaken for a supervised one.
func (j *Job) ActiveProcesses() (uint32, error) {
	if j == nil {
		return 0, fmt.Errorf("missing job")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.handle == 0 {
		return 0, fmt.Errorf("closed job")
	}
	var snapshot basicAccounting
	ok, _, err := queryInformationJobObject.Call(j.handle, jobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&snapshot)), unsafe.Sizeof(snapshot), 0)
	if ok == 0 {
		return 0, syscallError("QueryInformationJobObject", err)
	}
	return snapshot.activeProcesses, nil
}

func (j *Job) Close() error {
	if j == nil {
		return nil
	}
	j.mu.Lock()
	handle := j.handle
	j.handle = 0
	j.mu.Unlock()
	if handle == 0 {
		return nil
	}
	ok, _, err := closeHandle.Call(handle)
	if ok == 0 {
		return syscallError("CloseHandle(job)", err)
	}
	return nil
}
