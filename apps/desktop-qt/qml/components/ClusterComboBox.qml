import QtQuick
import QtQuick.Controls
import Cluster.Desktop

ComboBox {
    id: control
    property string accessibleName: ""
    Accessible.role: Accessible.ComboBox
    Accessible.name: accessibleName.length > 0 ? accessibleName : displayText
    activeFocusOnTab: true
    implicitHeight: Theme.controlHeight
    leftPadding: 12
    rightPadding: 34
    font.pixelSize: Theme.scaledFont(13)

    contentItem: Text {
        leftPadding: 0
        rightPadding: 0
        text: control.displayText
        font: control.font
        color: Theme.text
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }

    indicator: ClusterChevron {
        x: control.width - width - 10
        anchors.verticalCenter: parent.verticalCenter
        width: 16
        height: 16
        expanded: control.popup.visible
        strokeColor: Theme.textMuted
    }

    background: Rectangle {
        radius: Theme.radiusSmall
        color: control.hovered ? Theme.surfaceHover : Theme.surfaceStrong
        border.width: control.activeFocus ? (Theme.focusIndicator === "strong" || Theme.focusIndicator === "always" ? 3 : 2) : 1
        border.color: control.activeFocus ? Theme.focusRing : Theme.border
    }

    delegate: ItemDelegate {
        required property var modelData
        required property int index
        width: control.width
        implicitHeight: Theme.largeTargets ? Math.max(44, Math.round(34 * Theme.textScale)) : Math.max(34, Math.round(34 * Theme.textScale))
        highlighted: control.highlightedIndex === index
        Accessible.role: Accessible.ListItem
        Accessible.name: control.textAt(index)
        contentItem: Text {
            text: control.textAt(index)
            color: Theme.text
            font.pixelSize: Theme.scaledFont(13)
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
        }
        background: Rectangle {
            radius: 7
            color: parent.highlighted ? Theme.accentSurface : parent.hovered ? Theme.surfaceHover : "transparent"
        }
    }

    popup: Popup {
        y: control.height + 4
        width: control.width
        implicitHeight: Math.min(contentItem.implicitHeight + 10, 300)
        padding: 5
        contentItem: ListView {
            clip: true
            implicitHeight: contentHeight
            model: control.popup.visible ? control.delegateModel : null
            currentIndex: control.highlightedIndex
            ScrollIndicator.vertical: ScrollIndicator { }
        }
        background: Rectangle {
            radius: 10
            color: Theme.surfaceStrong
            border.width: 1
            border.color: Theme.border
        }
    }
}
