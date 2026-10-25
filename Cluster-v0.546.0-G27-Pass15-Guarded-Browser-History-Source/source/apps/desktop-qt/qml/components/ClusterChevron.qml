import QtQuick
import Cluster.Desktop

// One native, source-owned icon primitive. Avoid depending on an unregistered glyph type.
Canvas {
    id: root
    implicitWidth: 16
    implicitHeight: 16
    property color strokeColor: Theme.textMuted
    property bool expanded: false
    Accessible.ignored: true
    rotation: expanded ? 180 : 0
    Behavior on rotation {
        enabled: !Theme.reducedMotion && !Theme.noMotion
        NumberAnimation { duration: 120; easing.type: Easing.OutCubic }
    }
    onStrokeColorChanged: requestPaint()
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()
    onPaint: {
        const ctx = getContext("2d")
        ctx.clearRect(0, 0, width, height)
        ctx.beginPath()
        ctx.strokeStyle = strokeColor.toString()
        ctx.lineWidth = 1.8
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.moveTo(width * 0.25, height * 0.42)
        ctx.lineTo(width * 0.5, height * 0.64)
        ctx.lineTo(width * 0.75, height * 0.42)
        ctx.stroke()
    }
}
