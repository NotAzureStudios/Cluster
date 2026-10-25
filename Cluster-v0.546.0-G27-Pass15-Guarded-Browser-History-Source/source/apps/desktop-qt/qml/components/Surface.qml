import QtQuick
import Cluster.Desktop

Rectangle {
    color: (Theme.highContrast || Theme.reducedTransparency) ? Theme.opaqueSurface : Theme.surface
    radius: Theme.radius
    border.width: 1
    border.color: Theme.border

    // Match the web material resolver: high-contrast surfaces are not translucent.
    gradient: Theme.reducedTransparency || Theme.highContrast ? null : surfaceGradient
    Gradient {
        id: surfaceGradient
        GradientStop { position: 0.0; color: Theme.dark ? "#12FFFFFF" : "#EFFFFFFF" }
        GradientStop { position: 1.0; color: Theme.dark ? "#08131C24" : "#BDEEF4F7" }
    }

    Rectangle {
        anchors { left: parent.left; right: parent.right; top: parent.top; margins: 1 }
        height: 1
        radius: parent.radius
        color: Theme.highContrast ? "transparent" : (Theme.dark ? "#18FFFFFF" : "#CFFFFFFF")
    }
}
