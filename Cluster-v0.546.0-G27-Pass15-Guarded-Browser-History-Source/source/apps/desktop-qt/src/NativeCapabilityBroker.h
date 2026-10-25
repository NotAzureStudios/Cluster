#pragma once

#include <QHash>
#include <QJsonArray>
#include <QJsonObject>
#include <QJsonValue>
#include <QObject>
#include <QPointer>
#include <QQueue>
#include <QString>
#include <QStringList>
#include <QSet>
#include <QVariantList>

class AppController;
class QFileSystemWatcher;
class QProcess;
class QTemporaryFile;

class NativeCapabilityBroker final : public QObject
{
    Q_OBJECT
    Q_PROPERTY(int protocolVersion READ protocolVersion CONSTANT)
    Q_PROPERTY(QStringList capabilities READ capabilities CONSTANT)

public:
    explicit NativeCapabilityBroker(AppController *controller, QObject *parent = nullptr);

    int protocolVersion() const { return 3; }
    QStringList capabilities() const;

    Q_INVOKABLE void processRequestJson(const QString &requestJson, const QString &rendererUrl);
    Q_INVOKABLE void acceptDroppedUrls(const QVariantList &urls);

signals:
    void responseReady(const QString &responseJson);
    void eventReady(const QString &eventJson);
    void notificationRequested(const QString &title, const QString &body, const QString &route,
                               const QString &tag, const QString &priority);
    void showAppSettingsRequested();
    void showServerProfilesRequested();
    void reloadRendererRequested();
    void navigateBackRequested();
    void navigateForwardRequested();

private:
    struct LocalHandle {
        QString path;
        QString profileId;
        qint64 expiresAtMs = 0;
        bool directory = false;
        bool writableDestination = false;
    };

    QString successResponse(const QString &id, const QJsonValue &result = QJsonValue()) const;
    QString errorResponse(const QString &id, const QString &code, const QString &message) const;
    bool acceptRequestId(const QString &id);
    bool consumeRequestBudget();
    bool consumeNotificationBudget();
    bool consumeDialogBudget();
    void purgeExpiredHandles();
    QString issueHandle(const QString &path, bool directory);
    QString issueDestinationHandle(const QString &path);
    const LocalHandle *resolveHandle(const QString &handle) const;
    QJsonObject describeHandle(const QString &handle, const LocalHandle &record) const;
    QJsonObject runtimeInfo() const;
    QJsonArray safeTransferItems() const;
    void publishTransferEvent();
    QJsonValue dispatch(const QString &capability, const QJsonObject &payload, QString *errorCode, QString *errorMessage);
    void writeAudit(const QString &capability, bool ok, const QString &detail = QString()) const;
    void clearWatches();
    void publishWatchEvent(const QString &path, const QString &kind);
    void rotateBrokerEpoch();
    void clearTransientCapabilityState();
    bool validatePayloadShape(const QString &capability, const QJsonObject &payload, QString *errorMessage) const;

    AppController *m_controller = nullptr;
    QHash<QString, LocalHandle> m_handles;
    QQueue<QString> m_handleOrder;
    QSet<QString> m_seenRequestIds;
    QQueue<QString> m_seenRequestOrder;
    QQueue<qint64> m_requestTimes;
    QQueue<qint64> m_notificationTimes;
    QSet<QString> m_seenNotificationTags;
    QQueue<QString> m_seenNotificationTagOrder;
    QQueue<qint64> m_dialogTimes;
    QFileSystemWatcher *m_fileWatcher = nullptr;
    QHash<QString, QString> m_watchPaths;
    QHash<QString, QString> m_watchKinds;
    QString m_brokerEpoch;
    QPointer<QProcess> m_packageStageProcess;
    QJsonObject m_packageStageStatus;
    // Bounded, ephemeral ZIP handoff. Never accept renderer paths, signing pins,
    // privileged operations or filesystem locations through this buffer.
    QPointer<QTemporaryFile> m_packageIncomingKit;
    QString m_packageIncomingId;
    QString m_packageIncomingProfile;
    QString m_packageIncomingReleaseSha;
    QString m_packageIncomingKey;
    QString m_packageIncomingVersion;
    QString m_packageIncomingKitSha;
    qint64 m_packageIncomingExpectedBytes = 0;
    qint64 m_packageIncomingReceivedBytes = 0;
    qint64 m_packageIncomingStartedAt = 0;
    bool m_packageIncomingReady = false;
};
