#pragma once

#include <QObject>
#include <QUrl>

class QLocalServer;
class QEvent;

class DeepLinkRouter final : public QObject
{
    Q_OBJECT

public:
    explicit DeepLinkRouter(QObject *parent = nullptr);
    bool start(const QStringList &arguments);
    bool eventFilter(QObject *watched, QEvent *event) override;

signals:
    void deepLinkReceived(const QUrl &url);
    void activateRequested();

private:
    QString serverName() const;
    QList<QUrl> linksFromArguments(const QStringList &arguments) const;
    void dispatchArguments(const QStringList &arguments);
    void acceptConnection();

    QLocalServer *m_server = nullptr;
};
