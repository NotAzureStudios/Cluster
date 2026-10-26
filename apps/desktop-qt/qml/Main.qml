import QtQuick
import QtQuick.Controls
import Cluster.Desktop
import "pages"

ApplicationWindow {
    id: window
    width: 1380
    height: 900
    minimumWidth: 980
    minimumHeight: 680
    visible: true
    title: "Cluster"
    color: Theme.background
    property string pendingNativeDeepLink: ""

    function reloadSharedRenderer() {
        if (mainLoader.item && mainLoader.item.reload)
            mainLoader.item.reload()
    }

    function navigateSharedRenderer(route) {
        if (mainLoader.item && mainLoader.item.navigate) {
            mainLoader.item.navigate(route)
        } else if (String(route || "").toLowerCase().startsWith("cluster://")) {
            pendingNativeDeepLink = String(route)
        }
    }

    function goBackSharedRenderer() {
        if (mainLoader.item && mainLoader.item.goBack)
            mainLoader.item.goBack()
    }

    function goForwardSharedRenderer() {
        if (mainLoader.item && mainLoader.item.goForward)
            mainLoader.item.goForward()
    }

    function dispatchSharedRendererCommand(command) {
        if (mainLoader.item && mainLoader.item.dispatchShellCommand)
            mainLoader.item.dispatchShellCommand(command)
    }

    function showAppSettings() {
        appSettingsWindow.show()
        appSettingsWindow.raise()
        appSettingsWindow.requestActivate()
    }

    function showServerProfiles() {
        serverProfilesWindow.showManager()
    }

    Loader {
        id: mainLoader
        anchors.fill: parent
        sourceComponent: clusterApp.state === "server" || clusterApp.state === "connecting"
                       ? serverPage
                       : sharedRendererPage
        onLoaded: {
            if (window.pendingNativeDeepLink.length && mainLoader.item && mainLoader.item.navigate) {
                const link = window.pendingNativeDeepLink
                window.pendingNativeDeepLink = ""
                mainLoader.item.navigate(link)
            }
        }
    }

    Component { id: serverPage; ServerPage { } }
    Component { id: sharedRendererPage; SharedRendererPage { } }

    ServerProfilesWindow { id: serverProfilesWindow }
    AppSettingsWindow { id: appSettingsWindow; serverProfilesWindow: serverProfilesWindow }
    UpdateDialog { id: updateRecoveryDialog }

    Shortcut { sequence: "Ctrl+K"; onActivated: window.dispatchSharedRendererCommand("command-palette") }
    Shortcut { sequence: "Ctrl+Shift+N"; onActivated: window.dispatchSharedRendererCommand("quick-create") }
    Shortcut { sequence: "Ctrl+/"; onActivated: window.dispatchSharedRendererCommand("shortcut-help") }
    Shortcut { sequence: "Alt+Left"; onActivated: window.goBackSharedRenderer() }
    Shortcut { sequence: "Alt+Right"; onActivated: window.goForwardSharedRenderer() }
    Shortcut { sequence: "Ctrl+R"; onActivated: window.reloadSharedRenderer() }
    Shortcut { sequence: "Ctrl+Shift+S"; onActivated: window.showServerProfiles() }
    Shortcut { sequence: "Ctrl+,"; onActivated: window.showAppSettings() }
    Shortcut { sequence: "Ctrl+Shift+P"; onActivated: window.showServerProfiles() }
    Shortcut { sequence: "Ctrl+1"; onActivated: window.navigateSharedRenderer("home") }
    Shortcut { sequence: "Ctrl+2"; onActivated: window.navigateSharedRenderer("my-work") }
    Shortcut { sequence: "Ctrl+3"; onActivated: window.navigateSharedRenderer("projects") }

    Timer {
        interval: 650
        running: clusterApp.updateManager.recoveryRequired
        repeat: false
        onTriggered: updateRecoveryDialog.showUpdate()
    }

    Timer {
        interval: 500
        running: clusterApp.serverProfiles.recoveryRequired
        repeat: false
        onTriggered: window.showServerProfiles()
    }

    Connections {
        target: clusterApp.updateManager
        function onStateChanged() {
            if (clusterApp.updateManager.recoveryRequired && !updateRecoveryDialog.visible)
                updateRecoveryDialog.showUpdate()
        }
    }

    Connections {
        target: clusterApp.serverProfiles
        function onRecoveryRequiredChanged() {
            if (clusterApp.serverProfiles.recoveryRequired)
                window.showServerProfiles()
        }
    }

    Connections {
        target: clusterApp
        function onActivateWindowRequested() {
            window.show()
            window.raise()
            window.requestActivate()
        }
        function onDeepLinkRouteRequested(route) {
            window.navigateSharedRenderer(route)
        }
    }
}
