import QtQuick
import QtQuick.Controls
import Cluster.Desktop

Switch {
    id: control
    activeFocusOnTab: true
    property string accessibleName: ""
    Accessible.role: Accessible.CheckBox
    Accessible.name: accessibleName.length > 0 ? accessibleName : text
    Accessible.checked: control.checked
    implicitHeight: Theme.largeTargets ? Math.max(44, Math.round(34 * Theme.textScale)) : Math.round(34 * Theme.textScale)
    spacing: 8
    font.pixelSize: Theme.scaledFont(13)

    indicator: Rectangle {
        implicitWidth: 34
        implicitHeight: 19
        x: control.leftPadding
        y: parent.height / 2 - height / 2
        radius: height / 2
        color: control.checked ? Theme.accent : Theme.surfaceMuted
        border.width: control.activeFocus ? (Theme.focusIndicator === "strong" || Theme.focusIndicator === "always" ? 3 : 2) : 1
        border.color: control.activeFocus ? Theme.focusRing : control.checked ? Theme.accentStrong : Theme.border
        Rectangle {
            width: 15
            height: 15
            radius: 8
            y: 2
            x: control.checked ? parent.width - width - 2 : 2
            color: control.checked ? (Theme.dark ? Theme.backgroundDeep : "#FFFFFF") : Theme.surfaceStrong
            border.width: 1
            border.color: Theme.border
            Behavior on x { enabled: !Theme.reducedMotion && !Theme.noMotion; NumberAnimation { duration: Theme.reducedMotion ? 50 : 110 } }
        }
    }

    contentItem: Text {
        leftPadding: control.indicator.width + control.spacing
        text: control.text
        font: control.font
        color: Theme.text
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }
}
