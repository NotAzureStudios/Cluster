//go:build windows

package main

import (
	nativealerts "cluster.local/native-alerts"
	processjob "cluster.local/native-process-job"
	"context"
	"fmt"
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

const (
	wmDestroy            = 0x0002
	wmDrawItem           = 0x002B
	wmSize               = 0x0005
	wmClose              = 0x0010
	wmEraseBkgnd         = 0x0014
	wmCommand            = 0x0111
	wmTimer              = 0x0113
	wmVScroll            = 0x0115
	wmKeyDown            = 0x0100
	wmSetFont            = 0x0030
	wmGetFont            = 0x0031
	wmSetIcon            = 0x0080
	wmCtlColorEdit       = 0x0133
	wmCtlColorStatic     = 0x0138
	wmCtlColorBtn        = 0x0135
	wmApp                = 0x8000
	wmAppLog             = wmApp + 1
	wmAppState           = wmApp + 2
	wmAppExit            = wmApp + 3
	wmAppAutostart       = wmApp + 4
	wmAppUpdate          = wmApp + 5
	wmAppTray            = wmApp + 6
	wmLButtonDblclk      = 0x0203
	wmRButtonUp          = 0x0205
	sizeMinimized        = 1
	swMinimize           = 6
	swRestore            = 9
	swpNoSize            = 0x0001
	swpNoMove            = 0x0002
	swpNoActivate        = 0x0010
	nimAdd               = 0
	nimModify            = 1
	nimDelete            = 2
	nifMessage           = 1
	nifIcon              = 2
	nifTip               = 4
	mfString             = 0
	mfSeparator          = 0x800
	tpmRightButton       = 0x0002
	idTrayShow           = 1030
	idTrayExit           = 1031
	emSetSel             = 0x00B1
	emReplaceSel         = 0x00C2
	emSetLimitText       = 0x00C5
	emSetCueBanner       = 0x1501
	emSetBkgndColor      = 0x0443
	emSetCharFormat      = 0x0444
	emGetScrollPos       = 0x04DD
	emSetScrollPos       = 0x04DE
	scfSelection         = 0x0001
	wsOverlappedWin      = 0x00CF0000
	wsClipChildren       = 0x02000000
	wsChild              = 0x40000000
	wsVisible            = 0x10000000
	wsTabStop            = 0x00010000
	wsBorder             = 0x00800000
	wsVScroll            = 0x00200000
	esMultiline          = 0x0004
	esAutoVScroll        = 0x0040
	esAutoHScroll        = 0x0080
	esReadOnly           = 0x0800
	esPassword           = 0x0020
	bsPushButton         = 0x0000000B // BS_OWNERDRAW keeps native utility buttons theme-consistent.
	sbBottom             = 7
	cbsDropdownList      = 0x00000003
	ssLeft               = 0x00000000
	swHide               = 0
	swShow               = 5
	mbYesNo              = 0x00000004
	mbIconQuestion       = 0x00000020
	mbIconError          = 0x00000010
	idYes                = 6
	iconSmall            = 0
	iconBig              = 1
	imageIcon            = 1
	lrLoadFromFile       = 0x0010
	colorBtnFace         = 15
	defaultGUIFont       = 17
	dcBrush              = 18
	cfUnicodeText        = 13
	gmemMoveable         = 0x0002
	odsSelected          = 0x0001
	odsDisabled          = 0x0004
	odsFocus             = 0x0010
	dtCenter             = 0x0001
	dtVCenter            = 0x0004
	dtSingleLine         = 0x0020
	dtEndEllipsis        = 0x8000
	idStart              = 1001
	idStop               = 1002
	idRestart            = 1003
	idOpenWeb            = 1004
	idOpenLogs           = 1005
	idOpenFolder         = 1006
	idClearLogs          = 1007
	idSettings           = 1008
	idCheckUpdates       = 1009
	idDbDoctor           = 1012
	idRepair             = 1013
	idCommand            = 1010
	idRunCommand         = 1011
	idThemeToggle        = 1014
	idPerformanceToggle  = 1015
	pbmSetPos            = 0x0402
	pbmSetRange32        = 0x0406
	pbmSetBarColor       = 0x0409
	idCopyLogs           = 1016
	idAutoScroll         = 1017
	idFilterInfo         = 1018
	idFilterWarning      = 1019
	idFilterError        = 1020
	idFilterSuccess      = 1021
	vkReturn             = 0x0D
	cbGetCurSel          = 0x0147
	cbAddString          = 0x0143
	cbResetContent       = 0x014B
	cbSetCurSel          = 0x014E
	cbnSelChange         = 1
	idSettingSection     = 2001
	idSettingName        = 2002
	idSettingSave        = 2003
	idSettingSaveRestart = 2004
	idSettingClear       = 2005
	idSettingOpenFile    = 2006
	idSettingClose       = 2007
	idSettingSearch      = 2008
	lbAddString          = 0x0180
	lbResetContent       = 0x0184
	lbSetCurSel          = 0x0186
	lbGetCurSel          = 0x0188
	lbsNotify            = 0x0001
	lbnSelChange         = 1
	enChange             = 0x0300
	wmCtlColorListbox    = 0x0134
)

var (
	user32                     = syscall.NewLazyDLL("user32.dll")
	kernel32                   = syscall.NewLazyDLL("kernel32.dll")
	gdi32                      = syscall.NewLazyDLL("gdi32.dll")
	procRegisterClassExW       = user32.NewProc("RegisterClassExW")
	procCreateWindowExW        = user32.NewProc("CreateWindowExW")
	procDefWindowProcW         = user32.NewProc("DefWindowProcW")
	procShowWindow             = user32.NewProc("ShowWindow")
	procUpdateWindow           = user32.NewProc("UpdateWindow")
	procGetMessageW            = user32.NewProc("GetMessageW")
	procTranslateMessage       = user32.NewProc("TranslateMessage")
	procDispatchMessageW       = user32.NewProc("DispatchMessageW")
	procPostQuitMessage        = user32.NewProc("PostQuitMessage")
	procPostMessageW           = user32.NewProc("PostMessageW")
	procSendMessageW           = user32.NewProc("SendMessageW")
	procMoveWindow             = user32.NewProc("MoveWindow")
	procEnableWindow           = user32.NewProc("EnableWindow")
	procSetWindowTextW         = user32.NewProc("SetWindowTextW")
	procInvalidateRect         = user32.NewProc("InvalidateRect")
	procGetClientRect          = user32.NewProc("GetClientRect")
	procFillRect               = user32.NewProc("FillRect")
	procFrameRect              = user32.NewProc("FrameRect")
	procDrawTextW              = user32.NewProc("DrawTextW")
	procDrawFocusRect          = user32.NewProc("DrawFocusRect")
	procOpenClipboard          = user32.NewProc("OpenClipboard")
	procEmptyClipboard         = user32.NewProc("EmptyClipboard")
	procSetClipboardData       = user32.NewProc("SetClipboardData")
	procCloseClipboard         = user32.NewProc("CloseClipboard")
	procGetWindowTextW         = user32.NewProc("GetWindowTextW")
	procGetWindowTextLength    = user32.NewProc("GetWindowTextLengthW")
	procDestroyWindow          = user32.NewProc("DestroyWindow")
	procLoadCursorW            = user32.NewProc("LoadCursorW")
	procMessageBoxW            = user32.NewProc("MessageBoxW")
	procSetWindowLongPtrW      = user32.NewProc("SetWindowLongPtrW")
	procCallWindowProcW        = user32.NewProc("CallWindowProcW")
	procGetStockObject         = gdi32.NewProc("GetStockObject")
	procCreateFontW            = gdi32.NewProc("CreateFontW")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procGetModuleHandleW       = kernel32.NewProc("GetModuleHandleW")
	procCreateMutexW           = kernel32.NewProc("CreateMutexW")
	procCloseHandle            = kernel32.NewProc("CloseHandle")
	procGlobalAlloc            = kernel32.NewProc("GlobalAlloc")
	procGlobalLock             = kernel32.NewProc("GlobalLock")
	procGlobalUnlock           = kernel32.NewProc("GlobalUnlock")
	procGlobalFree             = kernel32.NewProc("GlobalFree")
	procSetTimer               = user32.NewProc("SetTimer")
	procKillTimer              = user32.NewProc("KillTimer")
	procSetForegroundWindow    = user32.NewProc("SetForegroundWindow")
	procFindWindowW            = user32.NewProc("FindWindowW")
	procLoadImageW             = user32.NewProc("LoadImageW")
	procShellNotifyIcon        = syscall.NewLazyDLL("shell32.dll").NewProc("Shell_NotifyIconW")
	procSetWindowPos           = user32.NewProc("SetWindowPos")
	procCreatePopupMenu        = user32.NewProc("CreatePopupMenu")
	procAppendMenuW            = user32.NewProc("AppendMenuW")
	procTrackPopupMenu         = user32.NewProc("TrackPopupMenu")
	procDestroyMenu            = user32.NewProc("DestroyMenu")
	procGetCursorPos           = user32.NewProc("GetCursorPos")
	procRegisterWindowMessageW = user32.NewProc("RegisterWindowMessageW")
	procLoadIconW              = user32.NewProc("LoadIconW")
	procGetSysColorBrush       = user32.NewProc("GetSysColorBrush")
	procInitCommonControlsEx    = syscall.NewLazyDLL("comctl32.dll").NewProc("InitCommonControlsEx")
	procSetTextColor           = gdi32.NewProc("SetTextColor")
	procSetBkColor             = gdi32.NewProc("SetBkColor")
	procSetBkMode              = gdi32.NewProc("SetBkMode")
	procCreateSolidBrush       = gdi32.NewProc("CreateSolidBrush")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procLoadLibraryW           = kernel32.NewProc("LoadLibraryW")
	uxtheme                    = syscall.NewLazyDLL("uxtheme.dll")
	procSetWindowTheme         = uxtheme.NewProc("SetWindowTheme")
	dwmapi                     = syscall.NewLazyDLL("dwmapi.dll")
	procDwmSetWindowAttribute  = dwmapi.NewProc("DwmSetWindowAttribute")
)

const (
	cfmColor    = 0x40000000
	transparent = 1
)

type charFormat2 struct {
	cbSize          uint32
	dwMask          uint32
	dwEffects       uint32
	yHeight         int32
	yOffset         int32
	crTextColor     uint32
	bCharSet        byte
	bPitchAndFamily byte
	szFaceName      [32]uint16
	wWeight         uint16
	sSpacing        int16
	crBackColor     uint32
	lcid            uint32
	dwReserved      uint32
	sStyle          int16
	wKerning        uint16
	bUnderlineType  byte
	bAnimation      byte
	bRevAuthor      byte
	bReserved1      byte
}

type winNotifyIcon struct {
	cbSize          uint32
	hwnd            uintptr
	id              uint32
	flags           uint32
	callbackMessage uint32
	icon            uintptr
	tip             [128]uint16
	state           uint32
	stateMask       uint32
	info            [256]uint16
	version         uint32
	infoTitle       [64]uint16
	infoFlags       uint32
	guidItem        [16]byte
	balloonIcon     uintptr
}

type winPoint struct {
	x int32
	y int32
}

type winRect struct {
	left   int32
	top    int32
	right  int32
	bottom int32
}

type drawItemStruct struct {
	ctlType    uint32
	ctlID      uint32
	itemID     uint32
	itemAction uint32
	itemState  uint32
	hwndItem   uintptr
	hdc        uintptr
	rcItem     winRect
	itemData   uintptr
}

type winMsg struct {
	hwnd     uintptr
	message  uint32
	wParam   uintptr
	lParam   uintptr
	time     uint32
	pt       winPoint
	lPrivate uint32
}

type wndClassEx struct {
	cbSize     uint32
	style      uint32
	wndProc    uintptr
	clsExtra   int32
	wndExtra   int32
	instance   uintptr
	icon       uintptr
	cursor     uintptr
	background uintptr
	menuName   *uint16
	className  *uint16
	iconSmall  uintptr
}

type serverPanelState int

const (
	panelStopped serverPanelState = iota
	panelStarting
	panelRunning
	panelStopping
	panelError
)

type windowsServerController struct {
	mu                  sync.Mutex
	options             launcherOptions
	ui                  *windowsControlPanel
	state               serverPanelState
	lastError           string
	cmd                 *exec.Cmd
	hostJob             *processjob.Job
	done                chan struct{}
	stopRequested       bool
	webURL              string
	controlFile         string
	startedAt           time.Time
	activity            string
	updateInFlight      bool
	doctorInFlight      bool
	repairInFlight      bool
	startupCancel       context.CancelFunc
	readinessTimer      *time.Timer
	startupTimedOut     bool
	serviceManaged      bool
	servicePID          int
	serviceProbePending bool
	serviceProbeAt      time.Time
	serviceProbeSummary string
	authorizedRestartID string
}

type winInitCommonControls struct {
	dwSize uint32
	dwICC  uint32
}

type windowsControlPanel struct {
	hwnd                  uintptr
	title                 uintptr
	subtitle              uintptr
	statusDot             uintptr
	status                uintptr
	activity              uintptr
	metrics               uintptr
	performance           uintptr
	performanceTitle      uintptr
	perfCPU               uintptr
	perfRAM               uintptr
	perfDisk              uintptr
	perfCPUBar            uintptr
	perfRAMBar            uintptr
	perfDiskBar           uintptr
	perfService           uintptr
	perfPorts             uintptr
	start                 uintptr
	stop                  uintptr
	restart               uintptr
	openWeb               uintptr
	openLogs              uintptr
	openFolder            uintptr
	settings              uintptr
	checkUpdates          uintptr
	dbDoctor              uintptr
	repair                uintptr
	clearLogs             uintptr
	copyLogs              uintptr
	autoScrollButton      uintptr
	filterInfo            uintptr
	filterWarning         uintptr
	filterError           uintptr
	filterSuccess         uintptr
	themeToggle           uintptr
	performanceToggle     uintptr
	logLabel              uintptr
	logEdit               uintptr
	commandLabel          uintptr
	commandEdit           uintptr
	runCommand            uintptr
	defaultFont           uintptr
	titleFont             uintptr
	monoFont              uintptr
	windowIcon            uintptr
	darkBrush             uintptr
	darkFieldBrush        uintptr
	darkMode              bool
	performanceVisible    bool
	autoScroll            bool
	showInfo              bool
	showWarning           bool
	showError             bool
	showSuccess           bool
	controller            *windowsServerController
	pendingMu             sync.Mutex
	pendingLogs           []string
	logHistory            []string
	logNotifyPending      bool
	resourceSampler       systemResourceSampler
	gpuSampler            nativeGpuSampler
	lastResourceAt        time.Time
	lastResourceSnapshot  resourceSnapshot
	lastServiceRefreshAt time.Time
	lastAuthorizedRestartCheckAt time.Time
	lastPortsAt          time.Time
	lastPortsPID         int
	lastPortsSummary     string
	updateMu              sync.Mutex
	updateMessage         string
	closing               bool
	trayRegistered        bool
	taskbarCreatedMessage uint32
}

type windowsSettingsWindow struct {
	hwnd           uintptr
	title          uintptr
	searchLabel    uintptr
	searchEdit     uintptr
	sectionLabel   uintptr
	sectionCombo   uintptr
	settingLabel   uintptr
	settingCombo   uintptr
	valueLabel     uintptr
	valueEdit      uintptr
	secretEdit     uintptr
	currentLabel   uintptr
	helpLabel      uintptr
	restartLabel   uintptr
	save           uintptr
	saveRestart    uintptr
	clear          uintptr
	openConfig     uintptr
	close          uintptr
	defaultFont    uintptr
	titleFont      uintptr
	darkBrush      uintptr
	darkFieldBrush uintptr
	darkMode       bool
	controller     *windowsServerController
	sections       []string
	currentSpecs   []nativeSettingSpec
	currentSpec    nativeSettingSpec
}

var activeWindowsPanel *windowsControlPanel
var activeSettingsWindow *windowsSettingsWindow
var originalCommandEditProc uintptr
var commandEditCallback = syscall.NewCallback(commandEditWndProc)

func runPlatformLauncher(options launcherOptions) error {
	// The ordinary control panel, local PostgreSQL, and loopback API do not
	// require an administrator token. Always elevating the UI breaks some
	// lower-integrity screenshot/overlay utilities and needlessly expands
	// the privileges held by the web/API child processes. Windows Service
	// installation/removal still requests elevation in service_actions_windows.go.
	prefs := loadNativePanelPreferences(options.root)
	if options.modeOverride == "" && !prefs.Configured {
		answer := messageBox(0, "Cluster Windows Server", "Use visual interface?", mbYesNo|mbIconQuestion)
		prefs.Configured = true
		prefs.UseInterface = answer == idYes
		prefs.StartServerOnLaunch = false
		if err := saveNativePanelPreferences(options.root, prefs); err != nil {
			return fmt.Errorf("could not save the Windows launcher mode: %w", err)
		}
	}
	if options.modeOverride == "interface" {
		options.headless = false
	} else if options.modeOverride == "command-line" {
		options.headless = true
	} else {
		options.headless = !prefs.UseInterface
	}

	setLauncherVisualMode(!options.headless)
	if options.headless {
		if err := ensureWindowsConsole(); err != nil {
			return err
		}
	}
	if prefs.StartWithWindows {
		// Refresh the HKCU Run path when the server directory is moved or upgraded.
		_ = syncWindowsStartupRegistration(true)
	}
	if options.headless {
		return runServerHeadless(options)
	}
	if options.startup {
		options.noAutostart = false
	} else if !prefs.StartServerOnLaunch {
		options.noAutostart = true
	}
	return runWindowsControlPanel(options)
}

func runWindowsControlPanel(options launcherOptions) error {
	// Win32 windows and their message queues are owned by the OS thread that
	// creates them. A Go goroutine may migrate between OS threads unless it is
	// pinned. Without this, CreateWindowExW can run on one thread while
	// GetMessageW later runs on another, leaving the visible window with no
	// functioning message pump and Windows immediately marks it Not Responding.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	mutexName := utf16("Local\\ClusterServerControlPanel")
	mutex, _, mutexErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(mutexName)))
	if mutex == 0 {
		return fmt.Errorf("could not create Cluster Server control-panel mutex: %v", mutexErr)
	}
	defer procCloseHandle.Call(mutex)
	if errno, ok := mutexErr.(syscall.Errno); ok && errno == 183 {
		// A second click on the root Cluster Server.exe should bring its existing
		// Win32 panel back (including when it is minimized to the tray), rather
		// than open a second manager or show a confusing duplicate-instance error.
		className := utf16("ClusterServerNativeControlPanel")
		existing, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(className)), 0)
		if existing != 0 {
			procShowWindow.Call(existing, swRestore)
			procSetForegroundWindow.Call(existing)
			return nil
		}
		messageBox(0, "Cluster Server", "The Cluster Server Manager is already running, but its window could not be found.", mbIconError)
		return nil
	}

	prefs := loadNativePanelPreferences(options.root)
	ui := &windowsControlPanel{darkMode: prefs.DarkMode, performanceVisible: nativePerformanceEnabled(prefs), autoScroll: nativeAutoScrollEnabled(prefs), showInfo: true, showWarning: true, showError: true, showSuccess: true}
	controller := &windowsServerController{
		options:     options,
		ui:          ui,
		state:       panelStopped,
		controlFile: filepath.Join(options.root, "data", "system", "runtime", "windows-server.control"),
	}
	ui.controller = controller
	controller.refreshServiceState()
	activeWindowsPanel = ui
	defer func() { activeWindowsPanel = nil }()

	instance, _, _ := procGetModuleHandleW.Call(0)
	cursor, _, _ := procLoadCursorW.Call(0, 32512)
	className := utf16("ClusterServerNativeControlPanel")
	serverIcon := loadClusterServerIcon(options.root)
	ui.windowIcon = serverIcon
	wc := wndClassEx{
		cbSize:     uint32(unsafe.Sizeof(wndClassEx{})),
		wndProc:    syscall.NewCallback(windowsPanelWndProc),
		instance:   instance,
		cursor:     cursor,
		background: colorBtnFace + 1,
		className:  className,
		icon:       serverIcon,
		iconSmall:  serverIcon,
	}
	if atom, _, err := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		if errno, ok := err.(syscall.Errno); !ok || errno != 1410 { // class already exists
			return fmt.Errorf("could not register Cluster Server window class: %v", err)
		}
	}

	hwnd, _, err := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16("Cluster Server " + displayReleaseVersion(options.root)))),
		wsOverlappedWin|wsClipChildren,
		120, 90, 1040, 760,
		0, 0, instance, 0,
	)
	if hwnd == 0 {
		return fmt.Errorf("could not create Cluster Server control panel: %v", err)
	}
	ui.hwnd = hwnd
	taskbarID, _, _ := procRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(utf16("TaskbarCreated"))))
	ui.taskbarCreatedMessage = uint32(taskbarID)
	if serverIcon != 0 {
		procSendMessageW.Call(hwnd, wmSetIcon, iconBig, serverIcon)
		procSendMessageW.Call(hwnd, wmSetIcon, iconSmall, serverIcon)
	}
	if err := ui.createControls(instance); err != nil {
		return err
	}

	captureCleanup, err := installWindowsOutputCapture(options.root, ui)
	if err != nil {
		return err
	}
	defer captureCleanup()

	fmt.Printf("Cluster Server %s native Windows control panel\n", displayReleaseVersion(options.root))
	fmt.Printf("Workspace: %s\n", options.root)
	fmt.Println("Interface: native Win32 controls; no browser renderer or WebView is used by this control panel.")
	fmt.Println()

	ui.applyWindowPreferences(prefs)
	ui.registerTrayIcon()
	if prefs.StartMinimized {
		procShowWindow.Call(hwnd, swMinimize)
		if prefs.MinimizeToTray && ui.trayRegistered {
			procShowWindow.Call(hwnd, swHide)
		}
	} else {
		procShowWindow.Call(hwnd, swShow)
	}
	procUpdateWindow.Call(hwnd)
	ui.updateStateControls()
	if !options.noAutostart && !controller.serviceManaged {
		procPostMessageW.Call(hwnd, wmAppAutostart, 0, 0)
	}

	var msg winMsg
	for {
		result, _, getErr := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) == -1 {
			return fmt.Errorf("Windows message loop failed: %v", getErr)
		}
		if result == 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}
	cleanupRuntimes()
	return nil
}

func (ui *windowsControlPanel) createControls(instance uintptr) error {
	commonControls := winInitCommonControls{dwSize: uint32(unsafe.Sizeof(winInitCommonControls{})), dwICC: 0x20} // ICC_PROGRESS_CLASS
	if ok, _, err := procInitCommonControlsEx.Call(uintptr(unsafe.Pointer(&commonControls))); ok == 0 {
		return fmt.Errorf("could not initialize native performance meters: %v", err)
	}
	// RichEdit lets the native log remain lightweight while still using semantic
	// severity colors. If the modern control cannot be loaded Windows still has
	// the regular EDIT fallback below.
	procLoadLibraryW.Call(uintptr(unsafe.Pointer(utf16("Msftedit.dll"))))
	stock, _, _ := procGetStockObject.Call(defaultGUIFont)
	ui.defaultFont = stock
	ui.titleFont = createWindowsFont(-24, 600, "Segoe UI")
	ui.monoFont = createWindowsFont(-16, 400, "Consolas")
	if ui.titleFont == 0 {
		ui.titleFont = ui.defaultFont
	}
	if ui.monoFont == 0 {
		ui.monoFont = ui.defaultFont
	}

	var err error
	if ui.title, err = createControl("STATIC", "Cluster Windows Server", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil {
		return err
	}
	if ui.subtitle, err = createControl("STATIC", "Native control panel · "+displayReleaseVersion(ui.controller.options.root), wsChild|wsVisible|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil {
		return err
	}
	if ui.statusDot, err = createControl("STATIC", "●", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil {
		return err
	}
	if ui.status, err = createControl("STATIC", "Stopped", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil {
		return err
	}
	if ui.activity, err = createControl("STATIC", "Ready", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil {
		return err
	}
	if ui.metrics, err = createControl("STATIC", "Uptime --   |   PID --", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil {
		return err
	}
	if ui.performanceTitle, err = createControl("STATIC", "PERFORMANCE  ·  CPU / memory / disk every 5s  ·  GPU every 30s", wsChild|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil { return err }
	if ui.perfCPU, err = createControl("STATIC", "CPU --", wsChild|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil { return err }
	if ui.perfRAM, err = createControl("STATIC", "RAM --", wsChild|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil { return err }
	if ui.perfDisk, err = createControl("STATIC", "Disk --", wsChild|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil { return err }
	if ui.perfCPUBar, err = createControl("msctls_progress32", "", wsChild, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil { return err }
	if ui.perfRAMBar, err = createControl("msctls_progress32", "", wsChild, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil { return err }
	if ui.perfDiskBar, err = createControl("msctls_progress32", "", wsChild, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil { return err }
	for _, bar := range []uintptr{ui.perfCPUBar, ui.perfRAMBar, ui.perfDiskBar} {
		procSendMessageW.Call(bar, pbmSetRange32, 0, 100)
		procSendMessageW.Call(bar, pbmSetBarColor, 0, uintptr(rgbColor(87, 193, 255)))
	}
	if ui.perfService, err = createControl("STATIC", "Cluster process --", wsChild|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil { return err }
	if ui.perfPorts, err = createControl("STATIC", "Ports --", wsChild|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil { return err }
	if ui.performance, err = createControl("STATIC", "GPU --", wsChild|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil { return err }
	if ui.start, err = createControl("BUTTON", "Start", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idStart, instance); err != nil {
		return err
	}
	if ui.stop, err = createControl("BUTTON", "Stop", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idStop, instance); err != nil {
		return err
	}
	if ui.restart, err = createControl("BUTTON", "Restart", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idRestart, instance); err != nil {
		return err
	}
	if ui.openWeb, err = createControl("BUTTON", "Open Web", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idOpenWeb, instance); err != nil {
		return err
	}
	if ui.openLogs, err = createControl("BUTTON", "Open Logs", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idOpenLogs, instance); err != nil {
		return err
	}
	if ui.openFolder, err = createControl("BUTTON", "Server Folder", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idOpenFolder, instance); err != nil {
		return err
	}
	if ui.themeToggle, err = createControl("BUTTON", "Dark mode", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idThemeToggle, instance); err != nil {
		return err
	}
	if ui.performanceToggle, err = createControl("BUTTON", "Performance", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idPerformanceToggle, instance); err != nil {
		return err
	}
	if ui.settings, err = createControl("BUTTON", "Settings", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idSettings, instance); err != nil {
		return err
	}
	if ui.checkUpdates, err = createControl("BUTTON", "Check Updates", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idCheckUpdates, instance); err != nil {
		return err
	}
	if ui.dbDoctor, err = createControl("BUTTON", "DB Doctor", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idDbDoctor, instance); err != nil {
		return err
	}
	if ui.repair, err = createControl("BUTTON", "Repair & Start", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idRepair, instance); err != nil {
		return err
	}
	if ui.clearLogs, err = createControl("BUTTON", "Clear", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idClearLogs, instance); err != nil {
		return err
	}
	if ui.copyLogs, err = createControl("BUTTON", "Copy logs", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idCopyLogs, instance); err != nil {
		return err
	}
	if ui.autoScrollButton, err = createControl("BUTTON", "Auto-scroll", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idAutoScroll, instance); err != nil {
		return err
	}
	if ui.filterInfo, err = createControl("BUTTON", "Info", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idFilterInfo, instance); err != nil {
		return err
	}
	if ui.filterWarning, err = createControl("BUTTON", "Warning", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idFilterWarning, instance); err != nil {
		return err
	}
	if ui.filterError, err = createControl("BUTTON", "Error", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idFilterError, instance); err != nil {
		return err
	}
	if ui.filterSuccess, err = createControl("BUTTON", "Success", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idFilterSuccess, instance); err != nil {
		return err
	}
	if ui.logLabel, err = createControl("STATIC", "Live logs", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil {
		return err
	}
	if ui.logEdit, err = createControl("RICHEDIT50W", "", wsChild|wsVisible|wsBorder|wsVScroll|esMultiline|esAutoVScroll|esReadOnly, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil {
		if ui.logEdit, err = createControl("EDIT", "", wsChild|wsVisible|wsBorder|wsVScroll|esMultiline|esAutoVScroll|esReadOnly, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil {
			return err
		}
	}
	if ui.commandLabel, err = createControl("STATIC", "Local command", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, ui.hwnd, 0, instance); err != nil {
		return err
	}
	if ui.commandEdit, err = createControl("EDIT", "", wsChild|wsVisible|wsTabStop|wsBorder|esAutoHScroll, 0, 0, 0, 0, ui.hwnd, idCommand, instance); err != nil {
		return err
	}
	if ui.runCommand, err = createControl("BUTTON", "Run", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, ui.hwnd, idRunCommand, instance); err != nil {
		return err
	}

	for _, handle := range []uintptr{ui.subtitle, ui.statusDot, ui.status, ui.activity, ui.metrics, ui.performance, ui.performanceTitle, ui.perfCPU, ui.perfRAM, ui.perfDisk, ui.perfService, ui.perfPorts, ui.start, ui.stop, ui.restart, ui.openWeb, ui.openLogs, ui.openFolder, ui.settings, ui.checkUpdates, ui.dbDoctor, ui.repair, ui.themeToggle, ui.performanceToggle, ui.clearLogs, ui.copyLogs, ui.autoScrollButton, ui.filterInfo, ui.filterWarning, ui.filterError, ui.filterSuccess, ui.logLabel, ui.commandLabel, ui.commandEdit, ui.runCommand} {
		procSendMessageW.Call(handle, wmSetFont, ui.defaultFont, 1)
	}
	procSendMessageW.Call(ui.title, wmSetFont, ui.titleFont, 1)
	procSendMessageW.Call(ui.logEdit, wmSetFont, ui.monoFont, 1)
	procSendMessageW.Call(ui.logEdit, emSetLimitText, 2*1024*1024, 0)
	procSendMessageW.Call(ui.commandEdit, emSetCueBanner, 1, uintptr(unsafe.Pointer(utf16("status, restart, stage-update, or a local Windows command"))))
	originalCommandEditProc, _, _ = procSetWindowLongPtrW.Call(ui.commandEdit, ^uintptr(3), commandEditCallback)
	ui.layout(1040, 760)
	ui.applyTheme(ui.darkMode)
	ui.updateLogControlLabels()
	procSetTimer.Call(ui.hwnd, 1, 1000, 0)
	ui.updateMetrics()
	return nil
}

func (ui *windowsControlPanel) layout(width, height int32) {
	if width < 840 {
		width = 840
	}
	if height < 600 {
		height = 600
	}
	margin := int32(20)
	content := width - margin*2
	moveWindow(ui.title, margin, 14, 500, 32)
	moveWindow(ui.subtitle, margin, 46, 620, 22)
	statusX := width - 380
	moveWindow(ui.statusDot, statusX, 19, 18, 22)
	moveWindow(ui.status, statusX+20, 20, 110, 22)
	moveWindow(ui.activity, statusX, 44, 360, 22)
	moveWindow(ui.metrics, margin, 72, content, 22)

	performanceOffset := int32(0)
	performanceLabels := []uintptr{ui.performanceTitle, ui.perfCPU, ui.perfRAM, ui.perfDisk, ui.perfService, ui.perfPorts, ui.performance}
	performanceBars := []uintptr{ui.perfCPUBar, ui.perfRAMBar, ui.perfDiskBar}
	if ui.performanceVisible {
		for _, handle := range performanceLabels { procShowWindow.Call(handle, swShow) }
		for _, handle := range performanceBars { procShowWindow.Call(handle, swShow) }
		moveWindow(ui.performanceTitle, margin, 93, content, 20)
		columnWidth := (content - 32) / 3
		for index, label := range []uintptr{ui.perfCPU, ui.perfRAM, ui.perfDisk} {
			columnX := margin + int32(index)*(columnWidth+16)
			moveWindow(label, columnX, 117, columnWidth, 20)
			moveWindow(performanceBars[index], columnX, 141, columnWidth, 12)
		}
		moveWindow(ui.perfService, margin, 163, content, 20)
		moveWindow(ui.perfPorts, margin, 184, content, 20)
		moveWindow(ui.performance, margin, 205, content, 20)
		performanceOffset = 130
	} else {
		for _, handle := range performanceLabels { procShowWindow.Call(handle, swHide) }
		for _, handle := range performanceBars { procShowWindow.Call(handle, swHide) }
	}

	y := int32(102) + performanceOffset
	x := margin
	for _, item := range []struct {
		h uintptr
		w int32
	}{
		{ui.start, 76}, {ui.stop, 76}, {ui.restart, 86}, {ui.openWeb, 96}, {ui.settings, 88}, {ui.checkUpdates, 118},
		{ui.dbDoctor, 92}, {ui.repair, 112}, {ui.openLogs, 94}, {ui.openFolder, 112}, {ui.themeToggle, 96}, {ui.performanceToggle, 108},
	} {
		if x+item.w > width-margin {
			y += 38
			x = margin
		}
		moveWindow(item.h, x, y, item.w, 30)
		x += item.w + 6
	}

	logLabelY := y + 44
	moveWindow(ui.logLabel, margin, logLabelY, 76, 22)
	filterX := margin + 82
	for _, item := range []struct {
		h uintptr
		w int32
	}{
		{ui.filterInfo, 60}, {ui.filterWarning, 78}, {ui.filterError, 64}, {ui.filterSuccess, 76},
	} {
		moveWindow(item.h, filterX, logLabelY-3, item.w, 27)
		filterX += item.w + 5
	}
	rightX := width - margin
	for _, item := range []struct {
		h uintptr
		w int32
	}{
		{ui.clearLogs, 70}, {ui.copyLogs, 86}, {ui.autoScrollButton, 112},
	} {
		rightX -= item.w
		moveWindow(item.h, rightX, logLabelY-3, item.w, 27)
		rightX -= 5
	}

	commandY := height - 70
	logTop := logLabelY + 28
	logHeight := commandY - logTop - 32
	if logHeight < 100 {
		logHeight = 100
	}
	moveWindow(ui.logEdit, margin, logTop, content, logHeight)
	moveWindow(ui.commandLabel, margin, commandY-22, 220, 20)
	moveWindow(ui.commandEdit, margin, commandY, content-90, 30)
	moveWindow(ui.runCommand, width-margin-80, commandY, 80, 30)
}

func commandEditWndProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	if msg == wmKeyDown && wParam == vkReturn {
		if ui := activeWindowsPanel; ui != nil && ui.hwnd != 0 {
			procPostMessageW.Call(ui.hwnd, wmCommand, idRunCommand, 0)
			return 0
		}
	}
	if originalCommandEditProc != 0 {
		result, _, _ := procCallWindowProcW.Call(originalCommandEditProc, hwnd, uintptr(msg), wParam, lParam)
		return result
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
	return result
}

func windowsPanelWndProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	ui := activeWindowsPanel
	if ui == nil {
		result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
		return result
	}
	if ui.taskbarCreatedMessage != 0 && msg == ui.taskbarCreatedMessage {
		ui.trayRegistered = false
		ui.registerTrayIcon()
		return 0
	}
	switch msg {
	case wmEraseBkgnd:
		if ui.darkMode && ui.darkBrush != 0 {
			var rect winRect
			procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rect)))
			procFillRect.Call(wParam, uintptr(unsafe.Pointer(&rect)), ui.darkBrush)
			return 1
		}
	case wmCtlColorStatic:
		if ui.darkMode {
			procSetBkMode.Call(wParam, transparent)
			if lParam == ui.statusDot {
				state, _ := ui.controller.snapshot()
				procSetTextColor.Call(wParam, uintptr(panelStateColor(state)))
			} else if lParam == ui.activity || lParam == ui.subtitle || lParam == ui.metrics || lParam == ui.performance || lParam == ui.logLabel || lParam == ui.commandLabel {
				procSetTextColor.Call(wParam, uintptr(rgbColor(166, 176, 190)))
			} else {
				procSetTextColor.Call(wParam, uintptr(rgbColor(236, 240, 246)))
			}
			return ui.darkBrush
		}
		if lParam == ui.statusDot {
			state, _ := ui.controller.snapshot()
			procSetBkMode.Call(wParam, transparent)
			procSetTextColor.Call(wParam, uintptr(panelStateColor(state)))
			brush, _, _ := procGetSysColorBrush.Call(colorBtnFace)
			return brush
		}
	case wmCtlColorEdit:
		if ui.darkMode {
			procSetTextColor.Call(wParam, uintptr(rgbColor(232, 237, 244)))
			procSetBkColor.Call(wParam, uintptr(rgbColor(24, 28, 34)))
			return ui.darkFieldBrush
		}
	case wmCtlColorBtn:
		if ui.darkMode {
			procSetTextColor.Call(wParam, uintptr(rgbColor(232, 237, 244)))
			procSetBkColor.Call(wParam, uintptr(rgbColor(31, 36, 43)))
			return ui.darkBrush
		}
	case wmDrawItem:
		if drawOwnerButton(lParam, ui.darkMode) {
			return 1
		}
	case wmSize:
		if wParam == sizeMinimized && loadNativePanelPreferences(ui.controller.options.root).MinimizeToTray && ui.trayRegistered {
			procShowWindow.Call(hwnd, swHide)
			return 0
		}
		width := int32(uint16(lParam & 0xffff))
		height := int32(uint16((lParam >> 16) & 0xffff))
		ui.layout(width, height)
		return 0
	case wmCommand:
		id := int(wParam & 0xffff)
		switch id {
		case idTrayShow:
			ui.restoreWindow()
		case idTrayExit:
			ui.exitPanel()
		case idStart:
			ui.controller.Start(false)
		case idStop:
			ui.controller.ConfirmStop()
		case idRestart:
			ui.controller.ConfirmRestart()
		case idOpenWeb:
			ui.controller.OpenWeb()
		case idOpenLogs:
			ui.controller.OpenLogs()
		case idOpenFolder:
			ui.controller.OpenServerFolder()
		case idSettings:
			ui.controller.OpenSettings()
		case idCheckUpdates:
			ui.controller.CheckForUpdates()
		case idDbDoctor:
			ui.controller.RunDatabaseDoctor()
		case idRepair:
			ui.controller.RepairInstallation()
		case idThemeToggle:
			ui.toggleTheme()
		case idPerformanceToggle:
			ui.togglePerformanceView()
		case idCopyLogs:
			ui.copyVisibleLogs()
		case idAutoScroll:
			ui.toggleAutoScroll()
		case idFilterInfo:
			ui.showInfo = !ui.showInfo
			ui.refreshLogFilter()
		case idFilterWarning:
			ui.showWarning = !ui.showWarning
			ui.refreshLogFilter()
		case idFilterError:
			ui.showError = !ui.showError
			ui.refreshLogFilter()
		case idFilterSuccess:
			ui.showSuccess = !ui.showSuccess
			ui.refreshLogFilter()
		case idClearLogs:
			ui.pendingMu.Lock()
			ui.logHistory = nil
			ui.pendingMu.Unlock()
			setWindowText(ui.logEdit, "")
		case idRunCommand:
			command := getWindowText(ui.commandEdit)
			setWindowText(ui.commandEdit, "")
			ui.controller.RunCommand(command)
		}
		return 0
	case wmAppLog:
		ui.flushPendingLogs()
		return 0
	case wmAppState:
		ui.updateStateControls()
		ui.updateMetrics()
		return 0
	case wmTimer:
		// SCM inspection and listener enumeration do not need the 1 Hz uptime
		// repaint cadence. Explicit service commands refresh immediately.
		if ui.lastServiceRefreshAt.IsZero() || time.Since(ui.lastServiceRefreshAt) >= 5*time.Second {
			ui.lastServiceRefreshAt = time.Now()
			ui.controller.refreshServiceState()
		}
		ui.controller.pollServiceReadiness()
		if ui.lastAuthorizedRestartCheckAt.IsZero() || time.Since(ui.lastAuthorizedRestartCheckAt) >= 2*time.Second {
			ui.lastAuthorizedRestartCheckAt = time.Now()
			go ui.controller.pollAuthorizedRestart()
		}
		ui.updateMetrics()
		return 0
	case wmAppTray:
		switch uint32(lParam) {
		case wmLButtonDblclk:
			ui.restoreWindow()
		case wmRButtonUp:
			ui.showTrayMenu()
		}
		return 0
	case wmAppUpdate:
		ui.updateMu.Lock()
		message := ui.updateMessage
		ui.updateMessage = ""
		ui.updateMu.Unlock()
		if message != "" {
			messageBox(hwnd, "Cluster Server Updates", message, 0)
		}
		return 0
	case wmAppAutostart:
		ui.controller.Start(ui.controller.options.repair)
		return 0
	case wmAppExit:
		procDestroyWindow.Call(hwnd)
		return 0
	case wmClose:
		if loadNativePanelPreferences(ui.controller.options.root).CloseToTray && ui.trayRegistered {
			procShowWindow.Call(hwnd, swHide)
		} else {
			ui.exitPanel()
		}
		return 0
	case wmDestroy:
		ui.unregisterTrayIcon()
		procKillTimer.Call(hwnd, 1)
		if activeSettingsWindow != nil && activeSettingsWindow.hwnd != 0 {
			procDestroyWindow.Call(activeSettingsWindow.hwnd)
		}
		if ui.titleFont != 0 && ui.titleFont != ui.defaultFont {
			procDeleteObject.Call(ui.titleFont)
		}
		if ui.monoFont != 0 && ui.monoFont != ui.defaultFont {
			procDeleteObject.Call(ui.monoFont)
		}
		if ui.darkBrush != 0 {
			procDeleteObject.Call(ui.darkBrush)
		}
		if ui.darkFieldBrush != 0 {
			procDeleteObject.Call(ui.darkFieldBrush)
		}
		procPostQuitMessage.Call(0)
		return 0
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
	return result
}

// Window preferences belong to the operator UI, never to the server lifecycle.
func (ui *windowsControlPanel) applyWindowPreferences(prefs nativePanelPreferences) {
	if ui == nil || ui.hwnd == 0 {
		return
	}
	target := uintptr(0)
	if prefs.AlwaysOnTop {
		target = ^uintptr(0)
	} else {
		target = ^uintptr(1)
	} // HWND_TOPMOST / HWND_NOTOPMOST
	procSetWindowPos.Call(ui.hwnd, target, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
}
func (ui *windowsControlPanel) trayData() winNotifyIcon {
	data := winNotifyIcon{hwnd: ui.hwnd, id: 1, flags: nifMessage | nifIcon | nifTip, callbackMessage: wmAppTray, icon: ui.windowIcon}
	if data.icon == 0 {
		data.icon, _, _ = procLoadIconW.Call(0, 32512)
	}
	copy(data.tip[:], syscall.StringToUTF16("Cluster Server Control Panel"))
	data.cbSize = uint32(unsafe.Sizeof(data))
	return data
}
func (ui *windowsControlPanel) registerTrayIcon() bool {
	if ui == nil || ui.hwnd == 0 {
		return false
	}
	if ui.trayRegistered {
		return true
	}
	data := ui.trayData()
	ok, _, _ := procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&data)))
	ui.trayRegistered = ok != 0
	return ui.trayRegistered
}
func (ui *windowsControlPanel) unregisterTrayIcon() {
	if !ui.trayRegistered {
		return
	}
	data := ui.trayData()
	procShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&data)))
	ui.trayRegistered = false
}
func (ui *windowsControlPanel) restoreWindow() {
	procShowWindow.Call(ui.hwnd, swRestore)
	procSetForegroundWindow.Call(ui.hwnd)
}
func (ui *windowsControlPanel) showTrayMenu() {
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	defer procDestroyMenu.Call(menu)
	appendItem := func(id uintptr, title string) {
		procAppendMenuW.Call(menu, mfString, id, uintptr(unsafe.Pointer(utf16(title))))
	}
	appendItem(idTrayShow, "Show Cluster Server")
	procAppendMenuW.Call(menu, mfSeparator, 0, 0)
	appendItem(idStart, "Start Server")
	appendItem(idStop, "Stop Server...")
	appendItem(idRestart, "Restart Server...")
	procAppendMenuW.Call(menu, mfSeparator, 0, 0)
	appendItem(idTrayExit, "Exit Control Panel...")
	var pt winPoint
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWindow.Call(ui.hwnd)
	procTrackPopupMenu.Call(menu, tpmRightButton, uintptr(pt.x), uintptr(pt.y), 0, ui.hwnd, 0)
}

// Exit is different from Stop. In service mode Exit never shuts down Cluster.
func (ui *windowsControlPanel) exitPanel() {
	if ui.closing {
		return
	}
	ui.controller.mu.Lock()
	managed := ui.controller.serviceManaged
	ui.controller.mu.Unlock()
	if managed {
		if messageBox(ui.hwnd, "Exit Cluster Control Panel", "Exit the control panel? The independent Windows Service will keep running.", mbYesNo|mbIconQuestion) != idYes {
			return
		}
		procDestroyWindow.Call(ui.hwnd)
		return
	}
	state, _ := ui.controller.snapshot()
	if state == panelStarting || state == panelRunning || state == panelStopping {
		if messageBox(ui.hwnd, "Cluster Server", "The server is still owned by this control panel. Stop it and exit?", mbYesNo|mbIconQuestion) != idYes {
			return
		}
		ui.closing = true
		go func() {
			ui.controller.StopAndWait(managedHostStopGrace)
			procPostMessageW.Call(ui.hwnd, wmAppExit, 0, 0)
		}()
		return
	}
	procDestroyWindow.Call(ui.hwnd)
}

// refreshServiceState never changes the local controller while it owns a host.
// Installed services are authoritative even if a separate UI was launched.
func (c *windowsServerController) refreshServiceState() {
	info, err := queryClusterService()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cmd != nil {
		return
	}
	changed := false
	if err != nil {
		if c.serviceManaged {
			c.lastError = err.Error()
			changed = true
		}
	} else if info.Installed {
		next := panelStopped
		activity := "Windows Service stopped"
		switch info.State {
		case serviceRunning:
			next = panelRunning
			activity = "Windows Service running"
		case serviceStartPending:
			next = panelStarting
			activity = "Windows Service starting"
		case serviceStopPending:
			next = panelStopping
			activity = "Windows Service stopping"
		}
		previousPID := c.servicePID
		if !c.serviceManaged || c.state != next || previousPID != int(info.PID) {
			changed = true
		}
		c.serviceManaged = true
		c.state = next
		c.activity = activity
		c.servicePID = int(info.PID)
		if next != panelRunning || previousPID != c.servicePID {
			// A service restart invalidates the old process's readiness evidence.
			// Force the next scheduled probe to inspect the new PID.
			c.serviceProbeSummary = ""
			c.serviceProbeAt = time.Time{}
		}
	} else if c.serviceManaged {
		c.serviceManaged = false
		c.servicePID = 0
		c.serviceProbeSummary = ""
		c.state = panelStopped
		c.activity = "Windows Service removed"
		changed = true
	}
	if changed {
		c.ui.postState()
	}
}

// SCM_RUNNING only proves service control state. A cheap, scheduled local probe
// checks actual application readiness without blocking the Win32 message loop.
// It reads a fixed configured local listener, never arbitrary user-supplied URLs.
func (c *windowsServerController) pollServiceReadiness() {
	c.mu.Lock()
	if !c.serviceManaged || c.state != panelRunning || c.cmd != nil || c.serviceProbePending || time.Since(c.serviceProbeAt) < 10*time.Second {
		c.mu.Unlock()
		return
	}
	c.serviceProbePending = true
	c.serviceProbeAt = time.Now()
	pid := c.servicePID
	root := c.options.root
	c.mu.Unlock()
	go func() {
		summary := "Application readiness unavailable"
		plan, err := configuredNativeNetwork(root)
		if err != nil {
			summary = "Readiness unknown: invalid network configuration"
		} else {
			summary = probeNativeReadiness(plan, strings.TrimSpace(os.Getenv("CLUSTER_HOST_TLS_CERT")) != "")
		}
		c.mu.Lock()
		if c.serviceManaged && c.servicePID == pid && c.state == panelRunning {
			c.serviceProbeSummary = summary
		}
		c.serviceProbePending = false
		c.mu.Unlock()
		if c.ui != nil {
			c.ui.postState()
		}
	}()
}

func (c *windowsServerController) serviceReadinessSummary() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.serviceProbeSummary
}

func (c *windowsServerController) ConfirmStop() {
	state, _ := c.snapshot()
	if state != panelRunning && state != panelStarting {
		return
	}
	if messageBox(c.ui.hwnd, "Stop Cluster Server", "Stop the server? Active requests and jobs will be drained before shutdown.", mbYesNo|mbIconQuestion) == idYes {
		c.RequestStop()
	}
}
// The Win32 control panel is the independent process lifetime owner in
// interactive mode. A web request only submits an authenticated local intent.
func (c *windowsServerController) pollAuthorizedRestart() {
	c.mu.Lock()
	managed := c.serviceManaged
	state := c.state
	activeRestart := c.authorizedRestartID != ""
	c.mu.Unlock()
	// The installed Windows Service consumes its own requests. The panel must
	// never steal them and trigger a competing SCM stop/restart transaction.
	if managed || activeRestart || state == panelStarting || state == panelStopping { return }
	// No need to query SCM every two seconds while there is no request.
	if _, err := os.Lstat(nativeRestartRequestPath(c.options.root)); err != nil { return }
	if service, err := queryClusterService(); err == nil && service.Installed { return }
	id, err := consumeAuthorizedRestart(c.options.root, time.Now().UTC())
	if err != nil {
		fmt.Fprintf(os.Stderr, "Native restart request ignored: %v\n", err)
		return
	}
	if id == "" { return }
	c.mu.Lock()
	c.authorizedRestartID = id
	c.mu.Unlock()
	fmt.Printf("[%s] Authorized Server Configuration restart %s; draining and restarting owned Cluster processes.\n", time.Now().Format("15:04:05"), id)
	c.Restart()
}

func (c *windowsServerController) ConfirmRestart() {
	state, _ := c.snapshot()
	if state == panelRunning || state == panelStarting {
		if messageBox(c.ui.hwnd, "Restart Cluster Server", "Restart the server? Active work may be temporarily interrupted.", mbYesNo|mbIconQuestion) != idYes {
			return
		}
	}
	c.Restart()
}

func (c *windowsServerController) Start(forceRepair bool) {
	c.mu.Lock()
	busy := c.repairInFlight
	c.mu.Unlock()
	if busy {
		fmt.Fprintln(os.Stderr, "Start refused: self-repair is still in progress.")
		return
	}
	c.refreshServiceState()
	c.mu.Lock()
	managed := c.serviceManaged
	c.mu.Unlock()
	if managed {
		if forceRepair {
			fmt.Fprintln(os.Stderr, "Service mode: stop service and run the maintenance/repair procedure from an authorized console.")
			return
		}
		go func() {
			if err := startClusterService(); err != nil {
				fmt.Fprintf(os.Stderr, "Service start failed: %v\n", err)
			}
			c.refreshServiceState()
		}()
		return
	}
	c.mu.Lock()
	if c.state == panelStarting || c.state == panelRunning || c.state == panelStopping {
		c.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.state = panelStarting
	c.lastError = ""
	c.stopRequested = false
	c.webURL = ""
	c.activity = "Preparing server"
	c.startupCancel = cancel
	c.startupTimedOut = false
	if c.readinessTimer != nil {
		c.readinessTimer.Stop()
		c.readinessTimer = nil
	}
	c.mu.Unlock()
	c.ui.postState()
	go c.startWorker(ctx, forceRepair)
}

func (c *windowsServerController) startWorker(ctx context.Context, forceRepair bool) {
	options := c.options
	fmt.Printf("[%s] Starting Cluster Server...\n", time.Now().Format("15:04:05"))
	if forceRepair && fileExists(filepath.Join(options.root, ".cluster-installer-managed.json")) {
		c.failStart(fmt.Errorf("managed release repair must use Cluster-Installer.exe; source recompilation is prohibited"))
		return
	}
	c.setActivity("Preparing private runtime")
	node, npm, cleanupRuntime, err := preparePlatformRuntime(options.root)
	if err != nil {
		c.failStart(err)
		return
	}
	if cleanupRuntime != nil {
		defer cleanupRuntime()
	}
	if c.shouldAbortStart() {
		c.transition(panelStopped, "")
		return
	}
	c.setActivity("Preparing PostgreSQL and server environment")
	env, err := ensureServerEnvironment(options.root)
	if err != nil {
		c.failStart(err)
		return
	}
	if c.shouldAbortStart() {
		cleanupRuntimes()
		c.transition(panelStopped, "")
		return
	}
	c.setActivity("Preparing application dependencies")
	if err := prepareApplicationContext(ctx, options.root, node, npm, env, forceRepair); err != nil {
		cleanupRuntimes()
		if ctx.Err() != nil {
			fmt.Printf("[%s] Cluster Server startup cancelled.\n", time.Now().Format("15:04:05"))
			c.transition(panelStopped, "")
			return
		}
		c.failStart(err)
		return
	}
	if c.shouldAbortStart() {
		cleanupRuntimes()
		c.transition(panelStopped, "")
		return
	}
	if err := os.MkdirAll(filepath.Dir(c.controlFile), 0o755); err != nil {
		cleanupRuntimes()
		c.failStart(err)
		return
	}
	if err := os.WriteFile(c.controlFile, []byte("run\n"), 0o600); err != nil {
		cleanupRuntimes()
		c.failStart(err)
		return
	}
	c.setActivity("Starting Cluster Host")
	cmd, err := managedHostCommand(options, node, env, c.controlFile)
	if err != nil {
		cleanupRuntimes()
		c.failStart(err)
		return
	}
	job, err := processjob.New()
	if err != nil {
		cleanupRuntimes()
		c.failStart(fmt.Errorf("could not allocate Host process job: %w", err))
		return
	}
	if err := cmd.Start(); err != nil {
		_ = job.Close()
		cleanupRuntimes()
		c.failStart(fmt.Errorf("could not start native Cluster host: %w", err))
		return
	}
	if err := job.Assign(cmd); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		_ = job.Close()
		cleanupRuntimes()
		c.failStart(fmt.Errorf("Host process cannot be safely supervised: %w", err))
		return
	}
	done := make(chan struct{})
	c.mu.Lock()
	c.cmd = cmd
	c.hostJob = job
	c.done = done
	c.startupCancel = nil
	c.mu.Unlock()
	c.armReadinessWatchdog(cmd)
	c.setActivity("Waiting for API and web readiness")
	fmt.Printf("[%s] Cluster Host started (PID %d); waiting for readiness.\n", time.Now().Format("15:04:05"), cmd.Process.Pid)

	waitErr := cmd.Wait()
	// Exit of the Host executable does NOT prove its descendants exited.
	// Closing its job kills any remaining Node descendants before cleanup.
	_ = job.Close()
	close(done)
	_ = os.Remove(c.controlFile)
	cleanupRuntimes()

	c.mu.Lock()
	requested := c.stopRequested
	timedOut := c.startupTimedOut
	c.cmd = nil
	c.hostJob = nil
	c.done = nil
	if c.readinessTimer != nil {
		c.readinessTimer.Stop()
		c.readinessTimer = nil
	}
	c.mu.Unlock()
	if timedOut {
		c.failActiveAuthorizedRestart()
		recordLauncherEmergency(options.root, nativealerts.HostReadinessTimeout)
		c.transition(panelError, "Cluster Host did not become ready within 75 seconds. Check windows-server.log and run Repair & Start.")
		return
	}
	if requested {
		fmt.Printf("[%s] Cluster Server stopped.\n", time.Now().Format("15:04:05"))
		c.transition(panelStopped, "")
		return
	}
	if waitErr != nil {
		c.failActiveAuthorizedRestart()
		recordLauncherEmergency(options.root, nativealerts.HostUnexpectedExit)
		c.transition(panelError, fmt.Sprintf("Cluster Host stopped unexpectedly: %v", waitErr))
		fmt.Fprintf(os.Stderr, "Cluster Host stopped unexpectedly: %v\n", waitErr)
		return
	}
	c.transition(panelStopped, "")
}

func (c *windowsServerController) armReadinessWatchdog(cmd *exec.Cmd) {
	c.mu.Lock()
	if c.readinessTimer != nil {
		c.readinessTimer.Stop()
	}
	c.readinessTimer = time.AfterFunc(75*time.Second, func() {
		c.mu.Lock()
		if c.state != panelStarting || c.cmd != cmd {
			c.mu.Unlock()
			return
		}
		c.startupTimedOut = true
		c.activity = "Readiness timed out; stopping host"
		controlFile := c.controlFile
		process := cmd.Process
		done := c.done
		c.mu.Unlock()
		c.ui.postState()
		fmt.Fprintln(os.Stderr, "Cluster Host readiness timed out after 75 seconds; stopping the managed host.")
		_ = os.WriteFile(controlFile, []byte("stop\n"), 0o600)
		if process == nil || done == nil {
			return
		}
		go func() {
			select {
			case <-done:
				return
			case <-time.After(8 * time.Second):
				c.mu.Lock()
				job := c.hostJob
				c.mu.Unlock()
				if job != nil {
					_ = job.Close()
				}
			}
		}()
	})
	c.mu.Unlock()
}

func (c *windowsServerController) failActiveAuthorizedRestart() {
	c.mu.Lock()
	id := c.authorizedRestartID
	c.authorizedRestartID = ""
	c.mu.Unlock()
	if id != "" {
		if err := writeNativeRestartReceipt(c.options.root, id, "failed"); err != nil {
			fmt.Fprintf(os.Stderr, "Cannot publish restart failure: %v\n", err)
		}
	}
}

func (c *windowsServerController) failStart(err error) {
	c.mu.Lock()
	stage := strings.TrimSpace(c.activity)
	c.mu.Unlock()
	c.failActiveAuthorizedRestart()
	if stage == "" {
		stage = "Startup"
	}
	cleanupRuntimes()
	message := fmt.Sprintf("%s failed: %v", stage, err)
	fmt.Fprintf(os.Stderr, "Cluster Server could not start: %s\n", message)
	logs := filepath.Join(c.options.root, "data", "system", "logs")
	if mkErr := os.MkdirAll(logs, 0o755); mkErr == nil {
		failurePath := filepath.Join(logs, "last-startup-failure.log")
		_ = os.WriteFile(failurePath, []byte(fmt.Sprintf("%s Cluster Server %s\n%s\n", time.Now().Format(time.RFC3339), displayReleaseVersion(c.options.root), message)), 0o600)
		fmt.Fprintf(os.Stderr, "Startup failure summary: %s\n", failurePath)
	}
	recordLauncherEmergency(c.options.root, nativealerts.LauncherStartupFailed)
	c.transition(panelError, message)
}

func (c *windowsServerController) shouldAbortStart() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.stopRequested
}

func (c *windowsServerController) RequestStop() {
	c.refreshServiceState()
	c.mu.Lock()
	managed := c.serviceManaged
	c.mu.Unlock()
	if managed {
		go func() {
			if err := stopClusterService(); err != nil {
				fmt.Fprintf(os.Stderr, "Service stop failed: %v\n", err)
			}
			c.refreshServiceState()
		}()
		return
	}
	c.mu.Lock()
	state := c.state
	if state == panelStopped || state == panelError {
		c.mu.Unlock()
		return
	}
	c.stopRequested = true
	cancel := c.startupCancel
	c.startupCancel = nil
	cmd := c.cmd
	done := c.done
	controlFile := c.controlFile
	c.state = panelStopping
	if cmd == nil {
		c.activity = "Cancelling startup"
	}
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	c.ui.postState()
	fmt.Printf("[%s] Stop requested.\n", time.Now().Format("15:04:05"))
	if cmd == nil {
		return
	}
	_ = os.WriteFile(controlFile, []byte("stop\n"), 0o600)
	go func(process *os.Process, completion chan struct{}) {
		if completion == nil {
			return
		}
		select {
		case <-completion:
			return
		case <-time.After(managedHostStopGrace):
			fmt.Fprintln(os.Stderr, "Graceful shutdown timed out; terminating the Cluster Host process tree.")
			c.mu.Lock()
			job := c.hostJob
			c.mu.Unlock()
			if job != nil {
				_ = job.Close()
			}
		}
	}(cmd.Process, done)
}

func (c *windowsServerController) StopAndWait(timeout time.Duration) {
	c.mu.Lock()
	managed := c.serviceManaged
	c.mu.Unlock()
	if managed {
		if err := stopClusterService(); err != nil {
			fmt.Fprintf(os.Stderr, "Service stop failed: %v\n", err)
			return
		}
		if err := waitClusterService(serviceStopped, timeout); err != nil {
			fmt.Fprintf(os.Stderr, "Service stop wait failed: %v\n", err)
		}
		c.refreshServiceState()
		return
	}
	c.RequestStop()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		state, _ := c.snapshot()
		if state == panelStopped || state == panelError {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	c.mu.Lock()
	cmd := c.cmd
	c.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		c.mu.Lock()
		job := c.hostJob
		c.mu.Unlock()
		if job != nil {
			_ = job.Close()
		}
	}
	cleanupRuntimes()
}

func (c *windowsServerController) Restart() {
	c.refreshServiceState()
	c.mu.Lock()
	managed := c.serviceManaged
	c.mu.Unlock()
	if managed {
		go func() {
			info, err := queryClusterService()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Service query failed: %v\n", err)
				return
			}
			if info.State != serviceStopped {
				if err = stopClusterService(); err != nil {
					fmt.Fprintf(os.Stderr, "Service restart stop failed: %v\n", err)
					return
				}
				if err = waitClusterService(serviceStopped, managedHostStopGrace+15*time.Second); err != nil {
					fmt.Fprintf(os.Stderr, "Service restart aborted: %v\n", err)
					return
				}
			}
			if err = startClusterService(); err != nil {
				fmt.Fprintf(os.Stderr, "Service restart start failed: %v\n", err)
			}
			c.refreshServiceState()
		}()
		return
	}
	state, _ := c.snapshot()
	if state == panelStarting || state == panelStopping {
		return
	}
	go func() {
		if state == panelRunning {
			c.StopAndWait(managedHostStopGrace)
		}
		c.Start(false)
	}()
}

func (c *windowsServerController) RunCommand(value string) {
	command := strings.TrimSpace(value)
	if command == "" {
		return
	}
	fmt.Printf("\n> %s\n", command)
	switch strings.ToLower(command) {
	case "start":
		c.Start(false)
		return
	case "stop":
		c.ConfirmStop()
		return
	case "restart":
		c.ConfirmRestart()
		return
	case "clear", "cls":
		procPostMessageW.Call(c.ui.hwnd, wmAppLog, 0, 0)
		setWindowText(c.ui.logEdit, "")
		return
	case "open", "web":
		c.OpenWeb()
		return
	case "logs":
		c.OpenLogs()
		return
	case "repair":
		c.RepairInstallation()
		return
	case "stage-update", "download-update":
		c.StageServerUpdate()
		return
	case "inspect-update":
		prefs := loadNativePanelPreferences(c.options.root)
		channel := prefs.UpdateChannel
		if channel != "development" { channel = "main" }
		candidate, err := inspectStagedServerUpdate(c.options.root, channel)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Signed Server update is not ready to apply: %v\n", err)
		} else {
			fmt.Printf("Publisher-signed staged Server release %s (%s, sequence %d) passed second-pass SHA-256 and ownership checks. Installer has NOT been executed.\n",candidate.Release,candidate.Channel,candidate.Sequence)
		}
		return
	case "status":
		state, lastError := c.snapshot()
		fmt.Printf("Status: %s\n", panelStateLabel(state))
		if lastError != "" {
			fmt.Printf("Last error: %s\n", lastError)
		}
		return
	}
	go func() {
		cmd := exec.Command("cmd.exe", "/d", "/s", "/c", command)
		configureChildProcess(cmd)
		cmd.Dir = c.options.root
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "Command failed: %v\n", err)
		}
	}()
}

func (c *windowsServerController) OpenWeb() {
	c.mu.Lock()
	target := c.webURL
	c.mu.Unlock()
	if target == "" {
		target = "http://127.0.0.1:3000"
	}
	_ = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", target).Start()
}

func (c *windowsServerController) OpenLogs() {
	path := filepath.Join(c.options.root, "data", "system", "logs")
	_ = os.MkdirAll(path, 0o755)
	_ = exec.Command("explorer.exe", path).Start()
}

func (c *windowsServerController) OpenServerFolder() {
	_ = exec.Command("explorer.exe", c.options.root).Start()
}

func (c *windowsServerController) runtimeDetails() (serverPanelState, string, int, time.Time, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	pid := 0
	if c.cmd != nil && c.cmd.Process != nil {
		pid = c.cmd.Process.Pid
	} else if c.serviceManaged {
		pid = c.servicePID
	}
	return c.state, c.lastError, pid, c.startedAt, c.activity
}

func (ui *windowsControlPanel) updateMetrics() {
	state, _, pid, startedAt, _ := ui.controller.runtimeDetails()
	uptime := "--"
	if state == panelRunning && !startedAt.IsZero() {
		d := time.Since(startedAt).Round(time.Second)
		days := int(d / (24 * time.Hour))
		hours := int((d % (24 * time.Hour)) / time.Hour)
		minutes := int((d % time.Hour) / time.Minute)
		seconds := int(d % time.Minute / time.Second)
		if days > 0 {
			uptime = fmt.Sprintf("%dd %02d:%02d:%02d", days, hours, minutes, seconds)
		} else {
			uptime = fmt.Sprintf("%02d:%02d:%02d", hours, minutes, seconds)
		}
	}
	pidText := "--"
	if pid > 0 {
		pidText = fmt.Sprint(pid)
	}
	setWindowText(ui.metrics, fmt.Sprintf("Uptime %s   |   PID %s", uptime, pidText))
	if !ui.performanceVisible {
		return
	}
	if ui.lastResourceAt.IsZero() || time.Since(ui.lastResourceAt) >= 5*time.Second {
		ui.lastResourceSnapshot = ui.resourceSampler.sample(ui.controller.options.root, pid)
		ui.lastResourceAt = time.Now()
	}
	snapshot := ui.lastResourceSnapshot
	serverRAM := "--"
	if snapshot.ServerMemoryBytes > 0 {
		serverRAM = formatBytesCompact(snapshot.ServerMemoryBytes)
	}
	disk := "--"
	if snapshot.DiskTotalBytes > 0 {
		disk = formatBytesCompact(snapshot.DiskFreeBytes) + " free / " + formatBytesCompact(snapshot.DiskTotalBytes)
	}
	// GetExtendedTcpTable allocates and enumerates both IP address families.
	// Cache the read across UI ticks so a visible performance panel cannot
	// repeatedly query OS listeners and reread network configuration at 1 Hz.
	if ui.lastPortsAt.IsZero() || time.Since(ui.lastPortsAt) >= 5*time.Second || ui.lastPortsPID != pid {
		ui.lastPortsAt = time.Now()
		ui.lastPortsPID = pid
		ui.lastPortsSummary = "Ports: unavailable"
		if owners, err := nativeListenerOwners(); err == nil {
			plan, configErr := configuredNativeNetwork(ui.controller.options.root)
			if configErr == nil {
				describe := func(label string, port int) string {
					for _, listener := range owners {
						if listener.Port == port {
							return fmt.Sprintf("%s :%d PID %d", label, port, listener.PID)
						}
					}
					return fmt.Sprintf("%s :%d not listening", label, port)
				}
				ui.lastPortsSummary = describe("Web", plan.WebPort) + " | " + describe("API", plan.PublicAPIPort) + " | " + describe("PG", plan.PrivatePostgresPort)
			}
		}
	}
	ui.gpuSampler.poll()
	cpu := int(snapshot.CPUPercent + 0.5)
	if cpu < 0 { cpu = 0 } else if cpu > 100 { cpu = 100 }
	ram := int(snapshot.MemoryPercent)
	if ram > 100 { ram = 100 }
	diskPercent := 0
	if snapshot.DiskTotalBytes > 0 && snapshot.DiskFreeBytes <= snapshot.DiskTotalBytes {
		diskPercent = int((float64(snapshot.DiskTotalBytes - snapshot.DiskFreeBytes) / float64(snapshot.DiskTotalBytes)) * 100 + 0.5)
		if diskPercent < 0 { diskPercent = 0 } else if diskPercent > 100 { diskPercent = 100 }
	}
	setWindowText(ui.perfCPU, fmt.Sprintf("CPU  %d%%", cpu))
	setWindowText(ui.perfRAM, fmt.Sprintf("System memory  %d%%", ram))
	setWindowText(ui.perfDisk, fmt.Sprintf("Disk  %s", disk))
	setWindowText(ui.perfService, "Cluster process memory  "+serverRAM)
	setWindowText(ui.perfPorts, ui.lastPortsSummary)
	setWindowText(ui.performance, ui.gpuSampler.snapshot())
	procSendMessageW.Call(ui.perfCPUBar, pbmSetPos, uintptr(cpu), 0)
	procSendMessageW.Call(ui.perfRAMBar, pbmSetPos, uintptr(ram), 0)
	procSendMessageW.Call(ui.perfDiskBar, pbmSetPos, uintptr(diskPercent), 0)
}

// StageServerUpdate downloads a signed, hash-verified Server installer only.
// No update can be executed or applied by this action.
func (c *windowsServerController) StageServerUpdate() {
	c.mu.Lock()
	if c.updateInFlight { c.mu.Unlock(); return }
	c.updateInFlight = true
	c.mu.Unlock()
	c.ui.postState()
	go func() {
		defer func() { c.mu.Lock(); c.updateInFlight = false; c.mu.Unlock(); c.ui.postState() }()
		prefs := loadNativePanelPreferences(c.options.root)
		channel := prefs.UpdateChannel
		if channel != "development" { channel = "main" }
		feed := configuredUpdateManifestURL(c.options.root)
		if feed == "" { fmt.Fprintln(os.Stderr, "No signed Server update feed configured for "+channel); return }
		fmt.Printf("[%s] Verifying and staging %s Server update (no installation)...\n", time.Now().Format("15:04:05"), channel)
		staged, err := stageServerUpdate(c.options.root, feed, channel)
		if err != nil { fmt.Fprintf(os.Stderr, "Server update staging rejected: %v\n", err); return }
		candidate,err:=inspectStagedServerUpdate(c.options.root,channel)
		if err!=nil {
			fmt.Fprintf(os.Stderr,"Installer staged but independent verification failed: %v. Installation is blocked.\n",err)
			return
		}
		fmt.Printf("Verified signed Server %s installer staged at %s (sequence %d). It remains inert until native update authorization and verified backup/recovery are available.\n",candidate.Release,staged,candidate.Sequence)
	}()
}

func (c *windowsServerController) CheckForUpdates() {
	c.mu.Lock()
	if c.updateInFlight {
		c.mu.Unlock()
		return
	}
	c.updateInFlight = true
	c.mu.Unlock()
	c.ui.postState()
	fmt.Printf("[%s] Checking for Cluster updates...\n", time.Now().Format("15:04:05"))
	go func() {
		defer func() {
			c.mu.Lock()
			c.updateInFlight = false
			c.mu.Unlock()
			c.ui.postState()
		}()
		result := checkUpdateManifest(c.options.root)
		fmt.Printf("[%s] %s\n", time.Now().Format("15:04:05"), result.Message)
		c.ui.updateMu.Lock()
		c.ui.updateMessage = result.Message
		if result.Available && result.DownloadURL != "" {
			c.ui.updateMessage += "\r\n\r\nDownload: " + result.DownloadURL
		}
		c.ui.updateMu.Unlock()
		procPostMessageW.Call(c.ui.hwnd, wmAppUpdate, 0, 0)
	}()
}

// RepairInstallation never restarts or reinstalls a managed server. It repairs
// trusted local components only after explicit confirmation and a stopped-Host
// preflight. Missing release binaries still require a verified in-place installer.
func (c *windowsServerController) RepairInstallation() {
	root := c.options.root
	if !fileExists(filepath.Join(root, ".cluster-installer-managed.json")) {
		c.Start(true) // Developer-source repair remains a separate operation.
		return
	}
	c.refreshServiceState()
	c.mu.Lock()
	state := c.state
	busy := c.repairInFlight || c.doctorInFlight || c.updateInFlight
	c.mu.Unlock()
	if busy || (state != panelStopped && state != panelError) {
		fmt.Fprintln(os.Stderr, "Self-repair requires a stopped Server with no other maintenance task active.")
		return
	}
	if messageBox(c.ui.hwnd, "Repair Cluster Server", "Repair verified local runtime files and missing workspace links? Cluster will not delete databases, Library files, settings, or run application builds. The server must remain stopped.", mbYesNo|mbIconQuestion) != idYes {
		return
	}
	c.mu.Lock()
	if c.repairInFlight || (c.state != panelStopped && c.state != panelError) {
		c.mu.Unlock()
		return
	}
	c.repairInFlight = true
	c.activity = "Offline self-repair in progress"
	c.mu.Unlock()
	c.ui.postState()
	go func() {
		defer func() {
			c.mu.Lock()
			c.repairInFlight = false
			c.activity = ""
			c.mu.Unlock()
			c.refreshServiceState()
			c.ui.postState()
		}()
		fmt.Println("Offline managed repair: preserving PostgreSQL data, Library and configuration.")
		report, err := repairManagedInstallation(root)
		for _, action := range report.Actions {
			fmt.Printf("[Repair %s] %s: %s\n", strings.ToUpper(action.Status), action.Name, action.Detail)
		}
		if err != nil || !report.Ready {
			fmt.Fprintln(os.Stderr, "Self-repair incomplete. Do not remove data. Reapply a verified installer to the SAME managed installation to restore missing application files.")
			return
		}
		fmt.Println("Self-repair completed. Start Cluster manually to verify API and database readiness.")
	}()
}

func (c *windowsServerController) RunDatabaseDoctor() {
	c.mu.Lock()
	if c.state == panelStarting || c.state == panelStopping {
		c.mu.Unlock()
		messageBox(c.ui.hwnd, "Database Doctor", "Database diagnostics cannot run during startup or shutdown.", mbIconError)
		return
	}
	offline := c.state != panelRunning
	if c.doctorInFlight {
		c.mu.Unlock()
		return
	}
	c.doctorInFlight = true
	c.mu.Unlock()
	c.ui.postState()
	fmt.Printf("\n[%s] Running Cluster database doctor...\n", time.Now().Format("15:04:05"))
	go func() {
		defer func() {
			c.mu.Lock()
			c.doctorInFlight = false
			c.mu.Unlock()
			c.ui.postState()
		}()
		if offline {
			fmt.Println("Read-only offline diagnostic: no PostgreSQL process, migrations, downloads or file repairs will run.")
			report := collectNativeOfflineDiagnostics(c.options.root)
			for _, check := range report.Checks {
				fmt.Printf("[%s] %s: %s\n", strings.ToUpper(check.Status), check.Name, check.Detail)
			}
			if !report.Healthy {
				fmt.Fprintln(os.Stderr, "Offline diagnostics detected blocked startup prerequisites. Preserve data before attempting repair.")
			} else {
				fmt.Println("Offline file checks complete; live PostgreSQL consistency and restore verification still required.")
			}
			return
		}
		node, _, cleanup, err := preparePlatformRuntime(c.options.root)
		if cleanup != nil {
			defer cleanup()
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "Database doctor could not prepare Node.js: %v\n", err)
			return
		}
		env := readEnvFile(filepath.Join(c.options.root, "apps", "server", ".env"))
		if err := runManagedDatabaseCommandContext(context.Background(), c.options.root, node, env, "doctor"); err != nil {
			fmt.Fprintf(os.Stderr, "Database doctor failed: %v\n", err)
			return
		}
		fmt.Printf("[%s] Database doctor completed.\n", time.Now().Format("15:04:05"))
	}()
}

func (c *windowsServerController) OpenSettings() {
	if activeSettingsWindow != nil && activeSettingsWindow.hwnd != 0 {
		procShowWindow.Call(activeSettingsWindow.hwnd, swShow)
		procSetForegroundWindow.Call(activeSettingsWindow.hwnd)
		return
	}
	if err := openWindowsServerSettings(c); err != nil {
		messageBox(c.ui.hwnd, "Server Settings", err.Error(), mbIconError)
	}
}

func openWindowsServerSettings(controller *windowsServerController) error {
	instance, _, _ := procGetModuleHandleW.Call(0)
	cursor, _, _ := procLoadCursorW.Call(0, 32512)
	className := utf16("ClusterServerNativeSettings")
	wc := wndClassEx{cbSize: uint32(unsafe.Sizeof(wndClassEx{})), wndProc: syscall.NewCallback(windowsSettingsWndProc), instance: instance, cursor: cursor, background: colorBtnFace + 1, className: className, icon: controller.ui.windowIcon, iconSmall: controller.ui.windowIcon}
	if atom, _, err := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		if errno, ok := err.(syscall.Errno); !ok || errno != 1410 {
			return fmt.Errorf("could not register native settings window: %v", err)
		}
	}
	window := &windowsSettingsWindow{controller: controller, sections: nativeSettingSections(), darkMode: controller.ui.darkMode}
	activeSettingsWindow = window
	hwnd, _, err := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(utf16("Cluster Windows Server Settings"))), wsOverlappedWin|wsClipChildren, 155, 115, 960, 640, controller.ui.hwnd, 0, instance, 0)
	if hwnd == 0 {
		activeSettingsWindow = nil
		return fmt.Errorf("could not create settings window: %v", err)
	}
	window.hwnd = hwnd
	if controller.ui.windowIcon != 0 {
		procSendMessageW.Call(hwnd, wmSetIcon, iconBig, controller.ui.windowIcon)
		procSendMessageW.Call(hwnd, wmSetIcon, iconSmall, controller.ui.windowIcon)
	}
	if err := window.createControls(instance); err != nil {
		procDestroyWindow.Call(hwnd)
		activeSettingsWindow = nil
		return err
	}
	window.applyTheme(window.darkMode)
	procShowWindow.Call(hwnd, swShow)
	procUpdateWindow.Call(hwnd)
	return nil
}

func (w *windowsSettingsWindow) createControls(instance uintptr) error {
	stock, _, _ := procGetStockObject.Call(defaultGUIFont)
	w.defaultFont = stock
	w.titleFont = createWindowsFont(-21, 600, "Segoe UI")
	if w.titleFont == 0 {
		w.titleFont = stock
	}
	var err error
	if w.title, err = createControl("STATIC", "Cluster Server Settings", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, w.hwnd, 0, instance); err != nil {
		return err
	}
	if w.searchLabel, err = createControl("STATIC", "SEARCH ACROSS SERVER SETTINGS", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, w.hwnd, 0, instance); err != nil {
		return err
	}
	if w.searchEdit, err = createControl("EDIT", "", wsChild|wsVisible|wsTabStop|wsBorder|esAutoHScroll, 0, 0, 0, 0, w.hwnd, idSettingSearch, instance); err != nil {
		return err
	}
	procSendMessageW.Call(w.searchEdit, emSetCueBanner, 1, uintptr(unsafe.Pointer(utf16("Search name, category or setting key..."))))
	if w.sectionLabel, err = createControl("STATIC", "CATEGORIES", wsChild|wsVisible, 0, 0, 0, 0, w.hwnd, 0, instance); err != nil {
		return err
	}
	if w.sectionCombo, err = createControl("LISTBOX", "", wsChild|wsVisible|wsTabStop|wsBorder|wsVScroll|lbsNotify, 0, 0, 0, 0, w.hwnd, idSettingSection, instance); err != nil {
		return err
	}
	if w.settingLabel, err = createControl("STATIC", "SETTINGS", wsChild|wsVisible, 0, 0, 0, 0, w.hwnd, 0, instance); err != nil {
		return err
	}
	if w.settingCombo, err = createControl("LISTBOX", "", wsChild|wsVisible|wsTabStop|wsBorder|wsVScroll|lbsNotify, 0, 0, 0, 0, w.hwnd, idSettingName, instance); err != nil {
		return err
	}
	if w.valueLabel, err = createControl("STATIC", "Selected setting", wsChild|wsVisible, 0, 0, 0, 0, w.hwnd, 0, instance); err != nil {
		return err
	}
	if w.valueEdit, err = createControl("EDIT", "", wsChild|wsVisible|wsTabStop|wsBorder|esAutoHScroll, 0, 0, 0, 0, w.hwnd, 0, instance); err != nil {
		return err
	}
	if w.secretEdit, err = createControl("EDIT", "", wsChild|wsTabStop|wsBorder|esAutoHScroll|esPassword, 0, 0, 0, 0, w.hwnd, 0, instance); err != nil {
		return err
	}
	if w.currentLabel, err = createControl("STATIC", "", wsChild|wsVisible, 0, 0, 0, 0, w.hwnd, 0, instance); err != nil {
		return err
	}
	if w.helpLabel, err = createControl("STATIC", "", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, w.hwnd, 0, instance); err != nil {
		return err
	}
	if w.restartLabel, err = createControl("STATIC", "", wsChild|wsVisible|ssLeft, 0, 0, 0, 0, w.hwnd, 0, instance); err != nil {
		return err
	}
	if w.save, err = createControl("BUTTON", "Save", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, w.hwnd, idSettingSave, instance); err != nil {
		return err
	}
	if w.saveRestart, err = createControl("BUTTON", "Save + Restart", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, w.hwnd, idSettingSaveRestart, instance); err != nil {
		return err
	}
	if w.clear, err = createControl("BUTTON", "Reset / Clear", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, w.hwnd, idSettingClear, instance); err != nil {
		return err
	}
	if w.openConfig, err = createControl("BUTTON", "Open Config File", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, w.hwnd, idSettingOpenFile, instance); err != nil {
		return err
	}
	if w.close, err = createControl("BUTTON", "Close", wsChild|wsVisible|wsTabStop|bsPushButton, 0, 0, 0, 0, w.hwnd, idSettingClose, instance); err != nil {
		return err
	}
	for _, h := range []uintptr{w.searchLabel, w.searchEdit, w.sectionLabel, w.sectionCombo, w.settingLabel, w.settingCombo, w.valueLabel, w.valueEdit, w.secretEdit, w.currentLabel, w.helpLabel, w.restartLabel, w.save, w.saveRestart, w.clear, w.openConfig, w.close} {
		procSendMessageW.Call(h, wmSetFont, w.defaultFont, 1)
	}
	procSendMessageW.Call(w.title, wmSetFont, w.titleFont, 1)
	for _, section := range w.sections {
		listAddString(w.sectionCombo, section)
	}
	procSendMessageW.Call(w.sectionCombo, lbSetCurSel, 0, 0)
	w.populateSettings(0)
	w.layout(780, 500)
	return nil
}

func (w *windowsSettingsWindow) layout(width, height int32) {
	if width < 760 {
		width = 760
	}
	if height < 520 {
		height = 520
	}
	const margin int32 = 18
	railWidth := int32(224)
	right := margin + railWidth + 20
	rightWidth := width - right - margin

	// Navigation is always visible. No nested dropdown hunt for an update URL.
	moveWindow(w.title, margin, 14, width-margin*2, 32)
	moveWindow(w.sectionLabel, margin, 65, railWidth, 20)
	moveWindow(w.sectionCombo, margin, 90, railWidth, height-160)
	moveWindow(w.searchLabel, right, 63, rightWidth, 20)
	moveWindow(w.searchEdit, right, 87, rightWidth, 32)
	shrink := int32(0)
	if height < 640 {
		shrink = (640 - height) / 2
	}
	selectedLabelY := int32(325) - shrink
	helpY := int32(426) - shrink
	restartY := height - 104
	helpHeight := restartY - helpY - 12
	if helpHeight < 24 {
		helpHeight = 24
	}
	moveWindow(w.settingLabel, right, 128, rightWidth, 20)
	moveWindow(w.settingCombo, right, 150, rightWidth, 160-shrink)
	moveWindow(w.valueLabel, right, selectedLabelY, rightWidth, 20)
	moveWindow(w.valueEdit, right, selectedLabelY+25, rightWidth, 32)
	moveWindow(w.secretEdit, right, selectedLabelY+25, rightWidth, 32)
	moveWindow(w.currentLabel, right, selectedLabelY+68, rightWidth, 22)
	moveWindow(w.helpLabel, right, helpY, rightWidth, helpHeight)
	moveWindow(w.restartLabel, right, restartY, rightWidth, 24)
	y := height - 58
	moveWindow(w.save, right, y, 78, 32)
	moveWindow(w.saveRestart, right+86, y, 124, 32)
	moveWindow(w.clear, right+218, y, 108, 32)
	if rightWidth >= 610 {
		procShowWindow.Call(w.openConfig, swShow)
		moveWindow(w.openConfig, right+334, y, 126, 32)
	} else {
		// Keep the native close button and protected Save actions reachable
		// on narrower remote desktop windows.
		procShowWindow.Call(w.openConfig, swHide)
	}
	moveWindow(w.close, width-margin-80, y, 80, 32)
}

func (w *windowsSettingsWindow) applyTheme(enabled bool) {
	w.darkMode = enabled
	if w.darkBrush != 0 {
		procDeleteObject.Call(w.darkBrush)
		w.darkBrush = 0
	}
	if w.darkFieldBrush != 0 {
		procDeleteObject.Call(w.darkFieldBrush)
		w.darkFieldBrush = 0
	}
	if enabled {
		brush, _, _ := procCreateSolidBrush.Call(uintptr(rgbColor(31, 36, 43)))
		field, _, _ := procCreateSolidBrush.Call(uintptr(rgbColor(24, 28, 34)))
		w.darkBrush, w.darkFieldBrush = brush, field
	}
	applyImmersiveDarkMode(w.hwnd, enabled)
	for _, h := range []uintptr{w.save, w.saveRestart, w.clear, w.openConfig, w.close} {
		if h != 0 {
			procSetWindowTheme.Call(h, uintptr(unsafe.Pointer(utf16(""))), 0)
		}
	}
	for _, h := range []uintptr{w.sectionCombo, w.settingCombo, w.searchEdit, w.valueEdit, w.secretEdit} {
		if h != 0 {
			applyImmersiveDarkMode(h, enabled)
		}
	}
	for _, h := range []uintptr{w.title, w.searchLabel, w.searchEdit, w.sectionLabel, w.sectionCombo, w.settingLabel, w.settingCombo, w.valueLabel, w.valueEdit, w.secretEdit, w.currentLabel, w.helpLabel, w.restartLabel, w.save, w.saveRestart, w.clear, w.openConfig, w.close} {
		if h != 0 {
			procInvalidateRect.Call(h, 0, 1)
		}
	}
	procInvalidateRect.Call(w.hwnd, 0, 1)
}

func (w *windowsSettingsWindow) populateSettings(sectionIndex int) {
	if sectionIndex < 0 || sectionIndex >= len(w.sections) {
		sectionIndex = 0
	}
	query := strings.ToLower(strings.TrimSpace(getWindowText(w.searchEdit)))
	w.currentSpecs = nil
	if query == "" {
		w.currentSpecs = nativeSettingsForSection(w.sections[sectionIndex])
	} else {
		for _, section := range w.sections {
			for _, spec := range nativeSettingsForSection(section) {
				haystack := strings.ToLower(section + " " + spec.Label + " " + spec.Key + " " + spec.Help)
				if strings.Contains(haystack, query) {
					w.currentSpecs = append(w.currentSpecs, spec)
				}
			}
		}
	}
	procSendMessageW.Call(w.settingCombo, lbResetContent, 0, 0)
	for _, spec := range w.currentSpecs {
		label := spec.Label
		if query != "" {
			label = spec.Section + "  /  " + spec.Label
		}
		listAddString(w.settingCombo, label)
	}
	if len(w.currentSpecs) > 0 {
		procSendMessageW.Call(w.settingCombo, lbSetCurSel, 0, 0)
		w.loadSetting(0)
		return
	}
	// Never leave a hidden, previously selected setting writable when there
	// are zero matches. This also avoids accidentally saving the wrong key.
	w.currentSpec = nativeSettingSpec{}
	setWindowText(w.valueLabel, "No matching settings")
	setWindowText(w.currentLabel, "Adjust your search or choose another category.")
	setWindowText(w.valueEdit, "")
	setWindowText(w.secretEdit, "")
	setWindowText(w.helpLabel, "")
	setWindowText(w.restartLabel, "")
	enableWindow(w.save, false)
	enableWindow(w.saveRestart, false)
	enableWindow(w.clear, false)
}

func (w *windowsSettingsWindow) loadSetting(index int) {
	if index < 0 || index >= len(w.currentSpecs) {
		return
	}
	spec := w.currentSpecs[index]
	w.currentSpec = spec
	setWindowText(w.valueLabel, spec.Label)
	enableWindow(w.save, true)
	enableWindow(w.saveRestart, true)
	enableWindow(w.clear, true)
	value, configured, err := settingDisplayValue(w.controller.options.root, spec)
	if err != nil {
		setWindowText(w.currentLabel, "Read error: "+err.Error())
		value = ""
	}
	if spec.Sensitive {
		procShowWindow.Call(w.valueEdit, swHide)
		procShowWindow.Call(w.secretEdit, swShow)
		setWindowText(w.secretEdit, "")
		if configured {
			setWindowText(w.currentLabel, "Current: a protected value is pending in local config. Blank keeps it.")
		} else {
			setWindowText(w.currentLabel, "Current: protected values are not exposed here. Blank keeps the server-stored value.")
		}
	} else {
		procShowWindow.Call(w.secretEdit, swHide)
		procShowWindow.Call(w.valueEdit, swShow)
		setWindowText(w.valueEdit, value)
		setWindowText(w.currentLabel, "Current: "+value)
	}
	help := spec.Help
	if len(spec.Options) > 0 {
		help += "\r\nAllowed values: " + strings.Join(spec.Options, ", ")
	}
	setWindowText(w.helpLabel, help)
	if spec.Restart {
		setWindowText(w.restartLabel, "Restart required for this setting.")
	} else {
		setWindowText(w.restartLabel, "Saved locally. Restart is recommended so every process sees the same value.")
	}
}

func (w *windowsSettingsWindow) saveCurrent(restart bool) {
	spec := w.currentSpec
	if spec.Key == "" {
		return
	}
	value := getWindowText(w.valueEdit)
	if spec.Sensitive {
		value = getWindowText(w.secretEdit)
	}
	if err := saveNativeSetting(w.controller.options.root, spec, value, false); err != nil {
		messageBox(w.hwnd, "Server Settings", err.Error(), mbIconError)
		return
	}
	fmt.Printf("[%s] Native settings saved: %s\n", time.Now().Format("15:04:05"), spec.Label)
	if spec.Sensitive {
		setWindowText(w.secretEdit, "")
	}
	idx, _, _ := procSendMessageW.Call(w.settingCombo, lbGetCurSel, 0, 0)
	w.loadSetting(int(idx))
	if restart && !strings.HasPrefix(spec.Key, "native.update") {
		w.controller.Restart()
	}
}

func (w *windowsSettingsWindow) clearCurrent() {
	spec := w.currentSpec
	if spec.Key == "" {
		return
	}
	if messageBox(w.hwnd, "Server Settings", "Reset this setting? Protected credentials will be cleared if this is a secret field.", mbYesNo|mbIconQuestion) != idYes {
		return
	}
	if err := saveNativeSetting(w.controller.options.root, spec, "", true); err != nil {
		messageBox(w.hwnd, "Server Settings", err.Error(), mbIconError)
		return
	}
	idx, _, _ := procSendMessageW.Call(w.settingCombo, lbGetCurSel, 0, 0)
	w.loadSetting(int(idx))
}

func windowsSettingsWndProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	w := activeSettingsWindow
	if w == nil {
		result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
		return result
	}
	switch msg {
	case wmEraseBkgnd:
		if w.darkMode && w.darkBrush != 0 {
			var rect winRect
			procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rect)))
			procFillRect.Call(wParam, uintptr(unsafe.Pointer(&rect)), w.darkBrush)
			return 1
		}
	case wmCtlColorStatic:
		if w.darkMode {
			procSetBkMode.Call(wParam, transparent)
			if lParam == w.currentLabel || lParam == w.helpLabel || lParam == w.restartLabel || lParam == w.sectionLabel || lParam == w.settingLabel || lParam == w.valueLabel {
				procSetTextColor.Call(wParam, uintptr(rgbColor(166, 176, 190)))
			} else {
				procSetTextColor.Call(wParam, uintptr(rgbColor(236, 240, 246)))
			}
			return w.darkBrush
		}
	case wmCtlColorListbox:
		if w.darkMode {
			procSetTextColor.Call(wParam, uintptr(rgbColor(232, 237, 244)))
			procSetBkColor.Call(wParam, uintptr(rgbColor(24, 28, 34)))
			return w.darkFieldBrush
		}
	case wmCtlColorEdit:
		if w.darkMode {
			procSetTextColor.Call(wParam, uintptr(rgbColor(232, 237, 244)))
			procSetBkColor.Call(wParam, uintptr(rgbColor(24, 28, 34)))
			return w.darkFieldBrush
		}
	case wmCtlColorBtn:
		if w.darkMode {
			procSetTextColor.Call(wParam, uintptr(rgbColor(232, 237, 244)))
			procSetBkColor.Call(wParam, uintptr(rgbColor(31, 36, 43)))
			return w.darkBrush
		}
	case wmDrawItem:
		if drawOwnerButton(lParam, w.darkMode) {
			return 1
		}
	case wmSize:
		w.layout(int32(uint16(lParam&0xffff)), int32(uint16((lParam>>16)&0xffff)))
		return 0
	case wmCommand:
		id := int(wParam & 0xffff)
		notify := int((wParam >> 16) & 0xffff)
		if id == idSettingSearch && notify == enChange {
			idx, _, _ := procSendMessageW.Call(w.sectionCombo, lbGetCurSel, 0, 0)
			w.populateSettings(int(idx))
			return 0
		}
		if id == idSettingSection && notify == lbnSelChange {
			idx, _, _ := procSendMessageW.Call(w.sectionCombo, lbGetCurSel, 0, 0)
			// Switching to a category leaves global-search mode explicitly.
			if strings.TrimSpace(getWindowText(w.searchEdit)) != "" {
				setWindowText(w.searchEdit, "")
			}
			w.populateSettings(int(idx))
			return 0
		}
		if id == idSettingName && notify == lbnSelChange {
			idx, _, _ := procSendMessageW.Call(w.settingCombo, lbGetCurSel, 0, 0)
			w.loadSetting(int(idx))
			return 0
		}
		switch id {
		case idSettingSave:
			w.saveCurrent(false)
		case idSettingSaveRestart:
			w.saveCurrent(true)
		case idSettingClear:
			w.clearCurrent()
		case idSettingOpenFile:
			path := serverConfigPath(w.controller.options.root)
			_ = os.MkdirAll(filepath.Dir(path), 0o700)
			if !fileExists(path) {
				_ = saveServerConfig(w.controller.options.root, clusterConfigDisk{Version: 2, SecretPolicy: "server-managed-only", Settings: map[string]any{}})
			}
			_ = exec.Command("notepad.exe", path).Start()
		case idSettingClose:
			procDestroyWindow.Call(hwnd)
		}
		return 0
	case wmClose:
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		if w.darkBrush != 0 {
			procDeleteObject.Call(w.darkBrush)
			w.darkBrush = 0
		}
		if w.darkFieldBrush != 0 {
			procDeleteObject.Call(w.darkFieldBrush)
			w.darkFieldBrush = 0
		}
		if w.titleFont != 0 && w.titleFont != w.defaultFont {
			procDeleteObject.Call(w.titleFont)
		}
		activeSettingsWindow = nil
		return 0
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
	return result
}

func listAddString(hwnd uintptr, value string) {
	procSendMessageW.Call(hwnd, lbAddString, 0, uintptr(unsafe.Pointer(utf16(value))))
}

func comboAddString(hwnd uintptr, value string) {
	procSendMessageW.Call(hwnd, cbAddString, 0, uintptr(unsafe.Pointer(utf16(value))))
}

func (c *windowsServerController) observeLog(line string) {
	trimmed := strings.TrimSpace(line)
	ready := false
	candidate := ""
	if strings.HasPrefix(trimmed, "Web:") {
		candidate = strings.TrimSpace(strings.TrimPrefix(trimmed, "Web:"))
	} else if strings.HasPrefix(trimmed, "Ready:") {
		candidate = strings.TrimSpace(strings.TrimPrefix(trimmed, "Ready:"))
		ready = true
	}
	if candidate != "" && (strings.HasPrefix(candidate, "http://") || strings.HasPrefix(candidate, "https://")) {
		c.mu.Lock()
		c.webURL = strings.Fields(candidate)[0]
		c.mu.Unlock()
		c.ui.postState()
	}
	if ready {
		state, _ := c.snapshot()
		if state == panelStarting {
			// Interactive mode must settle the same immutable staged network
			// transaction as the Windows Service. Previously only the SCM path
			// called verifyNativeNetworkDeployment, leaving interactive installs
			// permanently blocked by NETWORK_DEPLOYMENT_PENDING even after a
			// successful restart. Never mark a mismatched config verified.
			if err := verifyNativeNetworkDeployment(c.options.root); err != nil {
				fmt.Fprintf(os.Stderr, "Native network startup verification refused: %v\n", err)
				recordLauncherEmergency(c.options.root, nativealerts.NetworkRollbackBlocked)
				c.failActiveAuthorizedRestart()
				c.RequestStop()
				return
			}
			c.mu.Lock()
			restartID := c.authorizedRestartID
			c.authorizedRestartID = ""
			c.mu.Unlock()
			if restartID != "" {
				if err := writeNativeRestartReceipt(c.options.root, restartID, "ready"); err != nil {
					fmt.Fprintf(os.Stderr, "Cannot publish interactive restart readiness: %v\n", err)
				}
			}
			fmt.Printf("[%s] Cluster Server is ready.\n", time.Now().Format("15:04:05"))
			c.transition(panelRunning, "")
		}
	}
}

func (c *windowsServerController) transition(state serverPanelState, lastError string) {
	c.mu.Lock()
	c.state = state
	c.lastError = lastError
	if state == panelRunning && c.startedAt.IsZero() {
		c.startedAt = time.Now()
		c.activity = "Serving requests"
		c.startupTimedOut = false
	}
	if state == panelRunning || state == panelStopped || state == panelError {
		if c.readinessTimer != nil {
			c.readinessTimer.Stop()
			c.readinessTimer = nil
		}
	}
	if state == panelStopped || state == panelError {
		c.startedAt = time.Time{}
		c.activity = ""
	}
	c.mu.Unlock()
	c.ui.postState()
}

func (c *windowsServerController) setActivity(activity string) {
	c.mu.Lock()
	c.activity = activity
	c.mu.Unlock()
	c.ui.postState()
}

func (c *windowsServerController) snapshot() (serverPanelState, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state, c.lastError
}

func (ui *windowsControlPanel) postLog(line string) {
	const maxLiveLineBytes = 16 * 1024
	if len(line) > maxLiveLineBytes {
		line = line[:maxLiveLineBytes] + " … [line trimmed in live view; full output is in windows-server.log]"
	}
	ui.pendingMu.Lock()
	ui.pendingLogs = append(ui.pendingLogs, line)
	if len(ui.pendingLogs) > 4000 {
		dropped := len(ui.pendingLogs) - 4000
		ui.pendingLogs = append([]string{fmt.Sprintf("[Live view skipped %d older lines; complete output remains in windows-server.log.]", dropped)}, ui.pendingLogs[dropped:]...)
	}
	shouldNotify := !ui.logNotifyPending
	if shouldNotify {
		ui.logNotifyPending = true
	}
	ui.pendingMu.Unlock()
	if shouldNotify && ui.hwnd != 0 {
		procPostMessageW.Call(ui.hwnd, wmAppLog, 0, 0)
	}
}

func (ui *windowsControlPanel) postState() {
	if ui.hwnd != 0 {
		procPostMessageW.Call(ui.hwnd, wmAppState, 0, 0)
	}
}

func (ui *windowsControlPanel) flushPendingLogs() {
	// RichEdit mutation is synchronous on the Win32 UI thread. Bootstrap tools can
	// emit thousands of lines in a burst, so render a bounded chunk and retain the
	// complete session in windows-server.log.
	const maxLinesPerFlush = 80
	const maxBytesPerFlush = 24 * 1024
	ui.pendingMu.Lock()
	count, bytes := 0, 0
	for count < len(ui.pendingLogs) && count < maxLinesPerFlush {
		next := len(ui.pendingLogs[count]) + 2
		if count > 0 && bytes+next > maxBytesPerFlush {
			break
		}
		bytes += next
		count++
	}
	if count == 0 && len(ui.pendingLogs) > 0 {
		count = 1
	}
	lines := append([]string{}, ui.pendingLogs[:count]...)
	ui.pendingLogs = ui.pendingLogs[count:]
	more := len(ui.pendingLogs) > 0
	ui.logNotifyPending = more
	if len(lines) > 0 {
		ui.logHistory = append(ui.logHistory, lines...)
		if len(ui.logHistory) > 4000 {
			ui.logHistory = append([]string{}, ui.logHistory[len(ui.logHistory)-4000:]...)
		}
	}
	ui.pendingMu.Unlock()
	if len(lines) == 0 {
		return
	}
	length, _, _ := procGetWindowTextLength.Call(ui.logEdit)
	if length > 500000 {
		ui.renderLogHistory()
	} else {
		for _, line := range lines {
			if ui.logLineVisible(line) {
				ui.appendLogLine(line)
			}
		}
	}
	if more && ui.hwnd != 0 {
		time.AfterFunc(35*time.Millisecond, func() {
			if ui.hwnd != 0 {
				procPostMessageW.Call(ui.hwnd, wmAppLog, 0, 0)
			}
		})
	}
}

type serverLogSeverity int

const (
	logInfo serverLogSeverity = iota
	logWarning
	logError
	logSuccess
)

func classifyLogSeverity(line string) serverLogSeverity {
	lower := strings.ToLower(line)
	switch {
	case strings.Contains(lower, "error"), strings.Contains(lower, "failed"), strings.Contains(lower, "could not"), strings.Contains(lower, "denied"), strings.Contains(lower, "timed out"), strings.Contains(lower, "fatal"):
		return logError
	case strings.Contains(lower, "warn"), strings.Contains(lower, "retry"), strings.Contains(lower, "waiting"), strings.Contains(lower, "stopping"), strings.Contains(lower, "interrupted"):
		return logWarning
	case strings.Contains(lower, "ready"), strings.Contains(lower, "completed"), strings.Contains(lower, "started"), strings.Contains(lower, "online"), strings.Contains(lower, "success"):
		return logSuccess
	default:
		return logInfo
	}
}

func (ui *windowsControlPanel) logLineVisible(line string) bool {
	switch classifyLogSeverity(line) {
	case logWarning:
		return ui.showWarning
	case logError:
		return ui.showError
	case logSuccess:
		return ui.showSuccess
	default:
		return ui.showInfo
	}
}

func (ui *windowsControlPanel) appendLogLine(line string) {
	var scroll winPoint
	if !ui.autoScroll {
		procSendMessageW.Call(ui.logEdit, emGetScrollPos, 0, uintptr(unsafe.Pointer(&scroll)))
	}
	procSendMessageW.Call(ui.logEdit, emSetSel, ^uintptr(0), ^uintptr(0))
	format := charFormat2{cbSize: uint32(unsafe.Sizeof(charFormat2{})), dwMask: cfmColor, crTextColor: logSeverityColor(line, ui.darkMode)}
	procSendMessageW.Call(ui.logEdit, emSetCharFormat, scfSelection, uintptr(unsafe.Pointer(&format)))
	procSendMessageW.Call(ui.logEdit, emReplaceSel, 0, uintptr(unsafe.Pointer(utf16("● "+line+"\r\n"))))
	if ui.autoScroll {
		procSendMessageW.Call(ui.logEdit, wmVScroll, sbBottom, 0)
	} else {
		procSendMessageW.Call(ui.logEdit, emSetScrollPos, 0, uintptr(unsafe.Pointer(&scroll)))
	}
}

func (ui *windowsControlPanel) renderLogHistory() {
	ui.pendingMu.Lock()
	history := append([]string{}, ui.logHistory...)
	ui.pendingMu.Unlock()
	setWindowText(ui.logEdit, "")
	for _, line := range history {
		if ui.logLineVisible(line) {
			ui.appendLogLine(line)
		}
	}
}

func (ui *windowsControlPanel) refreshLogFilter() {
	ui.updateLogControlLabels()
	ui.renderLogHistory()
}

func (ui *windowsControlPanel) updateLogControlLabels() {
	toggleLabel := func(enabled bool, label string) string {
		if enabled {
			return "✓ " + label
		}
		return label
	}
	setWindowText(ui.filterInfo, toggleLabel(ui.showInfo, "Info"))
	setWindowText(ui.filterWarning, toggleLabel(ui.showWarning, "Warning"))
	setWindowText(ui.filterError, toggleLabel(ui.showError, "Error"))
	setWindowText(ui.filterSuccess, toggleLabel(ui.showSuccess, "Success"))
	setWindowText(ui.autoScrollButton, toggleLabel(ui.autoScroll, "Auto-scroll"))
	if ui.darkMode {
		setWindowText(ui.themeToggle, "Light mode")
	} else {
		setWindowText(ui.themeToggle, "Dark mode")
	}
	if ui.performanceVisible {
		setWindowText(ui.performanceToggle, "Hide stats")
	} else {
		setWindowText(ui.performanceToggle, "Performance")
	}
}

func (ui *windowsControlPanel) copyVisibleLogs() {
	text := getWindowText(ui.logEdit)
	if strings.TrimSpace(text) == "" {
		return
	}
	if err := setUnicodeClipboardText(ui.hwnd, text); err != nil {
		messageBox(ui.hwnd, "Copy logs", "Could not copy the visible logs to the clipboard: "+err.Error(), mbIconError)
	}
}

func (ui *windowsControlPanel) toggleAutoScroll() {
	ui.autoScroll = !ui.autoScroll
	prefs := loadNativePanelPreferences(ui.controller.options.root)
	value := ui.autoScroll
	prefs.AutoScrollLogs = &value
	_ = saveNativePanelPreferences(ui.controller.options.root, prefs)
	ui.updateLogControlLabels()
	if ui.autoScroll {
		procSendMessageW.Call(ui.logEdit, wmVScroll, sbBottom, 0)
	}
}

func (ui *windowsControlPanel) togglePerformanceView() {
	ui.performanceVisible = !ui.performanceVisible
	prefs := loadNativePanelPreferences(ui.controller.options.root)
	visible := ui.performanceVisible
	prefs.PerformanceView = &visible
	_ = saveNativePanelPreferences(ui.controller.options.root, prefs)
	ui.updateLogControlLabels()
	var rect winRect
	procGetClientRect.Call(ui.hwnd, uintptr(unsafe.Pointer(&rect)))
	ui.layout(rect.right-rect.left, rect.bottom-rect.top)
	ui.updateMetrics()
}

func (ui *windowsControlPanel) toggleTheme() {
	ui.darkMode = !ui.darkMode
	prefs := loadNativePanelPreferences(ui.controller.options.root)
	prefs.DarkMode = ui.darkMode
	_ = saveNativePanelPreferences(ui.controller.options.root, prefs)
	ui.applyTheme(ui.darkMode)
	if activeSettingsWindow != nil {
		activeSettingsWindow.applyTheme(ui.darkMode)
	}
}

func (c *windowsServerController) toolActivity() (updateInFlight, doctorInFlight, repairInFlight bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.updateInFlight, c.doctorInFlight, c.repairInFlight
}

func (ui *windowsControlPanel) updateStateControls() {
	state, lastError, _, _, activity := ui.controller.runtimeDetails()
	updateInFlight, doctorInFlight, repairInFlight := ui.controller.toolActivity()
	label := panelStateLabel(state)
	setWindowText(ui.status, label)
	statusDetail := "Ready"
	if ui.controller.serviceManaged && state == panelRunning {
		statusDetail = "Windows Service running · checking application readiness"
		if summary := ui.controller.serviceReadinessSummary(); summary != "" {
			statusDetail = "Windows Service running · " + summary
		}
	} else if state == panelError && lastError != "" {
		statusDetail = "Startup failed · see Live logs"
	} else if activity != "" {
		statusDetail = activity
	} else if state == panelStopped {
		statusDetail = "Server is stopped"
	}
	setWindowText(ui.activity, statusDetail)
	procInvalidateRect.Call(ui.statusDot, 0, 1)
	enableWindow(ui.start, !repairInFlight && (state == panelStopped || state == panelError))
	enableWindow(ui.stop, !repairInFlight && (state == panelStarting || state == panelRunning))
	enableWindow(ui.restart, !repairInFlight && state == panelRunning)
	enableWindow(ui.openWeb, state == panelRunning)
	enableWindow(ui.dbDoctor, (state == panelRunning || state == panelStopped || state == panelError) && !doctorInFlight && !repairInFlight)
	managedInstallation := fileExists(filepath.Join(ui.controller.options.root, ".cluster-installer-managed.json"))
	if managedInstallation {
		setWindowText(ui.repair, "Repair Installation")
	} else {
		setWindowText(ui.repair, "Repair & Start")
	}
	enableWindow(ui.repair, !repairInFlight && !doctorInFlight && !updateInFlight && (state == panelStopped || state == panelError))
	enableWindow(ui.settings, state != panelStarting && state != panelStopping)
	enableWindow(ui.checkUpdates, !updateInFlight)
}

func rgbColor(r, g, b byte) uint32 {
	// COLORREF is stored as 0x00BBGGRR.
	return uint32(r) | uint32(g)<<8 | uint32(b)<<16
}

func panelStateColor(state serverPanelState) uint32 {
	switch state {
	case panelRunning:
		return rgbColor(38, 184, 96)
	case panelStarting, panelStopping:
		return rgbColor(224, 161, 36)
	case panelError:
		return rgbColor(222, 68, 75)
	default:
		return rgbColor(132, 142, 154)
	}
}

func logSeverityColor(line string, dark bool) uint32 {
	switch classifyLogSeverity(line) {
	case logError:
		if dark {
			return rgbColor(255, 122, 128)
		}
		return rgbColor(188, 38, 46)
	case logWarning:
		if dark {
			return rgbColor(244, 190, 86)
		}
		return rgbColor(164, 105, 0)
	case logSuccess:
		if dark {
			return rgbColor(91, 211, 138)
		}
		return rgbColor(22, 132, 67)
	default:
		if dark {
			return rgbColor(123, 196, 230)
		}
		return rgbColor(37, 111, 151)
	}
}

func loadClusterServerIcon(root string) uintptr {
	for _, path := range []string{
		filepath.Join(root, "cluster-icon.ico"),
		filepath.Join(root, "assets", "cluster-icon.ico"),
		filepath.Join(root, "apps", "desktop-qt", "assets", "cluster-icon.ico"),
	} {
		if !fileExists(path) {
			continue
		}
		handle, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(utf16(path))), imageIcon, 0, 0, lrLoadFromFile)
		if handle != 0 {
			return handle
		}
	}
	return 0
}

func applyImmersiveDarkMode(hwnd uintptr, enabled bool) {
	value := int32(0)
	if enabled {
		value = 1
	}
	// DWMWA_USE_IMMERSIVE_DARK_MODE is 20 on supported Windows 10/11 builds.
	procDwmSetWindowAttribute.Call(hwnd, 20, uintptr(unsafe.Pointer(&value)), unsafe.Sizeof(value))
	theme := utf16("")
	if enabled {
		theme = utf16("DarkMode_Explorer")
	}
	procSetWindowTheme.Call(hwnd, uintptr(unsafe.Pointer(theme)), 0)
}

func (ui *windowsControlPanel) applyTheme(enabled bool) {
	ui.darkMode = enabled
	if ui.darkBrush != 0 {
		procDeleteObject.Call(ui.darkBrush)
		ui.darkBrush = 0
	}
	if ui.darkFieldBrush != 0 {
		procDeleteObject.Call(ui.darkFieldBrush)
		ui.darkFieldBrush = 0
	}
	if enabled {
		brush, _, _ := procCreateSolidBrush.Call(uintptr(rgbColor(31, 36, 43)))
		field, _, _ := procCreateSolidBrush.Call(uintptr(rgbColor(24, 28, 34)))
		ui.darkBrush, ui.darkFieldBrush = brush, field
	}
	applyImmersiveDarkMode(ui.hwnd, enabled)
	buttonHandles := []uintptr{ui.start, ui.stop, ui.restart, ui.openWeb, ui.openLogs, ui.openFolder, ui.settings, ui.checkUpdates, ui.dbDoctor, ui.repair, ui.themeToggle, ui.performanceToggle, ui.clearLogs, ui.copyLogs, ui.autoScrollButton, ui.filterInfo, ui.filterWarning, ui.filterError, ui.filterSuccess, ui.runCommand}
	for _, h := range buttonHandles {
		if h != 0 {
			// Owner-drawn buttons use our palette; disabling the visual theme prevents
			// Windows from painting a white themed face over dark mode.
			procSetWindowTheme.Call(h, uintptr(unsafe.Pointer(utf16(""))), 0)
		}
	}
	for _, h := range []uintptr{ui.commandEdit, ui.logEdit} {
		if h != 0 {
			applyImmersiveDarkMode(h, enabled)
		}
	}
	if ui.logEdit != 0 {
		background := rgbColor(255, 255, 255)
		if enabled {
			background = rgbColor(24, 28, 34)
		}
		procSendMessageW.Call(ui.logEdit, emSetBkgndColor, 0, uintptr(background))
	}
	ui.updateLogControlLabels()
	ui.renderLogHistory()
	for _, h := range []uintptr{ui.title, ui.subtitle, ui.statusDot, ui.status, ui.activity, ui.metrics, ui.performance, ui.performanceTitle, ui.perfCPU, ui.perfRAM, ui.perfDisk, ui.perfService, ui.perfPorts, ui.perfCPUBar, ui.perfRAMBar, ui.perfDiskBar, ui.logLabel, ui.commandLabel, ui.commandEdit, ui.logEdit, ui.start, ui.stop, ui.restart, ui.openWeb, ui.openLogs, ui.openFolder, ui.settings, ui.checkUpdates, ui.dbDoctor, ui.repair, ui.themeToggle, ui.performanceToggle, ui.clearLogs, ui.copyLogs, ui.autoScrollButton, ui.filterInfo, ui.filterWarning, ui.filterError, ui.filterSuccess, ui.runCommand} {
		if h != 0 {
			procInvalidateRect.Call(h, 0, 1)
		}
	}
	procInvalidateRect.Call(ui.hwnd, 0, 1)
}

func drawOwnerButton(lParam uintptr, dark bool) bool {
	if lParam == 0 {
		return false
	}
	dis := (*drawItemStruct)(unsafe.Pointer(lParam))
	if dis.hwndItem == 0 || dis.hdc == 0 {
		return false
	}
	text := getWindowText(dis.hwndItem)
	if text == "" {
		return false
	}
	bg := rgbColor(248, 250, 252)
	border := rgbColor(193, 201, 211)
	fg := rgbColor(34, 42, 52)
	if dark {
		bg = rgbColor(31, 36, 43)
		border = rgbColor(72, 82, 94)
		fg = rgbColor(232, 237, 244)
	}
	if dis.itemState&odsSelected != 0 {
		if dark {
			bg = rgbColor(22, 27, 33)
			border = rgbColor(92, 168, 202)
		} else {
			bg = rgbColor(231, 238, 244)
			border = rgbColor(77, 157, 196)
		}
	}
	if dis.itemState&odsDisabled != 0 {
		if dark {
			bg = rgbColor(28, 32, 38)
			border = rgbColor(54, 62, 72)
			fg = rgbColor(116, 126, 139)
		} else {
			bg = rgbColor(242, 244, 247)
			border = rgbColor(212, 217, 224)
			fg = rgbColor(145, 153, 163)
		}
	}
	bgBrush, _, _ := procCreateSolidBrush.Call(uintptr(bg))
	borderBrush, _, _ := procCreateSolidBrush.Call(uintptr(border))
	if bgBrush == 0 || borderBrush == 0 {
		if bgBrush != 0 {
			procDeleteObject.Call(bgBrush)
		}
		if borderBrush != 0 {
			procDeleteObject.Call(borderBrush)
		}
		return false
	}
	defer procDeleteObject.Call(bgBrush)
	defer procDeleteObject.Call(borderBrush)
	procFillRect.Call(dis.hdc, uintptr(unsafe.Pointer(&dis.rcItem)), bgBrush)
	procFrameRect.Call(dis.hdc, uintptr(unsafe.Pointer(&dis.rcItem)), borderBrush)
	procSetBkMode.Call(dis.hdc, transparent)
	procSetTextColor.Call(dis.hdc, uintptr(fg))
	font, _, _ := procSendMessageW.Call(dis.hwndItem, wmGetFont, 0, 0)
	var oldFont uintptr
	if font != 0 {
		oldFont, _, _ = procSelectObject.Call(dis.hdc, font)
	}
	r := dis.rcItem
	if dis.itemState&odsSelected != 0 {
		r.left++
		r.top++
	}
	ptr := utf16(text)
	procDrawTextW.Call(dis.hdc, uintptr(unsafe.Pointer(ptr)), ^uintptr(0), uintptr(unsafe.Pointer(&r)), dtCenter|dtVCenter|dtSingleLine|dtEndEllipsis)
	if oldFont != 0 {
		procSelectObject.Call(dis.hdc, oldFont)
	}
	if dis.itemState&odsFocus != 0 && dis.itemState&odsDisabled == 0 {
		focus := dis.rcItem
		focus.left += 3
		focus.top += 3
		focus.right -= 3
		focus.bottom -= 3
		procDrawFocusRect.Call(dis.hdc, uintptr(unsafe.Pointer(&focus)))
	}
	return true
}

func setUnicodeClipboardText(owner uintptr, text string) error {
	opened, _, err := procOpenClipboard.Call(owner)
	if opened == 0 {
		return fmt.Errorf("OpenClipboard failed: %v", err)
	}
	defer procCloseClipboard.Call()
	if result, _, clearErr := procEmptyClipboard.Call(); result == 0 {
		return fmt.Errorf("EmptyClipboard failed: %v", clearErr)
	}
	encoded, encodeErr := syscall.UTF16FromString(text)
	if encodeErr != nil {
		return fmt.Errorf("clipboard text contains an embedded NUL")
	}
	bytes := uintptr(len(encoded) * 2)
	hMem, _, allocErr := procGlobalAlloc.Call(gmemMoveable, bytes)
	if hMem == 0 {
		return fmt.Errorf("GlobalAlloc failed: %v", allocErr)
	}
	locked, _, lockErr := procGlobalLock.Call(hMem)
	if locked == 0 {
		procGlobalFree.Call(hMem)
		return fmt.Errorf("GlobalLock failed: %v", lockErr)
	}
	dst := unsafe.Slice((*uint16)(unsafe.Pointer(locked)), len(encoded))
	copy(dst, encoded)
	procGlobalUnlock.Call(hMem)
	if result, _, setErr := procSetClipboardData.Call(cfUnicodeText, hMem); result == 0 {
		procGlobalFree.Call(hMem)
		return fmt.Errorf("SetClipboardData failed: %v", setErr)
	}
	// Clipboard owns hMem after SetClipboardData succeeds.
	return nil
}

func panelStateLabel(state serverPanelState) string {
	switch state {
	case panelStarting:
		return "Starting"
	case panelRunning:
		return "Running"
	case panelStopping:
		return "Stopping"
	case panelError:
		return "Error"
	default:
		return "Stopped"
	}
}

func installWindowsOutputCapture(root string, ui *windowsControlPanel) (func(), error) {
	logs := filepath.Join(root, "data", "system", "logs")
	if err := os.MkdirAll(logs, 0o755); err != nil {
		return nil, err
	}
	logPath := filepath.Join(logs, "windows-server.log")
	logFile, err := openNativeLineLogWriter(logPath, 32*1024*1024, 4)
	if err != nil {
		return nil, err
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		_ = logFile.Close()
		return nil, err
	}
	originalOut, originalErr := os.Stdout, os.Stderr
	os.Stdout, os.Stderr = writer, writer
	_, _ = fmt.Fprintf(logFile, "\n===== Cluster Server %s session %s =====\n", displayReleaseVersion(root), time.Now().Format(time.RFC3339))
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		if err := scanBoundedNativeLines(reader, func(raw string) {
			line := redactNativeLogLine(raw)
			_, _ = fmt.Fprintln(logFile, line)
			ui.controller.observeLog(line)
			ui.postLog(line)
		}); err != nil {
			ui.postLog("Native output capture stopped after an I/O error: " + err.Error())
		}
	}()
	return func() {
		os.Stdout, os.Stderr = originalOut, originalErr
		_ = writer.Close()
		select {
		case <-drained:
		case <-time.After(time.Second):
		}
		_ = reader.Close()
		_ = logFile.Close()
	}, nil
}

func createControl(className, text string, style uint32, x, y, width, height int32, parent uintptr, id int, instance uintptr) (uintptr, error) {
	handle, _, err := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(utf16(className))),
		uintptr(unsafe.Pointer(utf16(text))),
		uintptr(style),
		uintptr(x), uintptr(y), uintptr(width), uintptr(height),
		parent, uintptr(id), instance, 0,
	)
	if handle == 0 {
		return 0, fmt.Errorf("could not create native %s control: %v", className, err)
	}
	return handle, nil
}

func createWindowsFont(height, weight int32, face string) uintptr {
	handle, _, _ := procCreateFontW.Call(
		uintptr(height), 0, 0, 0, uintptr(weight), 0, 0, 0,
		1, 0, 0, 5, 0,
		uintptr(unsafe.Pointer(utf16(face))),
	)
	return handle
}

func moveWindow(hwnd uintptr, x, y, width, height int32) {
	if hwnd == 0 {
		return
	}
	procMoveWindow.Call(hwnd, uintptr(x), uintptr(y), uintptr(width), uintptr(height), 1)
}

func enableWindow(hwnd uintptr, enabled bool) {
	value := uintptr(0)
	if enabled {
		value = 1
	}
	procEnableWindow.Call(hwnd, value)
}

func setWindowText(hwnd uintptr, value string) {
	if hwnd == 0 {
		return
	}
	procSetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(utf16(value))))
}

func getWindowText(hwnd uintptr) string {
	if hwnd == 0 {
		return ""
	}
	length, _, _ := procGetWindowTextLength.Call(hwnd)
	if length == 0 {
		return ""
	}
	buffer := make([]uint16, int(length)+1)
	procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
	return syscall.UTF16ToString(buffer)
}

func utf16(value string) *uint16 {
	pointer, _ := syscall.UTF16PtrFromString(value)
	return pointer
}

func messageBox(hwnd uintptr, title, text string, flags uintptr) uintptr {
	result, _, _ := procMessageBoxW.Call(
		hwnd,
		uintptr(unsafe.Pointer(utf16(text))),
		uintptr(unsafe.Pointer(utf16(title))),
		flags,
	)
	return result
}
