//go:build windows

package main

// ClusterStudioUpdateBroker is a separately installed, privileged Windows
// service. Its image lives in an administrator-protected directory outside
// Server/. It consumes only one-shot signed-update intents, never commands,
// URLs, target paths, or executable names supplied by a web client.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const clusterUpdateBrokerServiceName = "ClusterStudioUpdateBroker"
const brokerPollInterval = 3 * time.Second

func updateBrokerDirectory(root string) string {
	return filepath.Join(filepath.Dir(root), "UpdateBroker")
}
func updateBrokerExecutable(root string) string {
	return filepath.Join(updateBrokerDirectory(root), "ClusterUpdateBroker.exe")
}
func updateBrokerCommand(root string) string {
	return syscall.EscapeArg(updateBrokerExecutable(root)) +
		" --update-broker-service --root " + syscall.EscapeArg(root)
}
func updateBrokerDispatchPath(root string) string {
	return nativeServerUpdateRequestPath(root) + ".dispatch"
}

type brokerDispatch struct {
	Schema int `json:"schema"`
	TransactionID string `json:"transactionId"`
	RequestSHA256 string `json:"requestSha256"`
}
func requireBrokerDispatch(root, id, claimPath string) error {
	var dispatch brokerDispatch
	path := updateBrokerDispatchPath(root)
	info, err := os.Lstat(path)
	if err != nil { return err }
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size()<1 || info.Size()>1024 {
		return errors.New("broker dispatch is not a bounded regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil { return err }
	if err := json.Unmarshal(data, &dispatch); err != nil { return err }
	if dispatch.Schema != 1 || dispatch.TransactionID != id || len(dispatch.RequestSHA256)!=64 {
		return errors.New("broker dispatch identity mismatch")
	}
	claim, err := os.ReadFile(claimPath)
	if err != nil || len(claim)>4096 { return errors.New("broker claim could not be read safely") }
	digest := sha256.Sum256(claim)
	if !strings.EqualFold(hex.EncodeToString(digest[:]), dispatch.RequestSHA256) {
		return errors.New("broker dispatch does not match claimed authorization")
	}
	return nil
}

// Verify both the service's account-independent SCM state and its registered
// image path. No other Cluster root can borrow the privileged broker.
func queryBrokerService() (managedServiceInfo, string, error) {
	manager, _, callErr := apiOpenSCManager.Call(0, 0, scManagerConnect)
	if manager == 0 { return managedServiceInfo{}, "", serviceError("open broker SCM", callErr) }
	defer closeServiceHandle(manager)
	service, _, callErr := apiOpenService.Call(manager,
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(clusterUpdateBrokerServiceName))),
		serviceQueryStatus | 0x0001)
	if service == 0 {
		if errors.Is(callErr, syscall.Errno(1060)) { return managedServiceInfo{}, "", nil }
		return managedServiceInfo{}, "", serviceError("open update broker", callErr)
	}
	defer closeServiceHandle(service)
	var status windowsServiceStatusProcess
	var size uint32
	ok, _, callErr := apiQueryServiceStatusEx.Call(service, serviceStatusProcessInfo,
		uintptr(unsafe.Pointer(&status)), unsafe.Sizeof(status), uintptr(unsafe.Pointer(&size)))
	if ok == 0 { return managedServiceInfo{}, "", serviceError("query update broker", callErr) }
	// QueryServiceConfigW returns a self-contained buffer. The strings inside
	// it remain live until the image path has been copied into Go memory.
	var required uint32
	const maxConfig = 32 * 1024
	buffer := make([]byte, maxConfig)
	queryConfig := serviceDLL.NewProc("QueryServiceConfigW")
	ok, _, callErr = queryConfig.Call(service, uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(len(buffer)), uintptr(unsafe.Pointer(&required)))
	if ok == 0 { return managedServiceInfo{}, "", serviceError("read update broker image", callErr) }
	type serviceConfig struct {
		ServiceType, StartType, ErrorControl uint32
		BinaryPathName *uint16
		LoadOrderGroup *uint16
		TagID uint32
		Dependencies *uint16
		ServiceStartName *uint16
		DisplayName *uint16
	}
	config := (*serviceConfig)(unsafe.Pointer(&buffer[0]))
	if config.BinaryPathName == nil { return managedServiceInfo{}, "", errors.New("broker SCM image is missing") }
	image := syscall.UTF16PtrToString(config.BinaryPathName)
	return managedServiceInfo{Installed:true, State:status.currentState, PID:status.processID}, image, nil
}
func requireOwnedUpdateBroker(root string) error {
	info, image, err := queryBrokerService()
	if err != nil { return err }
	if !info.Installed || info.State != serviceRunning {
		return errors.New("privileged Cluster Update Broker Windows Service is not running")
	}
	if !strings.EqualFold(strings.TrimSpace(image), updateBrokerCommand(root)) {
		return errors.New("Update Broker service image belongs to another installation")
	}
	if err := checkServiceProvisionPath(updateBrokerDirectory(root), true); err != nil { return err }
	if err := checkServiceProvisionPath(updateBrokerExecutable(root), false); err != nil { return err }
	return nil
}

func copyUpdateBrokerBinary(root string) error {
	installed, err := os.Executable()
	if err != nil { return err }
	installed, err = filepath.Abs(installed)
	if err != nil { return err }
	trusted := false
	for _, path := range nativeServerServicePaths(root) {
		if strings.EqualFold(installed, path) { trusted = true; break }
	}
	if !trusted { return errors.New("broker must be provisioned by the installed native Server Manager") }
	source, err := os.Open(installed)
	if err != nil { return err }
	defer source.Close()
	info, err := source.Stat()
	if err != nil { return err }
	if !info.Mode().IsRegular() || info.Size()<128*1024 || info.Size()>200*1024*1024 {
		return errors.New("native broker executable size is invalid")
	}
	dir := updateBrokerDirectory(root)
	if err := os.Mkdir(dir, 0700); err != nil { return err }
	if err := checkServiceProvisionPath(dir, true); err != nil { return err }
	// Remove inherited write permissions: LocalService and ordinary users may
	// submit an authorized request, but must never replace the privileged code.
	acl := exec.Command("icacls.exe", dir, "/inheritance:r", "/grant:r",
		"*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F")
	if output, err := acl.CombinedOutput(); err != nil {
		return fmt.Errorf("cannot secure broker directory: %w (%s)", err, strings.TrimSpace(string(output)))
	}
	destination := updateBrokerExecutable(root)
	target, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil { return fmt.Errorf("broker binary already exists or cannot be protected: %w", err) }
	success := false
	defer func() { if !success { _ = os.Remove(destination) } }()
	hasher := sha256.New()
	n, err := io.Copy(io.MultiWriter(target, hasher), io.LimitReader(source, info.Size()+1))
	if err == nil { err = target.Sync() }
	closeErr := target.Close()
	if err != nil { return err }
	if closeErr != nil { return closeErr }
	if n != info.Size() { return errors.New("broker binary copy was truncated") }
	copied, err := os.Open(destination)
	if err != nil { return err }
	second := sha256.New()
	m, err := io.Copy(second, copied)
	closeErr = copied.Close()
	if err != nil { return err }
	if closeErr != nil { return closeErr }
	if m != n || !strings.EqualFold(hex.EncodeToString(hasher.Sum(nil)), hex.EncodeToString(second.Sum(nil))) {
		return errors.New("broker executable failed post-copy digest verification")
	}
	success = true
	return nil
}

func installUpdateBroker(root string) error {
	if err := validateManagedRepairRoot(root); err != nil { return err }
	if err := requireOwnedClusterUpdateService(root); err != nil { return err }
	elevated, err := windowsProcessElevated()
	if err != nil { return err }
	if !elevated { return errors.New("privileged Update Broker provisioning requires local Windows administrator approval") }
	info, _, err := queryBrokerService()
	if err != nil { return err }
	if info.Installed { return errors.New("Update Broker is already installed; do not replace running privileged code") }
	if err := copyUpdateBrokerBinary(root); err != nil { return err }
	manager, _, callErr := apiOpenSCManager.Call(0, 0, scManagerCreateService)
	if manager == 0 { return serviceError("open SCM for update broker", callErr) }
	defer closeServiceHandle(manager)
	name := syscall.StringToUTF16Ptr(clusterUpdateBrokerServiceName)
	display := syscall.StringToUTF16Ptr("Cluster Studio Verified Update Broker")
	command := syscall.StringToUTF16Ptr(updateBrokerCommand(root))
	// NULL account selects LocalSystem. This is a separately provisioned
	// service, never an elevation of the web-facing LocalService Host.
	service, _, callErr := apiCreateService.Call(manager,
		uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(display)),
		serviceQueryStatus | serviceStartAccess | serviceStopAccess | serviceDeleteAccess,
		serviceWin32OwnProcess, serviceAutoStart, serviceErrorNormal,
		uintptr(unsafe.Pointer(command)), 0, 0, 0, 0, 0)
	runtime.KeepAlive(name)
	runtime.KeepAlive(display)
	runtime.KeepAlive(command)
	if service == 0 { return serviceError("register update broker", callErr) }
	defer closeServiceHandle(service)
	ok, _, callErr := apiStartService.Call(service, 0, 0)
	if ok == 0 { return serviceError("start update broker", callErr) }
	return nil
}
func removeUpdateBroker(root string) error {
	elevated, err := windowsProcessElevated()
	if err != nil { return err }
	if !elevated { return errors.New("removing the Update Broker requires local administrator approval") }
	info, image, err := queryBrokerService()
	if err != nil { return err }
	if !info.Installed { return nil }
	if !strings.EqualFold(strings.TrimSpace(image), updateBrokerCommand(root)) {
		return errors.New("refusing to remove another installation's update broker")
	}
	if info.State != serviceStopped { return errors.New("stop the Update Broker Service locally before removing it") }
	manager, _, err := apiOpenSCManager.Call(0, 0, scManagerConnect)
	if manager == 0 { return serviceError("open SCM to remove broker", err) }
	defer closeServiceHandle(manager)
	service, _, err := apiOpenService.Call(manager,
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(clusterUpdateBrokerServiceName))),
		serviceDeleteAccess)
	if service == 0 { return serviceError("open broker removal", err) }
	defer closeServiceHandle(service)
	ok, _, err := apiDeleteService.Call(service)
	if ok == 0 { return serviceError("remove update broker", err) }
	// Leave executable and durable update evidence for explicit local review.
	return nil
}

var brokerServiceState struct {
	sync.Mutex
	status windowsServiceStatus
	handle uintptr
	root string
	stop chan struct{}
	once sync.Once
}
func reportBrokerServiceState(state uint32) {
	brokerServiceState.Lock()
	brokerServiceState.status.currentState = state
	if state == serviceRunning { brokerServiceState.status.controlsAccepted = serviceAcceptStop|serviceAcceptShutdown
	} else { brokerServiceState.status.controlsAccepted = 0 }
	if state == serviceStartPending || state == serviceStopPending {
		brokerServiceState.status.waitHint = 30000
		brokerServiceState.status.checkpoint++
	} else { brokerServiceState.status.waitHint = 0; brokerServiceState.status.checkpoint = 0 }
	status, handle := brokerServiceState.status, brokerServiceState.handle
	brokerServiceState.Unlock()
	if handle != 0 { apiSetServiceStatus.Call(handle, uintptr(unsafe.Pointer(&status))) }
}
var brokerControlCallback = syscall.NewCallback(func(control, eventType uint32, eventData, data uintptr) uintptr {
	if control == serviceControlStop || control == serviceControlShutdown {
		reportBrokerServiceState(serviceStopPending)
		brokerServiceState.Lock()
		brokerServiceState.once.Do(func(){ close(brokerServiceState.stop) })
		brokerServiceState.Unlock()
	}
	return 0
})
var brokerMainCallback = syscall.NewCallback(func(argc, argv uintptr) uintptr {
	name := syscall.StringToUTF16Ptr(clusterUpdateBrokerServiceName)
	handle, _, _ := apiRegisterServiceCtrlHandler.Call(uintptr(unsafe.Pointer(name)), brokerControlCallback, 0)
	runtime.KeepAlive(name)
	if handle == 0 { return 0 }
	brokerServiceState.Lock()
	brokerServiceState.handle = handle
	brokerServiceState.status = windowsServiceStatus{serviceType:serviceWin32OwnProcess, currentState:serviceStartPending, waitHint:30000, checkpoint:1}
	root, stop := brokerServiceState.root, brokerServiceState.stop
	brokerServiceState.Unlock()
	reportBrokerServiceState(serviceRunning)
	done := make(chan struct{})
	go func(){
		defer close(done)
		ticker := time.NewTicker(10*time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop: return
			case <-ticker.C:
				brokerServiceState.Lock()
				st := brokerServiceState.status.currentState
				brokerServiceState.Unlock()
				if st==serviceStopPending { reportBrokerServiceState(st) }
			}
		}
	}()
	err := runBrokerQueue(root, stop)
	<-done
	if err != nil {
		brokerServiceState.Lock()
		brokerServiceState.status.win32ExitCode = 1
		brokerServiceState.Unlock()
	}
	reportBrokerServiceState(serviceStopped)
	return 0
})
func runUpdateBrokerService(root string) error {
	if err := validateManagedRepairRoot(root); err != nil { return err }
	exe, err := os.Executable()
	if err != nil { return err }
	if !strings.EqualFold(exe, updateBrokerExecutable(root)) {
		return errors.New("privileged update broker can run only from its protected, provisioned executable")
	}
	brokerServiceState.Lock()
	brokerServiceState.root, brokerServiceState.stop = root, make(chan struct{})
	brokerServiceState.Unlock()
	name := syscall.StringToUTF16Ptr(clusterUpdateBrokerServiceName)
	table := []windowsServiceTableEntry{{name:name, callback:brokerMainCallback},{}}
	ok, _, err := apiStartServiceCtrlDispatcher.Call(uintptr(unsafe.Pointer(&table[0])))
	runtime.KeepAlive(table)
	runtime.KeepAlive(name)
	if ok == 0 { return serviceError("start update broker dispatcher", err) }
	return nil
}

// A failed dispatch is never silently replayed. Recovery must inspect the
// existing claim, write hold and durable journal. The broker does not issue
// requests, remove stale claims, or authorize a different release.
func runBrokerQueue(root string, stop <-chan struct{}) error {
	ticker := time.NewTicker(brokerPollInterval)
	defer ticker.Stop()
	for {
		if err := consumeBrokerIntent(root); err != nil {
			_ = publishWebUpdateStatus(root, webServerUpdateStatus{
				OK:false, State:"blocked", Message:"Update Broker blocked the signed installation. Examine native recovery evidence locally."})
			// Fail stopped rather than retrying a rejected or partially executed
			// privileged action on subsequent service polling ticks.
			return err
		}
		select {
		case <-stop: return nil
		case <-ticker.C:
		}
	}
}
func consumeBrokerIntent(root string) error {
	path := nativeServerUpdateRequestPath(root)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) { return nil }
	if err != nil { return err }
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink!=0 || info.Size()<1 || info.Size()>4096 {
		return errors.New("update broker refused an unsafe request file")
	}
	if _, err := os.Lstat(updateBrokerDispatchPath(root)); err == nil {
		return errors.New("prior broker dispatch requires local recovery; automatic replay prohibited")
	} else if !errors.Is(err, os.ErrNotExist) { return err }
	raw, err := os.ReadFile(path)
	if err != nil { return err }
	request, err := parseNativeBrokerRequest(raw, time.Now().UTC())
	if err != nil { return err }
	if err := requireOwnedClusterUpdateService(root); err != nil { return err }
	candidate, err := inspectStagedServerUpdate(root, "main")
	if err != nil { return err }
	if candidate.Release != request.Release || candidate.Sequence != request.Sequence ||
		!strings.EqualFold(candidate.SHA256, request.InstallerSHA256) ||
		candidate.Sequence <= installedServerReleaseSequence(root) {
		return errors.New("broker authorization and signed release do not match")
	}
	if err := ensureNativeServerUpdateDiskSpace(root, candidate.Size); err != nil { return err }
	// The worker will re-open, atomically claim and independently verify the
	// same authorization after launch. A dispatch marker prevents any replay
	// if the broker dies between the two operations.
	digest := sha256.Sum256(raw)
	dispatch := brokerDispatch{Schema:1,TransactionID:request.TransactionID,RequestSHA256:hex.EncodeToString(digest[:])}
	data, err := json.Marshal(dispatch)
	if err != nil { return err }
	record, err := os.OpenFile(updateBrokerDispatchPath(root), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil { return err }
	if _, err = record.Write(data); err == nil { err = record.Sync() }
	closeErr := record.Close()
	if err != nil { return err }
	if closeErr != nil { return closeErr }
	// The privileged worker comes from the protected broker binary, not a
	// LocalService-writable Server data directory or staged artifact.
	worker := filepath.Join(filepath.Dir(root), "Cluster-Update-Worker-"+request.TransactionID+".exe")
	if err := copyBrokerWorkerExecutable(updateBrokerExecutable(root), worker); err != nil { return err }
	_ = publishWebUpdateStatus(root,webServerUpdateStatus{
		OK:true,State:"installing",Release:candidate.Release,Sequence:candidate.Sequence,
		SHA256:candidate.SHA256,Message:"Update Broker accepted a one-shot signed installation. Cluster will restart."})
	command := exec.Command(worker, "--native-update-apply", "--broker-authorized",
		"--root", root, "--update-channel", "main")
	command.Dir = filepath.Dir(filepath.Dir(root))
	command.Stdout, command.Stderr = io.Discard, io.Discard
	err = command.Run()
	if err != nil {
		_ = publishWebUpdateStatus(root,webServerUpdateStatus{
			OK:false,State:"blocked",Release:candidate.Release,Sequence:candidate.Sequence,
			Message:"Native update failed or recovered. Inspect the durable update journal and service health before further installation."})
		return err
	}
	_ = publishWebUpdateStatus(root,webServerUpdateStatus{
		OK:true,State:"installed",Release:candidate.Release,Sequence:candidate.Sequence,
		Message:"Verified signed update installed; Windows Service restarted and readiness checked."})
	// Leave the dispatch receipt, journal, and claimed intent as replay evidence.
	// The next authorized update requires an explicit, reviewed cleanup cycle.
	return nil
}
func copyBrokerWorkerExecutable(sourcePath, dest string) error {
	source, err := os.Open(sourcePath)
	if err != nil { return err }
	defer source.Close()
	info, err := source.Stat()
	if err != nil { return err }
	if !info.Mode().IsRegular() || info.Size()<128*1024 || info.Size()>200*1024*1024 {
		return errors.New("protected broker source binary invalid")
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil { return err }
	ok := false
	defer func(){ if !ok { _ = os.Remove(dest) } }()
	n, err := io.Copy(out, io.LimitReader(source, info.Size()+1))
	if err==nil { err=out.Sync() }
	closeErr:=out.Close()
	if err!=nil { return err }
	if closeErr!=nil { return closeErr }
	if n!=info.Size(){return errors.New("broker worker copy truncated")}
	ok=true
	return nil
}
