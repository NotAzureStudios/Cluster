//go:build windows

package main

import (
	nativealerts "cluster.local/native-alerts"
	processjob "cluster.local/native-process-job"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// The native Windows Service owns the server process. The interactive window
// is a client of SCM and must never be the lifetime owner of this service.
const clusterServiceName = "ClusterStudioServer"
const (
	scManagerConnect         = 0x0001
	scManagerCreateService   = 0x0002
	serviceQueryStatus       = 0x0004
	serviceStartAccess       = 0x0010
	serviceStopAccess        = 0x0020
	serviceDeleteAccess      = 0x00010000
	serviceWin32OwnProcess   = 0x0010
	serviceAutoStart         = 2
	serviceErrorNormal       = 1
	serviceStopped           = 1
	serviceStartPending      = 2
	serviceStopPending       = 3
	serviceRunning           = 4
	serviceControlStop       = 1
	serviceControlShutdown   = 5
	serviceAcceptStop        = 1
	serviceAcceptShutdown    = 4
	serviceStatusProcessInfo = 0
)

var serviceDLL = syscall.NewLazyDLL("advapi32.dll")
var (
	apiStartServiceCtrlDispatcher = serviceDLL.NewProc("StartServiceCtrlDispatcherW")
	apiRegisterServiceCtrlHandler = serviceDLL.NewProc("RegisterServiceCtrlHandlerExW")
	apiSetServiceStatus           = serviceDLL.NewProc("SetServiceStatus")
	apiOpenSCManager              = serviceDLL.NewProc("OpenSCManagerW")
	apiOpenService                = serviceDLL.NewProc("OpenServiceW")
	apiCreateService              = serviceDLL.NewProc("CreateServiceW")
	apiStartService               = serviceDLL.NewProc("StartServiceW")
	apiControlService             = serviceDLL.NewProc("ControlService")
	apiQueryServiceStatusEx       = serviceDLL.NewProc("QueryServiceStatusEx")
	apiDeleteService              = serviceDLL.NewProc("DeleteService")
	apiCloseServiceHandle         = serviceDLL.NewProc("CloseServiceHandle")
)

type windowsServiceTableEntry struct {
	name     *uint16
	callback uintptr
}
type windowsServiceStatus struct {
	serviceType, currentState, controlsAccepted, win32ExitCode, serviceSpecificExitCode, checkpoint, waitHint uint32
}
type windowsServiceStatusProcess struct {
	windowsServiceStatus
	processID, serviceFlags uint32
}
type managedServiceInfo struct {
	Installed bool
	State     uint32
	PID       uint32
}

var serviceContext struct {
	sync.Mutex
	cancel context.CancelFunc
	handle uintptr
	status windowsServiceStatus
	root   string
}

func serviceError(action string, err error) error {
	if err == syscall.Errno(0) {
		err = syscall.EINVAL
	}
	return fmt.Errorf("%s Cluster service: %w", action, err)
}
func closeServiceHandle(handle uintptr) {
	if handle != 0 {
		apiCloseServiceHandle.Call(handle)
	}
}
func openClusterService(access uint32) (uintptr, uintptr, error) {
	manager, _, err := apiOpenSCManager.Call(0, 0, scManagerConnect)
	if manager == 0 {
		return 0, 0, serviceError("open SCM", err)
	}
	service, _, openErr := apiOpenService.Call(manager, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(clusterServiceName))), uintptr(access))
	if service == 0 {
		closeServiceHandle(manager)
		return 0, 0, serviceError("open", openErr)
	}
	return manager, service, nil
}
func queryClusterService() (managedServiceInfo, error) {
	manager, service, err := openClusterService(serviceQueryStatus)
	if err != nil {
		if errors.Is(err, syscall.Errno(1060)) {
			return managedServiceInfo{}, nil
		} // ERROR_SERVICE_DOES_NOT_EXIST
		return managedServiceInfo{}, err
	}
	defer closeServiceHandle(manager)
	defer closeServiceHandle(service)
	var status windowsServiceStatusProcess
	var size uint32
	ok, _, callErr := apiQueryServiceStatusEx.Call(service, serviceStatusProcessInfo, uintptr(unsafe.Pointer(&status)), unsafe.Sizeof(status), uintptr(unsafe.Pointer(&size)))
	if ok == 0 {
		return managedServiceInfo{}, serviceError("query", callErr)
	}
	return managedServiceInfo{Installed: true, State: status.currentState, PID: status.processID}, nil
}
func startClusterService() error {
	manager, service, err := openClusterService(serviceStartAccess)
	if err != nil {
		return err
	}
	defer closeServiceHandle(manager)
	defer closeServiceHandle(service)
	ok, _, callErr := apiStartService.Call(service, 0, 0)
	if ok == 0 && !errors.Is(callErr, syscall.Errno(1056)) {
		return serviceError("start", callErr)
	} // already running
	return nil
}
func stopClusterService() error {
	manager, service, err := openClusterService(serviceStopAccess | serviceQueryStatus)
	if err != nil {
		return err
	}
	defer closeServiceHandle(manager)
	defer closeServiceHandle(service)
	var status windowsServiceStatus
	ok, _, callErr := apiControlService.Call(service, serviceControlStop, uintptr(unsafe.Pointer(&status)))
	if ok == 0 && !errors.Is(callErr, syscall.Errno(1062)) {
		return serviceError("stop", callErr)
	} // already stopped
	return nil
}
func waitClusterService(target uint32, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		current, err := queryClusterService()
		if err != nil {
			return err
		}
		if !current.Installed {
			return fmt.Errorf("Cluster service was removed")
		}
		if current.State == target {
			return nil
		}
		// Refuse to loop on terminal states that cannot reach the target.
		if target == serviceRunning && current.State == serviceStopped {
			return fmt.Errorf("Cluster service stopped during startup; inspect native logs")
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("Cluster service did not reach state %d within %s", target, timeout)
}
func installClusterService(root string) error {
	// The service never runs as LocalSystem. Provision access for LocalService
	// explicitly on a dedicated data/runtime directory before installation.
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, err = filepath.Abs(exe)
	if err != nil {
		return err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return err
	}
	if !filepath.IsAbs(root) || !filepath.IsAbs(exe) {
		return fmt.Errorf("service installation requires absolute paths")
	}
	if _, err := os.Stat(filepath.Join(root, "apps", "server")); err != nil {
		return fmt.Errorf("invalid Cluster service workspace: %w", err)
	}
	// IMPORTANT: no broad recursive ACL changes to executable/source folders.
	// Operators provision the restricted service identity's runtime/data access
	// with the installer. A direct CLI install rejects unprepared directories.
	if err := checkServiceWorkspaceMarker(root); err != nil {
		return err
	}
	if err := serviceRuntimePrerequisites(root); err != nil {
		return err
	}
	if _, err := configuredNativeNetwork(root); err != nil {
		return fmt.Errorf("service installation refused: %w", err)
	}
	manager, _, openErr := apiOpenSCManager.Call(0, 0, scManagerCreateService)
	if manager == 0 {
		return serviceError("open SCM for installation", openErr)
	}
	defer closeServiceHandle(manager)
	imagePath := fmt.Sprintf("%s --service --root %s", syscall.EscapeArg(exe), syscall.EscapeArg(root))
	name := syscall.StringToUTF16Ptr(clusterServiceName)
	display := syscall.StringToUTF16Ptr("Cluster Studio Server")
	image := syscall.StringToUTF16Ptr(imagePath)
	account := syscall.StringToUTF16Ptr(`NT AUTHORITY\LocalService`)
	service, _, createErr := apiCreateService.Call(manager,
		uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(display)),
		serviceQueryStatus|serviceStartAccess|serviceStopAccess|serviceDeleteAccess,
		serviceWin32OwnProcess, serviceAutoStart, serviceErrorNormal,
		uintptr(unsafe.Pointer(image)), 0, 0, 0, uintptr(unsafe.Pointer(account)), 0)
	// UTF-16 buffers must outlive the SCM call, including during GC.
	runtime.KeepAlive(name)
	runtime.KeepAlive(display)
	runtime.KeepAlive(image)
	runtime.KeepAlive(account)
	if service == 0 {
		return serviceError("install", createErr)
	}
	closeServiceHandle(service)
	return nil
}
func removeClusterService() error {
	info, err := queryClusterService()
	if err != nil {
		return err
	}
	if !info.Installed {
		return nil
	}
	if info.State != serviceStopped {
		return fmt.Errorf("stop the Cluster service before uninstalling it")
	}
	manager, service, err := openClusterService(serviceDeleteAccess)
	if err != nil {
		return err
	}
	defer closeServiceHandle(manager)
	defer closeServiceHandle(service)
	ok, _, callErr := apiDeleteService.Call(service)
	if ok == 0 {
		return serviceError("remove", callErr)
	}
	return nil
}
func serviceRuntimePrerequisites(root string) error {
	for _, rel := range []string{
		"CLUSTER_RELEASE.json",
		filepath.Join("apps", "server", "dist", "index.js"),
		filepath.Join("apps", "web", "dist", "index.html"),
		filepath.Join("packages", "shared", "dist", "index.js"),
		filepath.Join("node_modules", "@prisma", "client", "package.json"),
		filepath.Join("node_modules", "prisma", "package.json"),
		filepath.Join("runtime", "postgresql", "bin", "postgres.exe"),
	} {
		if _, err := os.Stat(filepath.Join(root, rel)); err != nil {
			return fmt.Errorf("service requires a prepared Windows installation (%s): %w; run the interactive setup before enabling boot-time service", rel, err)
		}
	}
	if !releasePrebuiltReady(root) {
		return fmt.Errorf("service startup requires a version-matched prebuilt release; update and verify the packaged application before service installation")
	}
	return nil
}
func checkServiceWorkspaceMarker(root string) error {
	// Intentional opt-in: the real Windows installer must set owner/ACLs and
	// create this file after validating least-privileged runtime operations.
	marker := filepath.Join(root, "data", "system", "config", "windows-service-ready.marker")
	value, err := os.ReadFile(marker)
	if err != nil || strings.TrimSpace(string(value)) != "localservice-workspace-v1" {
		return fmt.Errorf("Windows Service installation blocked: service-account workspace provisioning has not been verified; no permissions were changed (expected %s)", marker)
	}
	return nil
}
func reportServiceState(state, accepted uint32) {
	serviceContext.Lock()
	previous := serviceContext.status.currentState
	if state == serviceStartPending && previous != serviceStartPending {
		serviceContext.Unlock()
		return // an old startup heartbeat cannot revert SCM_RUNNING or SCM_STOP_PENDING
	}
	if state == serviceRunning && previous != serviceStartPending {
		serviceContext.Unlock()
		return // stop won the race; never report running again
	}
	serviceContext.status.currentState = state
	serviceContext.status.controlsAccepted = accepted
	if state == serviceStopPending || state == serviceStartPending {
		serviceContext.status.waitHint = 180000
		serviceContext.status.checkpoint++
	} else {
		serviceContext.status.waitHint = 0
		serviceContext.status.checkpoint = 0
	}
	status := serviceContext.status
	handle := serviceContext.handle
	serviceContext.Unlock()
	if handle != 0 {
		apiSetServiceStatus.Call(handle, uintptr(unsafe.Pointer(&status)))
	}
}

var serviceHandlerCallback = syscall.NewCallback(func(control, eventType uint32, eventData, context uintptr) uintptr {
	if control == serviceControlStop || control == serviceControlShutdown {
		reportServiceState(serviceStopPending, 0)
		serviceContext.Lock()
		cancel := serviceContext.cancel
		serviceContext.Unlock()
		if cancel != nil {
			cancel()
		}
	}
	return 0
})
var serviceMainCallback = syscall.NewCallback(func(argc uintptr, argv uintptr) uintptr {
	handle, _, _ := apiRegisterServiceCtrlHandler.Call(uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(clusterServiceName))), serviceHandlerCallback, 0)
	if handle == 0 {
		return 0
	}
	ctx, cancel := context.WithCancel(context.Background())
	serviceContext.Lock()
	serviceContext.handle = handle
	serviceContext.cancel = cancel
	serviceContext.status = windowsServiceStatus{serviceType: serviceWin32OwnProcess, currentState: serviceStartPending, waitHint: 30000, checkpoint: 1}
	serviceContext.Unlock()
	reportServiceState(serviceStartPending, 0)
	serviceContext.Lock()
	root := serviceContext.root
	serviceContext.Unlock()
	// Both startup and shutdown can be long. Refresh SCM checkpoints while
	// provisioning / draining, without claiming RUNNING before API readiness.
	heartbeatDone := make(chan struct{})
	heartbeatStopped := make(chan struct{})
	go func() {
		defer close(heartbeatStopped)
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatDone:
				return
			case <-ticker.C:
				serviceContext.Lock()
				current := serviceContext.status.currentState
				serviceContext.Unlock()
				if current == serviceStartPending || current == serviceStopPending {
					reportServiceState(current, 0)
				}
			}
		}
	}()
	// The SCM supervises this persistent process independently of user logon.
	err := runServiceManaged(ctx, root, func() {
		if ctx.Err() == nil {
			reportServiceState(serviceRunning, serviceAcceptStop|serviceAcceptShutdown)
		}
	})
	close(heartbeatDone)
	<-heartbeatStopped
	if err != nil && ctx.Err() == nil {
		recordLauncherEmergency(root, nativealerts.HostUnexpectedExit)
		serviceContext.Lock()
		serviceContext.status.win32ExitCode = 1
		serviceContext.Unlock()
	}
	reportServiceState(serviceStopped, 0)
	cancel()
	return 0
})

func runWindowsService(root string) error {
	serviceContext.Lock()
	serviceContext.root = root
	serviceContext.Unlock()
	name := syscall.StringToUTF16Ptr(clusterServiceName)
	table := [2]windowsServiceTableEntry{{name: name, callback: serviceMainCallback}, {}}
	ok, _, err := apiStartServiceCtrlDispatcher.Call(uintptr(unsafe.Pointer(&table[0])))
	if ok == 0 {
		return serviceError("connect to SCM", err)
	}
	return nil
}
func runServiceManaged(ctx context.Context, root string, onReady func()) error {
	reachedReady := false
	err := runServiceManagedOnce(ctx, root, func() {
		reachedReady = true
		if onReady != nil {
			onReady()
		}
	})
	// Only a failed FIRST BOOT can trigger this rollback, never a later crash
	// and never an intentional SCM stop. The exact protected config file must
	// still match the committed staged snapshot, with no publication in flight.
	if err == nil || reachedReady || ctx.Err() != nil {
		return err
	}
	restored, rollbackErr := rollbackNativeNetworkDeployment(root)
	if rollbackErr != nil {
		recordLauncherEmergency(root, nativealerts.NetworkRollbackBlocked)
		return fmt.Errorf("service startup failed: %w; guarded network rollback refused: %v", err, rollbackErr)
	}
	if !restored {
		return err
	}
	recordLauncherEmergency(root, nativealerts.NetworkRollbackRestored)
	// Retry ONCE using the previous exact config. Do not loop on bad hardware,
	// unavailable storage, credentials, migrations, or missing dependencies.
	return runServiceManagedOnce(ctx, root, onReady)
}

func runServiceManagedOnce(ctx context.Context, root string, onReady func()) error {
	// Service work does not depend on the control panel message loop.
	logDir := filepath.Join(root, "data", "system", "logs")
	if err := os.MkdirAll(logDir, 0700); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(logDir, "windows-service.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	write := func(s string) { fmt.Fprintf(file, "%s %s\n", time.Now().Format(time.RFC3339), s); _ = file.Sync() }
	write("Native service starting")
	if err := serviceRuntimePrerequisites(root); err != nil {
		write("Service preflight blocked: " + err.Error())
		return err
	}
	if err := serviceNetworkPreflight(root); err != nil {
		write("Service preflight blocked: " + err.Error())
		return err
	}
	configured, configErr := loadServerConfig(root)
	if configErr != nil {
		write("Service preflight blocked: cannot read configuration")
		return configErr
	}
	if err := checkManagedWorkspaceWrites(root, configured.Settings); err != nil {
		write("Service permission preflight blocked: " + err.Error())
		return err
	}

	node, npm, cleanup, err := preparePlatformRuntime(root)
	if err != nil {
		write("Runtime preparation failed: " + err.Error())
		return err
	}
	if cleanup != nil {
		defer cleanup()
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	env, err := ensureServerEnvironment(root)
	if err != nil {
		write("Environment preparation failed: " + err.Error())
		return err
	}
	defer cleanupRuntimes()
	if err = prepareApplicationContext(ctx, root, node, npm, env, false); err != nil {
		write("Application preparation failed: " + err.Error())
		return err
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	controlFile := filepath.Join(root, "data", "system", "runtime", "windows-service.control")
	if err = os.MkdirAll(filepath.Dir(controlFile), 0700); err != nil {
		return err
	}
	if err = os.WriteFile(controlFile, []byte("run\n"), 0600); err != nil {
		return err
	}
	defer os.Remove(controlFile)
	cmd, err := managedHostCommand(launcherOptions{root: root}, node, env, controlFile)
	if err != nil {
		return err
	}
	readyFile := filepath.Join(root, "data", "system", "runtime", "windows-service.ready")
	_ = os.Remove(readyFile) // stale markers must never imply readiness
	defer os.Remove(readyFile)
	cmd.Args = append(cmd.Args, "--ready-file", readyFile)
	cmd.Stdin = nil
	cmd.Stdout = file
	cmd.Stderr = file
	job, err := processjob.New()
	if err != nil {
		return fmt.Errorf("could not allocate Windows Host process job: %w", err)
	}
	defer job.Close()
	if err = cmd.Start(); err != nil {
		return err
	}
	if err = job.Assign(cmd); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return fmt.Errorf("Host start refused: job ownership failed: %w", err)
	}
	write(fmt.Sprintf("Native Host PID %d (job-owned)", cmd.Process.Pid))
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	// Do not report SCM_RUNNING until Cluster Host publishes its private,
	// atomic marker after its API readiness check. This prevents false green
	// status during PostgreSQL startup, migrations and HTTP failures.
	readyTicker := time.NewTicker(250 * time.Millisecond)
	defer readyTicker.Stop()
	deadline := time.NewTimer(90 * time.Second)
	defer deadline.Stop()
	awaitingReadiness := true
	for awaitingReadiness {
		select {
		case err = <-done:
			_ = job.Close()
			return fmt.Errorf("Host exited before becoming ready: %v", err)
		case <-ctx.Done():
			_ = job.Close()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
			}
			return nil
		case <-deadline.C:
			_ = job.Close()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
			}
			return fmt.Errorf("Host did not publish confirmed readiness within 90 seconds")
		case <-readyTicker.C:
			if b, e := os.ReadFile(readyFile); e == nil && strings.TrimSpace(string(b)) == "cluster-host-ready-v1" {
				if verifyErr := verifyNativeNetworkDeployment(root); verifyErr != nil {
					_ = job.Close()
					select {
					case <-done:
					case <-time.After(5 * time.Second):
					}
					return fmt.Errorf("native network rollout verification failed: %w", verifyErr)
				}
				awaitingReadiness = false
				if onReady != nil {
					onReady()
				}
				write("API and web readiness confirmed")
			}
		}
	}
	select {
	case err = <-done:
		write(fmt.Sprintf("Host exited: %v", err))
		if ctx.Err() == nil {
			return fmt.Errorf("managed Cluster Host exited without a service stop request: %v", err)
		}
		return nil
	case <-ctx.Done():
		write("SCM stop requested; draining host")
		_ = os.WriteFile(controlFile, []byte("stop\n"), 0600)
		select {
		case <-done:
			write("Host drained")
			return nil
		case <-time.After(managedHostStopGrace):
			write("Host exceeded shutdown deadline; closing kernel job to terminate descendants")
			_ = job.Close()
			select {
			case <-done:
				return nil
			case <-time.After(5 * time.Second):
				return fmt.Errorf("Host did not exit after its Windows job was terminated")
			}
		}
	}
}
