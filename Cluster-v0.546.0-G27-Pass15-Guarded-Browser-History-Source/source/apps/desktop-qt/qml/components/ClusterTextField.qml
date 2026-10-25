import QtQuick
import QtQuick.Controls
import Cluster.Desktop

TextField {
    id: control
    implicitHeight: Theme.largeTargets ? Math.max(48, Math.round((Theme.compact ? 38 : 44) * Theme.textScale)) : Math.round((Theme.compact ? 38 : 44) * Theme.textScale)
    leftPadding: 13
    rightPadding: 13
    selectByMouse: true
    activeFocusOnTab: true
    Accessible.role: Accessible.EditableText
    Accessible.name: accessibleName.length > 0 ? accessibleName : placeholderText
    property string accessibleName: ""
    font.pixelSize: Theme.scaledFont(14)
    color: Theme.text
    placeholderTextColor: Theme.textMuted
    selectionColor: Theme.accent
    selectedTextColor: Theme.text
    background: Rectangle {
        color: Theme.surfaceStrong
        radius: Theme.radiusSmall
        border.width: control.activeFocus ? (Theme.focusIndicator === "strong" || Theme.focusIndicator === "always" ? 3 : 2) : 1
        border.color: control.activeFocus ? Theme.focusRing : Theme.border
    }
}
