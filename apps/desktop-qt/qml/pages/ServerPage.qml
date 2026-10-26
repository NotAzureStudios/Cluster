import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Cluster.Desktop

Item {
    anchors.fill: parent

    Rectangle {
        anchors.fill: parent
        color: Theme.background
        Rectangle { x: -140; y: -180; width: 560; height: 560; radius: 280; color: Theme.dark ? "#152E3942" : "#2236C9E8" }
        Rectangle { anchors.right: parent.right; anchors.bottom: parent.bottom; anchors.rightMargin: -180; anchors.bottomMargin: -220; width: 620; height: 620; radius: 310; color: Theme.dark ? "#102D3D49" : "#1839C9F4" }
    }

    ColumnLayout {
        anchors.centerIn: parent
        width: Math.min(520, parent.width - 40)
        spacing: 10

        Surface {
            Layout.fillWidth: true
            implicitHeight: content.implicitHeight + 48
            radius: 18

            ColumnLayout {
                id: content
                anchors.fill: parent
                anchors.margins: 24
                spacing: 13

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 11
                    ClusterLogo { Layout.preferredWidth: 44; Layout.preferredHeight: 44 }
                    Text {
                        Layout.fillWidth: true
                        text: clusterApp.connectionRecovery.attempt > 0 ? "Reconnecting" : clusterApp.state === "connecting" ? "Connecting" : "Connect to Cluster"
                        color: Theme.text
                        font.pixelSize: Theme.scaledFont(27)
                        font.weight: Font.DemiBold
                    }
                }

                Text { text: "Server address"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10); font.weight: Font.DemiBold }
                ClusterTextField {
                    id: serverField
                    Layout.fillWidth: true
                    text: clusterApp.serverUrl
                    placeholderText: "http://localhost:3000"
                    enabled: !clusterApp.busy
                    onTextEdited: clusterApp.serverUrl = text
                    onAccepted: clusterApp.connectToServer()
                }

                Surface {
                    Layout.fillWidth: true
                    visible: clusterApp.error.message !== undefined && clusterApp.error.message !== ""
                    implicitHeight: errorColumn.implicitHeight + 20
                    color: Theme.dangerSurface
                    border.color: Theme.danger
                    ColumnLayout {
                        id: errorColumn
                        anchors.fill: parent
                        anchors.margins: 10
                        spacing: 3
                        Text { Layout.fillWidth: true; text: clusterApp.error.message || ""; color: Theme.text; wrapMode: Text.WordWrap; font.pixelSize: Theme.scaledFont(11); font.weight: Font.DemiBold }
                        Text { visible: (clusterApp.error.action || "") !== ""; Layout.fillWidth: true; text: clusterApp.error.action || ""; color: Theme.textMuted; wrapMode: Text.WordWrap; font.pixelSize: Theme.scaledFont(10) }
                        RowLayout {
                            Layout.fillWidth: true
                            visible: (clusterApp.error.code || "") !== "" || (clusterApp.error.requestId || "") !== ""
                            Text { visible: (clusterApp.error.code || "") !== ""; text: clusterApp.error.code || ""; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(8); font.family: "Consolas" }
                            Item { Layout.fillWidth: true }
                            Text { visible: (clusterApp.error.requestId || "") !== ""; text: clusterApp.error.requestId ? "Request " + clusterApp.error.requestId : ""; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(8); font.family: "Consolas" }
                        }
                    }
                }

                Surface {
                    Layout.fillWidth: true
                    visible: clusterApp.connectionRecovery.attempt > 0
                    implicitHeight: recoveryRow.implicitHeight + 18
                    radius: 10
                    color: Theme.surfaceStrong
                    RowLayout {
                        id: recoveryRow
                        anchors.fill: parent
                        anchors.margins: 9
                        spacing: 8
                        Rectangle { width: 7; height: 7; radius: 4; color: Theme.warning }
                        Text {
                            Layout.fillWidth: true
                            text: clusterApp.connectionRecovery.state === "waiting"
                                ? "Retry " + clusterApp.connectionRecovery.attempt + " scheduled in about " + Math.max(1, Math.ceil(Number(clusterApp.connectionRecovery.delayMs || 0) / 1000)) + "s"
                                : "Connection attempt " + clusterApp.connectionRecovery.attempt + " is being validated"
                            color: Theme.textMuted
                            font.pixelSize: Theme.scaledFont(10)
                            wrapMode: Text.WordWrap
                        }
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    ClusterButton {
                        Layout.fillWidth: true
                        primary: true
                        text: clusterApp.busy ? clusterApp.statusText : clusterApp.connectionRecovery.attempt > 0 ? "Retry now" : "Connect"
                        enabled: !clusterApp.busy && serverField.text.trim().length > 0
                        onClicked: clusterApp.connectionRecovery.attempt > 0 ? clusterApp.retryConnectionNow() : clusterApp.connectToServer()
                    }
                    ClusterButton {
                        visible: clusterApp.connectionRecovery.attempt > 0
                        text: "Edit server"
                        enabled: !clusterApp.busy
                        onClicked: clusterApp.useDifferentServer()
                    }
                }
            }
        }
    }
}
