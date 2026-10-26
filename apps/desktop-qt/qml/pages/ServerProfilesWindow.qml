import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Cluster.Desktop

Window {
    id: root
    width: 900
    height: 640
    minimumWidth: 760
    minimumHeight: 540
    title: "Servers · Cluster"
    color: Theme.background
    flags: Qt.Window

    property string selectedProfileId: ""
    property bool addMode: false
    property string formError: ""

    function profileForId(profileId) {
        const items = clusterApp.serverProfiles.profiles
        for (let i = 0; i < items.length; ++i) {
            if (String(items[i].id) === String(profileId))
                return items[i]
        }
        return ({})
    }

    function ensureSelection() {
        if (selectedProfileId.length && profileForId(selectedProfileId).id)
            return
        selectedProfileId = clusterApp.serverProfiles.activeProfileId
        if (!selectedProfileId.length && clusterApp.serverProfiles.profiles.length)
            selectedProfileId = String(clusterApp.serverProfiles.profiles[0].id)
    }

    function selectProfile(profileId) {
        addMode = false
        formError = ""
        selectedProfileId = String(profileId)
    }

    function showManager() {
        addMode = false
        formError = ""
        ensureSelection()
        show()
        raise()
        requestActivate()
    }

    Component.onCompleted: ensureSelection()
    onVisibleChanged: if (visible) ensureSelection()

    Connections {
        target: clusterApp.serverProfiles
        function onProfilesChanged() { root.ensureSelection() }
        function onActiveProfileChanged() { root.ensureSelection() }
        function onLastOperationErrorChanged() {
            if (clusterApp.serverProfiles.lastOperationError.length)
                root.formError = clusterApp.serverProfiles.lastOperationError
        }
    }

    RowLayout {
        anchors.fill: parent
        anchors.margins: 18
        spacing: 14

        Surface {
            Layout.preferredWidth: 300
            Layout.fillHeight: true

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 12
                spacing: 10

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    ClusterLogo { Layout.preferredWidth: 30; Layout.preferredHeight: 30 }
                    ColumnLayout {
                        spacing: 0
                        Text { text: "Servers"; color: Theme.text; font.pixelSize: Theme.scaledFont(18); font.weight: Font.DemiBold }
                        Text { text: clusterApp.serverProfiles.profiles.length + " saved"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10) }
                    }
                    Item { Layout.fillWidth: true }
                    ClusterButton {
                        text: "+"
                        Accessible.name: "Add server"
                        onClicked: {
                            root.addMode = true
                            root.formError = ""
                            serverUrlField.text = ""
                            serverLabelField.text = ""
                            serverUrlField.forceActiveFocus()
                        }
                    }
                }

                Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

                ListView {
                    id: profileList
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    spacing: 6
                    model: clusterApp.serverProfiles.profiles
                    delegate: ItemDelegate {
                        id: profileRow
                        required property var modelData
                        width: profileList.width
                        height: Math.max(72, Math.round(72 * Theme.textScale))
                        activeFocusOnTab: true
                        Accessible.role: Accessible.ListItem
                        Accessible.name: "Server " + String(modelData.label || modelData.url) + ", " + String(modelData.status)
                        Accessible.selected: root.selectedProfileId === String(modelData.id)
                        onClicked: root.selectProfile(modelData.id)
                        leftPadding: 9
                        rightPadding: 9
                        topPadding: 8
                        bottomPadding: 8
                        background: Rectangle {
                            radius: Theme.radiusSmall
                            color: root.selectedProfileId === String(profileRow.modelData.id) ? Theme.surfaceStrong : "transparent"
                            border.width: profileRow.activeFocus ? (Theme.focusIndicator === "strong" || Theme.focusIndicator === "always" ? 3 : 2) : root.selectedProfileId === String(profileRow.modelData.id) ? 1 : 0
                            border.color: profileRow.activeFocus ? Theme.focusRing : profileRow.modelData.recoveryRequired ? Theme.warning : Theme.border
                        }

                        contentItem: RowLayout {
                            spacing: 9
                            Rectangle {
                                Layout.preferredWidth: 34
                                Layout.preferredHeight: 34
                                radius: 10
                                color: modelData.active ? Theme.accentSurface : Theme.surfaceMuted
                                Text {
                                    anchors.centerIn: parent
                                    text: String(modelData.label || "C").slice(0, 1).toUpperCase()
                                    color: modelData.active ? Theme.accentStrong : Theme.text
                                    font.pixelSize: Theme.scaledFont(14)
                                    font.weight: Font.Bold
                                }
                            }
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 1
                                Text {
                                    Layout.fillWidth: true
                                    text: String(modelData.label || modelData.url)
                                    color: Theme.text
                                    font.pixelSize: Theme.scaledFont(12)
                                    font.weight: Font.DemiBold
                                    elide: Text.ElideRight
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: modelData.userLabel ? String(modelData.userLabel) : String(modelData.url)
                                    color: Theme.textMuted
                                    font.pixelSize: Theme.scaledFont(9)
                                    elide: Text.ElideRight
                                }
                                RowLayout {
                                    spacing: 5
                                    Rectangle { width: 6; height: 6; radius: 3; color: modelData.recoveryRequired ? Theme.warning : modelData.consecutiveFailures > 0 ? Theme.danger : modelData.lastConnectedAt ? Theme.success : Theme.textMuted }
                                    Text { text: String(modelData.status); color: Theme.textMuted; font.pixelSize: Theme.scaledFont(9) }
                                    Text { visible: modelData.active; text: "• Current"; color: Theme.accentStrong; font.pixelSize: Theme.scaledFont(9) }
                                }
                            }
                        }
                    }
                }

                ClusterButton {
                    Layout.fillWidth: true
                    text: "Add server"
                    primary: true
                    onClicked: {
                        root.addMode = true
                        root.formError = ""
                        serverUrlField.text = ""
                        serverLabelField.text = ""
                        serverUrlField.forceActiveFocus()
                    }
                }
            }
        }

        Surface {
            Layout.fillWidth: true
            Layout.fillHeight: true

            StackLayout {
                anchors.fill: parent
                anchors.margins: 18
                currentIndex: root.addMode ? 1 : 0

                Item {
                    id: detailPane
                    readonly property var profile: root.profileForId(root.selectedProfileId)

                    ColumnLayout {
                        anchors.fill: parent
                        spacing: 12

                        RowLayout {
                            Layout.fillWidth: true
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 2
                                Text { text: detailPane.profile.label || "Server profile"; color: Theme.text; font.pixelSize: Theme.scaledFont(23); font.weight: Font.DemiBold }
                                Text { text: detailPane.profile.url || ""; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(11); elide: Text.ElideMiddle; Layout.fillWidth: true }
                            }
                            Rectangle {
                                visible: Boolean(detailPane.profile.secure)
                                radius: 9
                                color: Theme.accentSurface
                                implicitWidth: securityText.implicitWidth + 16
                                implicitHeight: 26
                                Text { id: securityText; anchors.centerIn: parent; text: "Protected"; color: Theme.accentStrong; font.pixelSize: Theme.scaledFont(10); font.weight: Font.DemiBold }
                            }
                        }

                        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

                        GridLayout {
                            Layout.fillWidth: true
                            columns: 2
                            columnSpacing: 12
                            rowSpacing: 8
                            Text { text: "Account"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10) }
                            Text { text: detailPane.profile.userLabel || "Not signed in"; color: Theme.text; font.pixelSize: Theme.scaledFont(11); Layout.fillWidth: true; elide: Text.ElideRight }
                            Text { text: "Last connected"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10) }
                            Text { text: detailPane.profile.lastConnectedAt || "Not yet"; color: Theme.text; font.pixelSize: Theme.scaledFont(11); Layout.fillWidth: true; elide: Text.ElideRight }
                            Text { text: "Last page"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10) }
                            Text { text: detailPane.profile.lastRoute || "Home"; color: Theme.text; font.pixelSize: Theme.scaledFont(11); Layout.fillWidth: true; elide: Text.ElideRight }
                            Text { text: "Profile isolation"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10) }
                            Text { text: Number(detailPane.profile.isolationVersion || 1) >= 2 ? "WebView + native data" : "WebView only"; color: Theme.text; font.pixelSize: Theme.scaledFont(11); Layout.fillWidth: true }
                            Text { text: "Browser profile"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10) }
                            Text { text: detailPane.profile.id || ""; color: Theme.text; font.pixelSize: Theme.scaledFont(10); Layout.fillWidth: true; elide: Text.ElideMiddle }
                        }

                        Rectangle {
                            visible: Boolean(detailPane.profile.recoveryRequired || detailPane.profile.consecutiveFailures > 0)
                            Layout.fillWidth: true
                            implicitHeight: recoveryColumn.implicitHeight + 22
                            radius: Theme.radius
                            color: Theme.warningSurface
                            border.width: 1
                            border.color: Theme.warning
                            ColumnLayout {
                                id: recoveryColumn
                                anchors.fill: parent
                                anchors.margins: 11
                                spacing: 5
                                Text { text: detailPane.profile.recoveryRequired ? "Profile recovery recommended" : "Recent connection failure"; color: Theme.text; font.pixelSize: Theme.scaledFont(12); font.weight: Font.DemiBold }
                                Text {
                                    Layout.fillWidth: true
                                    text: detailPane.profile.lastError || "Cluster detected repeated unclean starts for this server profile."
                                    color: Theme.textMuted
                                    font.pixelSize: Theme.scaledFont(10)
                                    wrapMode: Text.WordWrap
                                }
                                RowLayout {
                                    ClusterButton { text: "Clear warning"; onClicked: clusterApp.serverProfiles.clearRecoveryState(String(detailPane.profile.id)) }
                                    ClusterButton { text: "Reset local data"; onClicked: resetDialog.confirmFor(detailPane.profile) }
                                }
                            }
                        }

                        Text { text: "Profile name"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10) }
                        ClusterTextField {
                            id: renameField
                            Layout.fillWidth: true
                            accessibleName: "Server profile name"
                            placeholderText: detailPane.profile.serverLabel || "Optional local name"
                            text: detailPane.profile.customLabel || ""
                            onEditingFinished: {
                                if (detailPane.profile.id && !clusterApp.serverProfiles.renameProfile(String(detailPane.profile.id), text))
                                    root.formError = clusterApp.serverProfiles.lastOperationError || "Could not rename this server profile."
                            }
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 8
                            ClusterButton {
                                visible: !detailPane.profile.active
                                text: "Switch to server"
                                primary: true
                                onClicked: {
                                    if (!clusterApp.serverProfiles.switchProfile(String(detailPane.profile.id)))
                                        root.formError = clusterApp.serverProfiles.lastOperationError || "Could not switch to this server."
                                }
                            }
                            ClusterButton {
                                visible: Boolean(detailPane.profile.active)
                                text: "Current server"
                                enabled: false
                            }
                            ClusterButton {
                                text: "Open profile folder"
                                onClicked: {
                                    if (!clusterApp.serverProfiles.openProfileFolder(String(detailPane.profile.id)))
                                        root.formError = "Could not open the profile folder. Check local folder access."
                                }
                            }
                            Item { Layout.fillWidth: true }
                        }

                        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

                        Text { text: "Session & local data"; color: Theme.text; font.pixelSize: Theme.scaledFont(13); font.weight: Font.DemiBold }
                        Text {
                            Layout.fillWidth: true
                            text: "Reset removes only this server's WebView cookies/storage/permissions and renderer offline state plus its native API session, HTTP cache, transfer ledger, and mounted-Library cache. Other server profiles are untouched."
                            color: Theme.textMuted
                            font.pixelSize: Theme.scaledFont(10)
                            wrapMode: Text.WordWrap
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 8
                            ClusterButton {
                                text: detailPane.profile.active ? "Sign out" : "Clear local session"
                                onClicked: {
                                    if (!clusterApp.serverProfiles.requestSignOut(String(detailPane.profile.id)))
                                        root.formError = clusterApp.serverProfiles.lastOperationError || "Could not clear this server session."
                                }
                            }
                            ClusterButton {
                                text: "Reset local data"
                                danger: true
                                onClicked: resetDialog.confirmFor(detailPane.profile)
                            }
                            ClusterButton {
                                visible: !detailPane.profile.active
                                text: "Forget server"
                                danger: true
                                onClicked: {
                                    forgetDialog.confirmFor(detailPane.profile)
                                }
                            }
                            Item { Layout.fillWidth: true }
                        }

                        Item { Layout.fillHeight: true }

                        Text {
                            visible: root.formError.length > 0 || clusterApp.serverProfiles.lastOperationError.length > 0
                            Layout.fillWidth: true
                            text: root.formError.length ? root.formError : clusterApp.serverProfiles.lastOperationError
                            color: Theme.danger
                            font.pixelSize: Theme.scaledFont(10)
                            wrapMode: Text.WordWrap
                        }
                    }
                }

                Item {
                    ColumnLayout {
                        anchors.fill: parent
                        spacing: 12

                        RowLayout {
                            Layout.fillWidth: true
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 2
                                Text { text: "Add a Cluster server"; color: Theme.text; font.pixelSize: Theme.scaledFont(23); font.weight: Font.DemiBold }
                                Text { text: "Each server receives isolated WebView and native local-data profiles."; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(11) }
                            }
                            ClusterButton { text: "Cancel"; onClicked: { root.addMode = false; root.formError = "" } }
                        }

                        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

                        Text { text: "Server address"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10) }
                        ClusterTextField {
                            id: serverUrlField
                            Layout.fillWidth: true
                            accessibleName: "Cluster Server address"
                            placeholderText: "https://cluster.example.com"
                            onTextChanged: root.formError = ""
                        }
                        Text { text: "Name"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10) }
                        ClusterTextField {
                            id: serverLabelField
                            Layout.fillWidth: true
                            accessibleName: "Local server profile name"
                            placeholderText: "Optional local name"
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: secureInfo.implicitHeight + 20
                            radius: Theme.radiusSmall
                            color: Theme.surfaceMuted
                            Text {
                                id: secureInfo
                                anchors.fill: parent
                                anchors.margins: 10
                                text: "Remote servers require HTTPS. Plain HTTP is accepted only for localhost development unless the explicit development override is enabled."
                                color: Theme.textMuted
                                font.pixelSize: Theme.scaledFont(10)
                                wrapMode: Text.WordWrap
                            }
                        }

                        Text {
                            visible: root.formError.length > 0
                            Layout.fillWidth: true
                            text: root.formError
                            color: Theme.danger
                            font.pixelSize: Theme.scaledFont(10)
                            wrapMode: Text.WordWrap
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 8
                            ClusterButton {
                                text: "Save server"
                                onClicked: {
                                    const result = clusterApp.serverProfiles.addServer(serverUrlField.text, serverLabelField.text)
                                    if (!result.ok) {
                                        root.formError = String(result.error || "Could not save this server.")
                                        return
                                    }
                                    root.selectedProfileId = String(result.id)
                                    root.addMode = false
                                }
                            }
                            ClusterButton {
                                text: "Save & switch"
                                primary: true
                                onClicked: {
                                    const result = clusterApp.serverProfiles.addServer(serverUrlField.text, serverLabelField.text)
                                    if (!result.ok) {
                                        root.formError = String(result.error || "Could not save this server.")
                                        return
                                    }
                                    if (!clusterApp.serverProfiles.switchProfile(String(result.id))) {
                                        // The profile has been saved; move into its detail view
                                        // rather than encouraging another Save & switch click.
                                        root.selectProfile(result.id)
                                        root.formError = clusterApp.serverProfiles.lastOperationError || "The server was saved but could not be activated."
                                    }
                                }
                            }
                            Item { Layout.fillWidth: true }
                        }

                        Item { Layout.fillHeight: true }
                    }
                }
            }
        }
    }

    Dialog {
        id: resetDialog
        modal: true
        anchors.centerIn: parent
        width: Math.min(440, root.width - 48)
        title: "Reset local server data?"
        standardButtons: Dialog.Cancel | Dialog.Ok
        property string targetProfileId: ""
        property string targetProfileName: ""
        function confirmFor(profile) {
            targetProfileId = String(profile.id || "")
            targetProfileName = String(profile.label || profile.url || "this server")
            if (targetProfileId.length) open()
        }
        onAccepted: {
            if (targetProfileId.length && !clusterApp.serverProfiles.resetProfileData(targetProfileId))
                root.formError = clusterApp.serverProfiles.lastOperationError || "Server data could not be reset."
        }
        contentItem: Text {
            text: "Remove cached files, offline work, browser data and local sessions for “" + resetDialog.targetProfileName + "”? This cannot be undone."
            color: Theme.text
            wrapMode: Text.WordWrap
            font.pixelSize: Theme.scaledFont(13)
            Accessible.role: Accessible.StaticText
        }
    }

    Dialog {
        id: forgetDialog
        modal: true
        anchors.centerIn: parent
        width: Math.min(440, root.width - 48)
        title: "Forget this server?"
        standardButtons: Dialog.Cancel | Dialog.Ok
        property string targetProfileId: ""
        property string targetProfileName: ""
        function confirmFor(profile) {
            targetProfileId = String(profile.id || "")
            targetProfileName = String(profile.label || profile.url || "this server")
            if (targetProfileId.length) open()
        }
        onAccepted: {
            if (targetProfileId.length && clusterApp.serverProfiles.forgetProfile(targetProfileId))
                root.ensureSelection()
            else root.formError = clusterApp.serverProfiles.lastOperationError || "The server could not be forgotten."
        }
        contentItem: Text {
            text: "Forget “" + forgetDialog.targetProfileName + "” and delete its local browser and cached data? The server itself is not changed."
            color: Theme.text
            wrapMode: Text.WordWrap
            font.pixelSize: Theme.scaledFont(13)
            Accessible.role: Accessible.StaticText
        }
    }
}
