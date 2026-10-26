import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Cluster.Desktop

Dialog {
    id: dialog
    modal: true
    width: 580
    title: clusterApp.updateManager.recoveryRequired ? "Cluster update recovery" : "Cluster update"
    standardButtons: Dialog.NoButton

    function showUpdate() {
        open()
        if (clusterApp.updateManager.state === "idle") clusterApp.updateManager.checkForUpdates()
    }

    contentItem: ColumnLayout {
        spacing: 14
        Text {
            Layout.fillWidth: true
            text: clusterApp.updateManager.message || "Check the signed release feed for an update."
            color: Theme.text
            wrapMode: Text.WordWrap
            font.pixelSize: Theme.scaledFont(13)
            Accessible.role: Accessible.StaticText
        }
        ProgressBar {
            Layout.fillWidth: true
            visible: clusterApp.updateManager.state === "downloading" || clusterApp.updateManager.state === "verifying"
            from: 0
            to: 1
            value: clusterApp.updateManager.progress
        }
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 4
            visible: clusterApp.updateManager.availableVersion.length > 0
            Text {
                text: "Target version: " + clusterApp.updateManager.availableVersion
                color: Theme.textMuted
                font.pixelSize: Theme.scaledFont(11)
            }
            Text {
                visible: clusterApp.updateManager.previousVersion.length > 0
                text: "Rollback version: " + clusterApp.updateManager.previousVersion
                color: Theme.textMuted
                font.pixelSize: Theme.scaledFont(11)
            }
        }
        Surface {
            Layout.fillWidth: true
            visible: clusterApp.updateManager.recoveryRequired
            implicitHeight: recoveryColumn.implicitHeight + 24
            ColumnLayout {
                id: recoveryColumn
                anchors.fill: parent
                anchors.margins: 12
                spacing: 8
                Text {
                    Layout.fillWidth: true
                    text: "The previous installer is retained until this version passes its runtime health check. Rollback re-verifies that installer before it can run."
                    color: Theme.textMuted
                    wrapMode: Text.WordWrap
                    font.pixelSize: Theme.scaledFont(11)
                }
                RowLayout {
                    Layout.fillWidth: true
                    ClusterButton {
                        visible: clusterApp.updateManager.rollbackReady
                        text: "Rollback to " + clusterApp.updateManager.previousVersion
                        onClicked: clusterApp.updateManager.rollbackUpdate()
                    }
                    ClusterButton {
                        text: "Keep this version"
                        primary: true
                        onClicked: clusterApp.updateManager.markRuntimeHealthy()
                    }
                    Item { Layout.fillWidth: true }
                }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            visible: !clusterApp.updateManager.recoveryRequired
            Item { Layout.fillWidth: true }
            ClusterButton { text: "Check again"; enabled: !clusterApp.updateManager.busy; onClicked: clusterApp.updateManager.checkForUpdates() }
            ClusterButton {
                visible: clusterApp.updateManager.updateAvailable && clusterApp.updateManager.state !== "ready"
                text: "Download"
                primary: true
                enabled: !clusterApp.updateManager.busy
                onClicked: clusterApp.updateManager.downloadUpdate()
            }
            ClusterButton {
                visible: clusterApp.updateManager.state === "ready"
                text: "Install verified update"
                primary: true
                onClicked: clusterApp.updateManager.installUpdate()
            }
            ClusterButton { text: "Close"; onClicked: dialog.close() }
        }
        RowLayout {
            Layout.fillWidth: true
            visible: clusterApp.updateManager.recoveryRequired
            Item { Layout.fillWidth: true }
            ClusterButton { text: "Close"; onClicked: dialog.close() }
        }
    }
}
