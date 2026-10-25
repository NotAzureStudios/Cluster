#pragma once

#include <QByteArray>
#include <QJsonArray>
#include <QJsonObject>
#include <QJsonValue>
#include <QStringList>
#include <QObject>
#include <QString>

#ifndef CLUSTER_WORKSTATION_PROTOCOL
#define CLUSTER_WORKSTATION_PROTOCOL 1
#endif

class QNetworkAccessManager;
class QNetworkReply;
class QProcess;
class QTimer;

/**
 * Owns the local Cluster Workstation helper process used by Desktop and editor
 * integrations. The helper keeps Git/Git LFS execution and credentials outside
 * the renderer and exposes a token-authenticated loopback API.
 */
class WorkstationServiceManager final : public QObject
{
    Q_OBJECT

public:
    explicit WorkstationServiceManager(QObject *parent = nullptr);
    ~WorkstationServiceManager() override;

    void start();
    void stop();

    bool available() const;
    int protocol() const { return CLUSTER_WORKSTATION_PROTOCOL; }
    QString endpoint() const;
    QString discoveryPath() const;

    QJsonObject status(QString *errorMessage = nullptr);
    QJsonObject requestCapability(const QString &capability, const QJsonObject &payload,
                                  QString *errorCode = nullptr, QString *errorMessage = nullptr);
    QJsonValue requestSourceControlAction(const QString &action, const QString &repositoryId,
                                          const QStringList &paths, const QJsonObject &input,
                                          QString *errorCode = nullptr, QString *errorMessage = nullptr);

signals:
    void serviceAvailabilityChanged(bool available);
    void operationSnapshotChanged(const QJsonArray &operations);

private:
    struct DiscoveryState {
        QString endpoint;
        QString token;
        QString version;
        qint64 pid = 0;
        bool valid = false;
    };

    DiscoveryState readDiscovery() const;
    bool waitForDiscovery(int timeoutMs);
    QJsonObject postJson(const QString &path, const QJsonObject &body, QString *errorCode, QString *errorMessage);
    QJsonValue postSourceControlJson(const QJsonObject &body, QString *errorCode, QString *errorMessage);
    QString helperPath() const;
    QString helperManifestPath() const;
    QString expectedVersion() const;
    bool helperIntegrityValid(QString *errorMessage = nullptr) const;
    bool probeDiscovery(const DiscoveryState &state, int timeoutMs = 900);
    QString stateDirectory() const;
    void scheduleOperationMonitor(int delayMs = 0);
    void pollOperationSnapshots();
    void handleOperationSnapshot(const QJsonArray &operations);
    bool hasActiveOperations(const QJsonArray &operations) const;

    QProcess *m_process = nullptr;
    QNetworkAccessManager *m_network = nullptr;
    QTimer *m_operationPollTimer = nullptr;
    bool m_operationPollInFlight = false;
    bool m_operationMonitorActive = false;
    int m_operationPollFailures = 0;
    QByteArray m_lastOperationSnapshot;
};
