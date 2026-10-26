#include "DeepLinkRouter.h"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QEvent>
#include <QFile>
#include <QFileInfo>
#include <QFileOpenEvent>
#include <QLocalServer>
#include <QLocalSocket>
#include <QStandardPaths>
#include <QTimer>

DeepLinkRouter::DeepLinkRouter(QObject *parent)
    : QObject(parent)
{
}

bool DeepLinkRouter::start(const QStringList &arguments)
{
    const QString name = serverName();
    QLocalSocket existing;
    existing.connectToServer(name, QIODevice::WriteOnly);
    if (existing.waitForConnected(180)) {
        const QByteArray payload = arguments.join(QChar(u'\n')).toUtf8() + QByteArrayLiteral("\n\0");
        existing.write(payload);
        existing.flush();
        existing.waitForBytesWritten(500);
        existing.disconnectFromServer();
        return false;
    }

    QLocalServer::removeServer(name);
    m_server = new QLocalServer(this);
    if (!m_server->listen(name))
        return true;
    connect(m_server, &QLocalServer::newConnection, this, &DeepLinkRouter::acceptConnection);
    QTimer::singleShot(0, this, [this, arguments] { dispatchArguments(arguments); });
    return true;
}

bool DeepLinkRouter::eventFilter(QObject *watched, QEvent *event)
{
    Q_UNUSED(watched)
    if (event->type() != QEvent::FileOpen)
        return false;
    const auto *openEvent = static_cast<QFileOpenEvent *>(event);
    if (openEvent->url().isValid())
        emit deepLinkReceived(openEvent->url());
    else if (!openEvent->file().isEmpty())
        dispatchArguments({openEvent->file()});
    return true;
}

QString DeepLinkRouter::serverName() const
{
    const QByteArray scope = QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation).toUtf8();
    const QByteArray suffix = QCryptographicHash::hash(scope, QCryptographicHash::Sha256).toHex().left(16);
    return QStringLiteral("ClusterDesktop-") + QString::fromLatin1(suffix);
}

QList<QUrl> DeepLinkRouter::linksFromArguments(const QStringList &arguments) const
{
    QList<QUrl> links;
    for (const QString &argument : arguments) {
        const QString trimmed = argument.trimmed();
        if (trimmed.startsWith(QStringLiteral("cluster://"), Qt::CaseInsensitive)) {
            const QUrl url(trimmed);
            if (url.isValid()) links.append(url);
            continue;
        }
        const QFileInfo info(trimmed);
        if (!info.exists() || info.suffix().compare(QStringLiteral("clusterlink"), Qt::CaseInsensitive) != 0)
            continue;
        QFile file(info.absoluteFilePath());
        if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
            continue;
        const QString firstLine = QString::fromUtf8(file.readLine()).trimmed();
        const QUrl url(firstLine);
        if (url.isValid() && url.scheme().compare(QStringLiteral("cluster"), Qt::CaseInsensitive) == 0)
            links.append(url);
    }
    return links;
}

void DeepLinkRouter::dispatchArguments(const QStringList &arguments)
{
    const QList<QUrl> links = linksFromArguments(arguments);
    if (links.isEmpty()) {
        if (arguments.size() > 1)
            emit activateRequested();
        return;
    }
    for (const QUrl &url : links)
        emit deepLinkReceived(url);
}

void DeepLinkRouter::acceptConnection()
{
    while (QLocalSocket *socket = m_server->nextPendingConnection()) {
        socket->setProperty("clusterPayload", QByteArray());
        connect(socket, &QLocalSocket::readyRead, this, [socket] {
            QByteArray payload = socket->property("clusterPayload").toByteArray();
            payload.append(socket->readAll());
            socket->setProperty("clusterPayload", payload);
        });
        connect(socket, &QLocalSocket::disconnected, this, [this, socket] {
            QByteArray payload = socket->property("clusterPayload").toByteArray();
            payload.append(socket->readAll());
            payload.replace('\0', '\n');
            dispatchArguments(QString::fromUtf8(payload).split(QChar(u'\n'), Qt::SkipEmptyParts));
            emit activateRequested();
            socket->deleteLater();
        });
    }
}
