//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"unsafe"
)

const createNoWindow = 0x08000000
const attachParentProcess = ^uint32(0)

var launcherVisualMode bool

var (
	procAttachConsole       = kernel32.NewProc("AttachConsole")
	procAllocConsole        = kernel32.NewProc("AllocConsole")
	procGetConsoleWindow    = kernel32.NewProc("GetConsoleWindow")
	procSetConsoleTitle     = kernel32.NewProc("SetConsoleTitleW")
	procGetCurrentProcess   = kernel32.NewProc("GetCurrentProcess")
	advapi32                = syscall.NewLazyDLL("advapi32.dll")
	procOpenProcessToken    = advapi32.NewProc("OpenProcessToken")
	procGetTokenInformation = advapi32.NewProc("GetTokenInformation")
	shell32                 = syscall.NewLazyDLL("shell32.dll")
	procShellExecuteW       = shell32.NewProc("ShellExecuteW")
)

const (
	tokenQuery              = 0x0008
	tokenElevationClass     = 20
	swShowNormal            = 1
	shellExecuteSuccessBase = 32
)

type tokenElevation struct {
	TokenIsElevated uint32
}

// ensureWindowsAdministrator makes ClusterServer.exe request elevation itself.
// The executable stays a GUI-subsystem binary, so the UAC prompt is the only
// launch-time UI before the first-run interface/command-line choice.
func ensureWindowsAdministrator() (relaunched bool, err error) {
	elevated, err := windowsProcessElevated()
	if err != nil {
		return false, err
	}
	if elevated {
		return false, nil
	}
	executable, err := os.Executable()
	if err != nil {
		return false, fmt.Errorf("could not resolve ClusterServer.exe for elevation: %w", err)
	}
	workingDirectory, _ := os.Getwd()
	arguments := make([]string, 0, len(os.Args)-1)
	for _, argument := range os.Args[1:] {
		arguments = append(arguments, syscall.EscapeArg(argument))
	}
	parameterText := strings.Join(arguments, " ")
	var parameters uintptr
	if parameterText != "" {
		parameters = uintptr(unsafe.Pointer(utf16(parameterText)))
	}
	var directory uintptr
	if workingDirectory != "" {
		directory = uintptr(unsafe.Pointer(utf16(workingDirectory)))
	}
	result, _, callErr := procShellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(utf16("runas"))),
		uintptr(unsafe.Pointer(utf16(executable))),
		parameters,
		directory,
		swShowNormal,
	)
	if result <= shellExecuteSuccessBase {
		return false, fmt.Errorf("Cluster Server requires administrator privileges and elevation was not completed (ShellExecute code %d: %v)", result, callErr)
	}
	return true, nil
}

func windowsProcessElevated() (bool, error) {
	process, _, _ := procGetCurrentProcess.Call()
	var token uintptr
	ok, _, openErr := procOpenProcessToken.Call(process, tokenQuery, uintptr(unsafe.Pointer(&token)))
	if ok == 0 {
		return false, fmt.Errorf("could not inspect Cluster Server process token: %v", openErr)
	}
	defer procCloseHandle.Call(token)
	var elevation tokenElevation
	var returned uint32
	ok, _, infoErr := procGetTokenInformation.Call(
		token,
		tokenElevationClass,
		uintptr(unsafe.Pointer(&elevation)),
		unsafe.Sizeof(elevation),
		uintptr(unsafe.Pointer(&returned)),
	)
	if ok == 0 {
		return false, fmt.Errorf("could not inspect Cluster Server elevation state: %v", infoErr)
	}
	return elevation.TokenIsElevated != 0, nil
}

func setLauncherVisualMode(enabled bool) {
	launcherVisualMode = enabled
}

// configureChildProcess prevents console-mode helpers such as Node.js, npm,
// initdb, pg_ctl, psql and taskkill from creating stray command windows when
// ClusterServer.exe is running as the native GUI control panel.
func configureChildProcess(cmd *exec.Cmd) {
	if cmd == nil || !launcherVisualMode {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	// A GUI-subsystem parent does not have meaningful stdin. Child setup tools do
	// not need it, and leaving it nil also avoids console attachment surprises.
	cmd.Stdin = nil
}

func ensureWindowsConsole() error {
	console, _, _ := procGetConsoleWindow.Call()
	if console == 0 {
		attached, _, _ := procAttachConsole.Call(uintptr(attachParentProcess))
		if attached == 0 {
			allocated, _, allocErr := procAllocConsole.Call()
			if allocated == 0 {
				return fmt.Errorf("could not attach or allocate a Windows console: %v", allocErr)
			}
		}
	}

	stdin, err := os.OpenFile("CONIN$", os.O_RDWR, 0)
	if err != nil {
		return err
	}
	stdout, err := os.OpenFile("CONOUT$", os.O_RDWR, 0)
	if err != nil {
		_ = stdin.Close()
		return err
	}
	stderr, err := os.OpenFile("CONOUT$", os.O_RDWR, 0)
	if err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return err
	}
	os.Stdin, os.Stdout, os.Stderr = stdin, stdout, stderr
	procSetConsoleTitle.Call(uintptr(unsafe.Pointer(utf16("Cluster Windows Server"))))
	return nil
}
