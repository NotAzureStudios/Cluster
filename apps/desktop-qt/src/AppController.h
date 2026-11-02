#pragma once

#include "DesktopPreferences.h"
#include "GlobalShortcutManager.h"
#include "LibraryMountManager.h"
#include "NativeCapabilityBroker.h"
#include "NativeUpdateManager.h"
#include "ServerProfileStore.h"
#include "TransferManager.h"

#include <QDateTime>
#include <QJsonValue>
#include <QObject>
#include <QUrl>
#include <QVariantMap>

class ApiClient;
class GlobalShortcutManager;
class LibraryMountManager;
class QTimer;
class WorkstationServiceManager;

class AppController final : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString state READ state NOTIFY stateChanged)
    Q_PROPERTY(QString serverUrl READ serverUrl WRITE setServerUrl NOTIFY serverUrlChanged)
    Q_PROPERTY(QString statusText READ statusText NOTIFY statusChanged)
    Q_PROPERTY(QVariantMap error READ error NOTIFY errorChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(QString version READ version CONSTANT)
    Q_PROPERTY(QVariantMap serverMetadata READ serverMetadata NOTIFY serverMetadataChanged)
    Q_PROPERTY(bool persistentSessionsAvailable READ persistentSessionsAvailable CONSTANT)
    Q_PROPERTY(bool connectionOnline READ connectionOnline NOTIFY connectionOnlineChanged)
    Q_PROPERTY(QVariantMap connectionRecovery READ connectionRecovery NOTIFY connectionRecoveryChanged)
    Q_PROPERTY(DesktopPreferences* desktopPreferences READ desktopPreferences CONSTANT)
    Q_PROPERTY(NativeUpdateManager* updateManager READ updateManager CONSTANT)
    Q_PROPERTY(ServerProfileStore* serverProfiles READ serverProfiles CONSTANT)
    Q_PROPERTY(NativeCapabilityBroker* nativeCapabilities READ nativeCapabilities CONSTANT)
    Q_PROPERTY(TransferManager* transferManager READ transferManager CONSTANT)
    Q_PROPERTY(LibraryMountManager* libraryMountManager READ libraryMountManager CONSTANT)
    Q_PROPERTY(GlobalShortcutManager* globalShortcuts READ globalShortcuts CONSTANT)
    Q_PROPERTY(int unreadNotificationCount READ unreadNotificationCount NOTIFY unreadNotificationCountChanged)
    Q_PROPERTY(QVariantMap previousCrash READ previousCrash CONSTANT)
    Q_PROPERTY(QVariantMap startupDiagnostics READ startupDiagnostics CONSTANT)
    Q_PROPERTY(bool nativeSessionReady READ nativeSessionReady NOTIFY nativeSessionReadyChanged)

public:
    explicit AppController(QObject *parent = nullptr);

    QString state() const;
    QString serverUrl() const;
    void setServerUrl(const QString &value);
    QString statusText() const;
    QVariantMap error() const;
    bool busy() const;
    QString version() const;
    QVariantMap serverMetadata() const;
    bool persistentSessionsAvailable() const;
    bool connectionOnline() const;
    QVariantMap connectionRecovery() const;
    DesktopPreferences *desktopPreferences() const;
    NativeUpdateManager *updateManager() const;
    ServerProfileStore *serverProfiles() const;
    NativeCapabilityBroker *nativeCapabilities() const;
    TransferManager *transferManager() const;
    LibraryMountManager *libraryMountManager() const;
    GlobalShortcutManager *globalShortcuts() const;
    WorkstationServiceManager *workstationService() const;
    int unreadNotificationCount() const;
    QVariantMap previousCrash() const;
    QVariantMap startupDiagnostics() const;
    bool nativeSessionReady() const;

    Q_INVOKABLE void initialize();
    Q_INVOKABLE void connectToServer();
    Q_INVOKABLE void retryConnectionNow();
    Q_INVOKABLE void useDifferentServer();
    Q_INVOKABLE bool isAllowedRendererUrl(const QString &url) const;
    Q_INVOKABLE void openExternalUrl(const QString &url);
    Q_INVOKABLE void updateRendererStateJson(const QString &json);
    Q_INVOKABLE void clearError();
    Q_INVOKABLE void openDeepLink(const QUrl &url);
    Q_INVOKABLE bool claimNativeSession(const QString &oneTimeCode);

signals:
    void stateChanged();
    void serverUrlChanged();
    void statusChanged();
    void errorChanged();
    void busyChanged();
    void serverMetadataChanged();
    void connectionOnlineChanged();
    void connectionRecoveryChanged();
    void connectionRecovered();
    void unreadNotificationCountChanged();
    void nativeSessionReadyChanged();
    void activateWindowRequested();
    void deepLinkRouteRequested(const QString &route);

private:
    void setState(const QString &state);
    void setBusy(bool busy, const QString &status = {});
    void setError(const QVariantMap &error);
    void handleSuccess(const QString &operation, const QJsonValue &payload);
    void handleFailure(const QString &operation, const QVariantMap &error);
    void startServerBootstrap(bool resetBackoff);
    void attemptReconnect();
    void probeReconnect();
    void scheduleReconnect(const QVariantMap &error = {});
    void resetReconnectState(bool clearAttempts = true);
    void markConnectionHealthy();
    void clearNativeSession();
    QString routeFromDeepLink(const QUrl &url) const;

    ApiClient *m_api = nullptr;
    DesktopPreferences *m_desktopPreferences = nullptr;
    NativeUpdateManager *m_updateManager = nullptr;
    ServerProfileStore *m_serverProfiles = nullptr;
    TransferManager *m_transferManager = nullptr;
    LibraryMountManager *m_libraryMountManager = nullptr;
    GlobalShortcutManager *m_globalShortcuts = nullptr;
    WorkstationServiceManager *m_workstationService = nullptr;
    NativeCapabilityBroker *m_nativeCapabilities = nullptr;
    QTimer *m_reconnectTimer = nullptr;

    QString m_state = QStringLiteral("server");
    QString m_serverUrl;
    QString m_statusText;
    QVariantMap m_error;
    bool m_busy = false;
    int m_unreadNotificationCount = 0;
    QVariantMap m_previousCrash;
    QVariantMap m_startupDiagnostics;
    bool m_nativeSessionReady = false;
    int m_reconnectAttempt = 0;
    int m_reconnectDelayMs = 0;
    QString m_connectionRecoveryState = QStringLiteral("idle");
    QDateTime m_nextReconnectAt;
    QDateTime m_lastConnectedAt;
};
