import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Cluster.Desktop

Window {
    id: root
    width: 600
    height: 610
    minimumWidth: 360
    minimumHeight: 520
    title: "App settings · Cluster"
    color: Theme.background
    flags: Qt.Window
    property var serverProfilesWindow
    property string updateActionMessage: ""
    property bool updateActionFailed: false
    property string diagnosticsActionMessage: ""
    property bool diagnosticsActionFailed: false

    function reportDiagnosticsAction(success, location) {
        root.diagnosticsActionFailed = !success
        root.diagnosticsActionMessage = success ? "Opened " + location + "." : "Could not open " + location + ". Check local folder access."
    }

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

        ColumnLayout {
            width: Math.max(0, root.width)
            spacing: 14

            Item { Layout.preferredHeight: 6 }

            RowLayout {
                Layout.fillWidth: true
                Layout.leftMargin: 20
                Layout.rightMargin: 20
                spacing: 10
                ClusterLogo { Layout.preferredWidth: 34; Layout.preferredHeight: 34 }
                ColumnLayout {
                    spacing: 1
                    Text { text: "App settings"; color: Theme.text; font.pixelSize: Theme.scaledFont(22); font.weight: Font.DemiBold }
                    Text { text: "Local behavior, profiles, and updates"; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(11) }
                }
                Item { Layout.fillWidth: true }
            }

            Surface {
                Layout.fillWidth: true
                Layout.leftMargin: 20
                Layout.rightMargin: 20
                implicitHeight: localColumn.implicitHeight + 30

                ColumnLayout {
                    id: localColumn
                    anchors.fill: parent
                    anchors.margins: 15
                    spacing: 10

                    Text { text: "Local behavior"; color: Theme.text; font.pixelSize: Theme.scaledFont(14); font.weight: Font.DemiBold }
                    ClusterSwitch {
                        text: "Launch with Windows"
                        checked: clusterApp.desktopPreferences.launchAtStartup
                        onToggled: clusterApp.desktopPreferences.launchAtStartup = checked
                    }
                    ClusterSwitch {
                        text: "Close to system tray"
                        checked: clusterApp.desktopPreferences.closeToTray
                        onToggled: clusterApp.desktopPreferences.closeToTray = checked
                    }
                    ClusterSwitch {
                        text: "Desktop notifications"
                        checked: clusterApp.desktopPreferences.notificationsEnabled
                        onToggled: clusterApp.desktopPreferences.notificationsEnabled = checked
                    }
                    ClusterComboBox {
                        Layout.fillWidth: true
                        model: ["system", "full", "reduced", "none"]
                        currentIndex: Math.max(0, model.indexOf(clusterApp.desktopPreferences.motionMode))
                        onActivated: clusterApp.desktopPreferences.motionMode = currentText
                        Accessible.name: "Motion preference"
                    }
                    ClusterSwitch {
                        text: "High contrast"
                        checked: clusterApp.desktopPreferences.highContrast
                        onToggled: clusterApp.desktopPreferences.contrastMode = checked ? "high" : "system"
                    }
                }
            }

            Surface {
                Layout.fillWidth: true
                Layout.leftMargin: 20
                Layout.rightMargin: 20
                implicitHeight: profileColumn.implicitHeight + 30

                ColumnLayout {
                    id: profileColumn
                    anchors.fill: parent
                    anchors.margins: 15
                    spacing: 8

                    RowLayout {
                        Layout.fillWidth: true
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 1
                            Text { text: "Server profiles"; color: Theme.text; font.pixelSize: Theme.scaledFont(14); font.weight: Font.DemiBold }
                            Text {
                                Layout.fillWidth: true
                                text: (clusterApp.serverProfiles.activeProfile.label || clusterApp.serverProfiles.activeServerUrl) + " · " + clusterApp.serverProfiles.profiles.length + " saved"
                                color: Theme.textMuted
                                font.pixelSize: Theme.scaledFont(10)
                                elide: Text.ElideRight
                            }
                        }
                        ClusterButton {
                            text: "Manage servers"
                            primary: true
                            onClicked: {
                                if (root.serverProfilesWindow) root.serverProfilesWindow.showManager()
                            }
                        }
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "Cookies, cache, local storage, permissions, and sessions are isolated per server. Ctrl+Shift+S opens the server manager."
                        color: Theme.textMuted
                        font.pixelSize: Theme.scaledFont(10)
                        wrapMode: Text.WordWrap
                    }
                }
            }

            Surface {
                Layout.fillWidth: true
                Layout.leftMargin: 20
                Layout.rightMargin: 20
                implicitHeight: updateColumn.implicitHeight + 30

                ColumnLayout {
                    id: updateColumn
                    anchors.fill: parent
                    anchors.margins: 15
                    spacing: 10

                    Text { text: "Updates"; color: Theme.text; font.pixelSize: Theme.scaledFont(14); font.weight: Font.DemiBold }
                    ClusterTextField {
                        Layout.fillWidth: true
                        accessibleName: "Signed update feed URL"
                        placeholderText: "Signed update feed URL"
                        text: clusterApp.desktopPreferences.updateFeedUrl
                        onEditingFinished: clusterApp.desktopPreferences.updateFeedUrl = text
                    }
                    ClusterSwitch {
                        text: "Automatically check for updates"
                        checked: clusterApp.desktopPreferences.autoCheckUpdates
                        onToggled: clusterApp.desktopPreferences.autoCheckUpdates = checked
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        ClusterButton { text: "Check for updates"; onClicked: updateDialog.showUpdate() }
                        ClusterButton {
                            text: clusterApp.desktopPreferences.shellIntegrationReady ? "Repair links" : "Register links"
                            onClicked: {
                                const registered = clusterApp.desktopPreferences.registerShellIntegration()
                                root.updateActionFailed = !registered
                                root.updateActionMessage = registered ? "Cluster link handling is registered." : "Could not register Cluster links. Check local permissions."
                            }
                        }
                        Item { Layout.fillWidth: true }
                    }
                    Text {
                        Layout.fillWidth: true
                        visible: root.updateActionMessage.length > 0
                        text: root.updateActionMessage
                        color: root.updateActionFailed ? Theme.danger : Theme.textMuted
                        font.pixelSize: Theme.scaledFont(11)
                        wrapMode: Text.WordWrap
                        Accessible.role: Accessible.StaticText
                    }
                }
            }

            Surface {
                Layout.fillWidth: true
                Layout.leftMargin: 20
                Layout.rightMargin: 20
                implicitHeight: diagnosticColumn.implicitHeight + 30

                ColumnLayout {
                    id: diagnosticColumn
                    anchors.fill: parent
                    anchors.margins: 15
                    spacing: 10
                    Text { text: "Local diagnostics"; color: Theme.text; font.pixelSize: Theme.scaledFont(14); font.weight: Font.DemiBold }
                    Text { text: clusterApp.serverProfiles.profileDataRoot; color: Theme.textMuted; font.pixelSize: Theme.scaledFont(10); elide: Text.ElideMiddle; Layout.fillWidth: true }
                    GridLayout {
                        Layout.fillWidth: true
                        columns: root.width < 480 ? 1 : 3
                        columnSpacing: 8
                        rowSpacing: 8
                        ClusterButton {
                            Layout.fillWidth: true
                            text: "Open logs"
                            onClicked: root.reportDiagnosticsAction(clusterApp.desktopPreferences.openLogsFolder(), "logs")
                        }
                        ClusterButton {
                            Layout.fillWidth: true
                            text: "Open app data"
                            onClicked: root.reportDiagnosticsAction(clusterApp.desktopPreferences.openApplicationData(), "app data")
                        }
                        ClusterButton {
                            Layout.fillWidth: true
                            text: "Open profiles"
                            onClicked: root.reportDiagnosticsAction(clusterApp.serverProfiles.openProfilesFolder(), "profiles")
                        }
                    }
                    Text {
                        Layout.fillWidth: true
                        visible: root.diagnosticsActionMessage.length > 0
                        text: root.diagnosticsActionMessage
                        color: root.diagnosticsActionFailed ? Theme.danger : Theme.textMuted
                        font.pixelSize: Theme.scaledFont(11)
                        wrapMode: Text.WordWrap
                        Accessible.role: Accessible.StaticText
                    }
                }
            }

            Item { Layout.preferredHeight: 12 }
        }
    }

    UpdateDialog { id: updateDialog }
}
