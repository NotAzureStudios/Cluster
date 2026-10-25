import QtQuick
import QtQuick.Controls
import Cluster.Desktop

Button {
    id: control
    property bool primary: false
    property bool danger: false
    property string accessibleName: ""
    implicitHeight: Theme.controlHeight
    leftPadding: 14
    rightPadding: 14
    font.pixelSize: Theme.scaledFont(13)
    font.weight: Font.Medium
    activeFocusOnTab: true
    Accessible.role: Accessible.Button
    Accessible.name: accessibleName.length > 0 ? accessibleName : text

    contentItem: Text {
        text: control.text
        font: control.font
        color: control.danger ? Theme.danger : control.primary ? (Theme.dark ? Theme.backgroundDeep : "#06222B") : Theme.text
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        opacity: control.enabled ? 1 : 0.45
        elide: Text.ElideRight
    }
    background: Rectangle {
        radius: Theme.radiusSmall
        color: control.down
               ? (control.primary ? Theme.accentStrong : Theme.surfaceMuted)
               : control.hovered
                 ? (control.primary ? Theme.accentStrong : Theme.surfaceHover)
                 : (control.primary ? Theme.accent : Theme.surfaceStrong)
        border.width: control.activeFocus ? (Theme.focusIndicator === "strong" || Theme.focusIndicator === "always" ? 3 : 2) : control.primary ? 0 : 1
        border.color: control.activeFocus ? Theme.focusRing : control.danger ? Theme.danger : Theme.border
        opacity: control.enabled ? 1 : 0.6
    }
}
