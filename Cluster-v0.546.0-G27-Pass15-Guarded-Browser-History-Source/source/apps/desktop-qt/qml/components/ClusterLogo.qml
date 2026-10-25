import QtQuick

Item {
    id: root
    implicitWidth: 48
    implicitHeight: 48
    Accessible.role: Accessible.Graphic
    Accessible.name: "Cluster logo"

    Image {
        anchors.fill: parent
        source: "qrc:/qt/qml/Cluster/Desktop/assets/cluster-logo.png"
        fillMode: Image.PreserveAspectFit
        smooth: true
        mipmap: true
        asynchronous: false
        cache: true
    }
}
