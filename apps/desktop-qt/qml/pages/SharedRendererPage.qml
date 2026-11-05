import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtWebView
import Cluster.Desktop

Item {
    id: root
    anchors.fill: parent

    property string lastSafeUrl: ""
    property bool rendererReady: false
    // Retain a single pending protocol link during page reload/reconnection.
    property string pendingClusterLink: ""
    onRendererReadyChanged: {
        if (!rendererReady || !pendingClusterLink.length) return
        const link = pendingClusterLink
        pendingClusterLink = ""
        navigate(link)
    }
    property bool signOutInProgress: false
    property string pendingSignOutProfileId: ""
    property int signOutPollCount: 0
    property bool capabilityPumpBusy: false
    property int nativeCapabilityPollInterval: 100
    property int emptyCapabilityPollCount: 0
    property int lastDropCount: 0
    property bool dropReceiptVisible: false
    readonly property string normalizedServerUrl: {
        const raw = String(clusterApp.serverUrl || "").trim()
        return raw.endsWith("/") ? raw.slice(0, -1) : raw
    }
    property string launchRoute: ""
    property string launchInspector: ""
    readonly property string rendererUrl: normalizedServerUrl.length
        ? normalizedServerUrl + "/?clusterDesktop=1"
            + (launchInspector.length ? "&inspect=" + encodeURIComponent(launchInspector) : "")
            + (launchRoute.length ? "#" + encodeURIComponent(launchRoute) : "")
        : "about:blank"

    Component.onCompleted: {
        launchRoute = String(clusterApp.serverProfiles.activeLastRoute || "").replace(/^#/, "")
        launchInspector = String(clusterApp.serverProfiles.activeLastInspector || "")
    }

    function reload() { webView.reload() }
    function goBack() { if (webView.canGoBack) webView.goBack() }
    function goForward() { if (webView.canGoForward) webView.goForward() }
    function navigate(route) {
        const target = String(route || "").replace(/^#/, "")
        if (!target.length) return
        if (target.toLowerCase().startsWith("cluster://")) {
            if (!root.rendererReady || !clusterApp.isAllowedRendererUrl(String(webView.url || ""))) {
                pendingClusterLink = target
                return
            }
            // The shared renderer resolves identity, placement and permissions.
            webView.runJavaScript("window.dispatchEvent(new CustomEvent('cluster:desktop-deep-link',{detail:" + JSON.stringify(target) + "}));true")
            return
        }
        webView.runJavaScript(
            "(function(){var u=new URL(window.location.href);u.searchParams.delete('inspect');history.replaceState(history.state,'',u.pathname+u.search+u.hash);window.location.hash=" + JSON.stringify(target) + ";})();true"
        )
    }
    function dispatchShellCommand(command) {
        const value = String(command || "")
        const allowed = ["command-palette", "quick-create", "shortcut-help"]
        if (!root.rendererReady || allowed.indexOf(value) < 0 || !clusterApp.isAllowedRendererUrl(String(webView.url || ""))) return
        webView.runJavaScript(
            "window.dispatchEvent(new CustomEvent('cluster-native-command',{detail:{command:" + JSON.stringify(value) + "}}));true"
        )
    }
    function pullRendererState() {
        if (!root.rendererReady || !clusterApp.isAllowedRendererUrl(String(webView.url || ""))) return
        // Pull only a small non-secret state document. The page never receives a native
        // object or generic command surface, so a renderer compromise does not become a
        // JavaScript-to-C++ bridge.
        webView.runJavaScript(
            "JSON.stringify(window.__clusterDesktopState || null)",
            function(result) {
                if (typeof result === "string" && result.length > 0 && result.length <= 4096)
                    clusterApp.updateRendererStateJson(result)
            }
        )
    }
    function pumpNativeCapabilities() {
        if (!root.rendererReady || root.capabilityPumpBusy || !clusterApp.isAllowedRendererUrl(String(webView.url || ""))) return
        root.capabilityPumpBusy = true
        webView.runJavaScript(
            "JSON.stringify(Array.isArray(window.__clusterNativeRequests)?window.__clusterNativeRequests.splice(0,8):[])",
            function(result) {
                root.capabilityPumpBusy = false
                if (typeof result !== "string" || result.length < 3 || result.length > 131072) return
                let requests = []
                try { requests = JSON.parse(result) } catch (_) { return }
                if (!Array.isArray(requests)) return
                if (requests.length) {
                    root.emptyCapabilityPollCount = 0
                    root.nativeCapabilityPollInterval = 100
                } else {
                    root.emptyCapabilityPollCount += 1
                    if (root.emptyCapabilityPollCount >= 6)
                        root.nativeCapabilityPollInterval = 300
                }
                for (let index = 0; index < requests.length && index < 8; index += 1) {
                    const requestJson = JSON.stringify(requests[index])
                    if (requestJson.length <= 16384)
                        clusterApp.nativeCapabilities.processRequestJson(requestJson, String(webView.url || ""))
                }
            }
        )
    }

    function signOutActiveProfile(profileId) {
        if (root.signOutInProgress || String(profileId) !== String(clusterApp.serverProfiles.activeProfileId)) return
        root.signOutInProgress = true
        root.pendingSignOutProfileId = String(profileId)
        root.signOutPollCount = 0
        // Revoke the active session inside the browser context so the HttpOnly cookie is
        // never copied into Qt. Completion is represented by a tiny numeric page-local flag
        // because runJavaScript callbacks do not promise to await JavaScript Promises.
        webView.runJavaScript(
            "window.__clusterNativeSignOutState=0;fetch('/api/auth/csrf',{credentials:'include',cache:'no-store',headers:{'Accept':'application/json'}}).then(function(r){return r.ok?r.json():Promise.reject()}).then(function(v){if(!v||!v.token)throw new Error('csrf');return fetch('/api/auth/logout',{method:'POST',credentials:'include',headers:{'Accept':'application/json','X-Cluster-CSRF':String(v.token)}})}).then(function(r){window.__clusterNativeSignOutState=r.ok?1:-1}).catch(function(){window.__clusterNativeSignOutState=-1});true",
            function() { signOutPollTimer.start() }
        )
    }

    Timer {
        id: signOutPollTimer
        interval: 250
        repeat: true
        running: false
        onTriggered: {
            root.signOutPollCount += 1
            webView.runJavaScript("Number(window.__clusterNativeSignOutState||0)", function(result) {
                const state = Number(result || 0)
                if (state === 0 && root.signOutPollCount < 20) return
                signOutPollTimer.stop()
                webView.runJavaScript("delete window.__clusterNativeSignOutState")
                const profileId = root.pendingSignOutProfileId
                root.pendingSignOutProfileId = ""
                root.signOutInProgress = false
                clusterApp.serverProfiles.completeSignOut(profileId, state === 1)
            })
        }
    }

    // Poll the capability bridge at 100ms while active. On repeated empty
    // queues back off to 300ms foreground or 1000ms background. This is still
    // a live bridge: queued native requests are never dropped while hidden.
    Timer {
        id: nativeCapabilityPollTimer
        interval: Qt.application.state === Qt.ApplicationActive ? root.nativeCapabilityPollInterval : 1000
        repeat: true
        running: root.rendererReady
        onTriggered: root.pumpNativeCapabilities()
    }

    Timer {
        interval: Qt.application.state === Qt.ApplicationActive ? 10000 : 30000
        repeat: true
        running: root.rendererReady
        onTriggered: root.pullRendererState()
    }


    Surface {
        z: 20
        visible: clusterApp.connectionRecovery.state !== "idle"
        anchors.top: parent.top
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.topMargin: 14
        width: Math.min(560, parent.width - 32)
        implicitHeight: recoveryRow.implicitHeight + 18
        radius: 12
        color: Theme.surfaceStrong
        border.color: Theme.warning

        RowLayout {
            id: recoveryRow
            anchors.fill: parent
            anchors.margins: 9
            spacing: 9
            Rectangle { width: 8; height: 8; radius: 4; color: Theme.warning }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 1
                Text {
                    Layout.fillWidth: true
                    text: clusterApp.connectionRecovery.state === "waiting" ? "Connection interrupted" : "Revalidating Cluster Server"
                    color: Theme.text
                    font.pixelSize: Theme.scaledFont(11)
                    font.weight: Font.DemiBold
                }
                Text {
                    Layout.fillWidth: true
                    text: clusterApp.connectionRecovery.state === "waiting"
                        ? "Your workspace and route are preserved. Retry " + clusterApp.connectionRecovery.attempt + " is scheduled in about " + Math.max(1, Math.ceil(Number(clusterApp.connectionRecovery.delayMs || 0) / 1000)) + "s."
                        : "Cluster is checking health and client compatibility before resuming queued work."
                    color: Theme.textMuted
                    font.pixelSize: Theme.scaledFont(9)
                    wrapMode: Text.WordWrap
                }
            }
            ClusterButton {
                visible: clusterApp.connectionRecovery.state === "waiting"
                text: "Retry now"
                onClicked: clusterApp.retryConnectionNow()
            }
        }
    }

    DropArea {
        id: nativeDropArea
        anchors.fill: parent
        z: 8
        property bool localDropActive: false
        onEntered: function(drag) {
            const urls = drag.urls || []
            localDropActive = urls.length > 0
            if (localDropActive) drag.accept()
        }
        onExited: localDropActive = false
        onDropped: function(drop) {
            const urls = drop.urls || []
            localDropActive = false
            if (!urls.length) return
            drop.accept()
            root.lastDropCount = urls.length
            root.dropReceiptVisible = true
            dropReceiptTimer.restart()
            clusterApp.nativeCapabilities.acceptDroppedUrls(urls)
        }
    }

    Surface {
        z: 9
        visible: nativeDropArea.localDropActive
        anchors.centerIn: parent
        width: Math.min(440, parent.width - 40)
        implicitHeight: 92
        radius: 14
        color: Theme.surfaceStrong
        border.color: Theme.accent
        Column {
            anchors.centerIn: parent
            width: Math.max(0, parent.width - 32)
            spacing: 5
            Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: "Drop files into Cluster"
                color: Theme.text
                font.pixelSize: Theme.scaledFont(14)
                font.weight: Font.DemiBold
            }
            Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                text: "Local paths stay native and are exposed to the workspace only as temporary handles."
                color: Theme.textMuted
                font.pixelSize: Theme.scaledFont(10)
            }
        }
    }


    Timer {
        id: dropReceiptTimer
        interval: 2600
        repeat: false
        onTriggered: root.dropReceiptVisible = false
    }

    Surface {
        z: 10
        visible: root.dropReceiptVisible
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 22
        width: Math.min(430, parent.width - 40)
        implicitHeight: receiptRow.implicitHeight + 20
        radius: 13
        color: Theme.surfaceStrong
        border.color: Theme.success

        RowLayout {
            id: receiptRow
            anchors.fill: parent
            anchors.margins: 10
            spacing: 9
            Rectangle { width: 9; height: 9; radius: 5; color: Theme.success }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 1
                Text {
                    text: root.lastDropCount === 1 ? "1 item handed to Cluster" : root.lastDropCount + " items handed to Cluster"
                    color: Theme.text
                    font.pixelSize: Theme.scaledFont(11)
                    font.weight: Font.DemiBold
                }
                Text {
                    Layout.fillWidth: true
                    text: "The renderer receives temporary native handles, not local filesystem paths."
                    color: Theme.textMuted
                    font.pixelSize: Theme.scaledFont(9)
                    wrapMode: Text.WordWrap
                }
            }
        }
    }

    WebView {
        id: webView
        anchors.fill: parent
        url: root.rendererUrl
        httpUserAgent: "ClusterDesktop/" + clusterApp.version + " QtWebView"

        // Cluster deliberately needs JavaScript and DOM storage for the shared renderer,
        // but a server page never needs direct file:// access from the embedded browser.
        Component.onCompleted: {
            settings.javaScriptEnabled = true
            settings.localStorageEnabled = true
            settings.allowFileAccess = false
            settings.localContentCanAccessFileUrls = false
        }

        onLoadingChanged: function(request) {
            if (request.status === WebView.LoadStartedStatus) {
                root.rendererReady = false
                root.emptyCapabilityPollCount = 0
                root.nativeCapabilityPollInterval = 100
                const target = String(request.url || "")
                if (target !== "about:blank" && !clusterApp.isAllowedRendererUrl(target)) {
                    webView.stop()
                    clusterApp.openExternalUrl(target)
                    if (root.lastSafeUrl.length)
                        webView.url = root.lastSafeUrl
                    else
                        webView.url = root.rendererUrl
                    return
                }
            }
            if (request.status === WebView.LoadSucceededStatus && clusterApp.isAllowedRendererUrl(String(request.url || ""))) {
                root.lastSafeUrl = String(request.url)
                root.rendererReady = true
                clusterApp.serverProfiles.recordRendererLoadSucceeded(root.lastSafeUrl)
                clusterApp.updateManager.markRuntimeHealthy()
                root.pullRendererState()
                return
            }
            if (request.status === WebView.LoadFailedStatus) {
                root.rendererReady = false
                const errorText = String(request.errorString || "Renderer failed to load.")
                clusterApp.serverProfiles.recordRendererLoadFailed(errorText)
            }
        }

        onUrlChanged: function(nextUrl) {
            const target = String(nextUrl || "")
            if (target !== "about:blank" && clusterApp.isAllowedRendererUrl(target))
                root.lastSafeUrl = target
        }
    }

    Connections {
        target: clusterApp
        function onServerUrlChanged() {
            if (root.rendererUrl !== "about:blank")
                webView.url = root.rendererUrl
        }
        function onConnectionRecovered() {
            if (!root.rendererReady && root.rendererUrl !== "about:blank")
                webView.url = root.lastSafeUrl.length ? root.lastSafeUrl : root.rendererUrl
            else
                root.pullRendererState()
        }
    }

    Connections {
        target: clusterApp.nativeCapabilities
        function onResponseReady(responseJson) {
            if (!root.rendererReady || !clusterApp.isAllowedRendererUrl(String(webView.url || ""))) return
            webView.runJavaScript(
                "window.__clusterNativeDeliver&&window.__clusterNativeDeliver(JSON.parse(" + JSON.stringify(String(responseJson)) + "))"
            )
        }
        function onEventReady(eventJson) {
            if (!root.rendererReady || !clusterApp.isAllowedRendererUrl(String(webView.url || ""))) return
            webView.runJavaScript(
                "window.__clusterNativeEventDeliver&&window.__clusterNativeEventDeliver(JSON.parse(" + JSON.stringify(String(eventJson)) + "))"
            )
        }
        function onNavigateBackRequested() { root.goBack() }
        function onNavigateForwardRequested() { root.goForward() }
    }

    Connections {
        target: clusterApp.serverProfiles
        function onSignOutRequested(profileId) { root.signOutActiveProfile(profileId) }
    }
}
