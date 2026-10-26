#include "AppController.h"
#include "ApiClient.h"
#include "CrashReporter.h"
#include "GlobalShortcutManager.h"
#include "LibraryMountManager.h"
#include "WorkstationServiceManager.h"

#include <QDesktopServices>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QTimer>
#include <QUrlQuery>
#include <algorithm>

namespace {
constexpr int ReconnectBaseDelayMs = 2'000;
constexpr int ReconnectMaximumDelayMs = 60'000;

bool safeRoute(const QString &value)
{
    if (value.isEmpty() || value.size() > 512) return false;
    for (const QChar c : value) {
        if (!(c.isLetterOrNumber() || QStringLiteral("_./:-").contains(c))) return false;
    }
    return true;
}
}

AppController::AppController(QObject *parent)
    : QObject(parent)
    , m_api(new ApiClient(this))
    , m_desktopPreferences(new DesktopPreferences(this))
    , m_updateManager(new NativeUpdateManager(m_desktopPreferences, this))
    , m_serverProfiles(new ServerProfileStore(this))
    , m_transferManager(new TransferManager(m_api, this))
    , m_libraryMountManager(new LibraryMountManager(m_api, m_serverProfiles, m_transferManager, this))
    , m_globalShortcuts(new GlobalShortcutManager(this))
    , m_workstationService(new WorkstationServiceManager(this))
    , m_nativeCapabilities(new NativeCapabilityBroker(this, this))
    , m_reconnectTimer(new QTimer(this))
{
    m_previousCrash = CrashReporter::previousCrash();
    m_startupDiagnostics = CrashReporter::startupDiagnostics();

    connect(m_api, &ApiClient::succeeded, this, &AppController::handleSuccess);
    connect(m_api, &ApiClient::failed, this, &AppController::handleFailure);
    connect(m_api, &ApiClient::serverMetadataChanged, this, &AppController::serverMetadataChanged);
    connect(m_api, &ApiClient::onlineChanged, this, [this] {
        emit connectionOnlineChanged();
        if (!m_api->online() && m_state == QStringLiteral("workspace")) scheduleReconnect();
    });
    connect(m_serverProfiles, &ServerProfileStore::rendererLoadFailed, this, [this](const QString &message) {
        if (m_state != QStringLiteral("workspace")) return;
        scheduleReconnect({
            {QStringLiteral("status"), 0},
            {QStringLiteral("code"), QStringLiteral("RENDERER_UNAVAILABLE")},
            {QStringLiteral("message"), message.isEmpty() ? QStringLiteral("The desktop renderer could not reach this Cluster Server.") : message},
            {QStringLiteral("retryable"), true},
        });
    });
    connect(m_serverProfiles, &ServerProfileStore::rendererLoadSucceeded, this, [this] {
        if (m_state == QStringLiteral("workspace") && m_reconnectTimer && m_reconnectTimer->isActive()) retryConnectionNow();
    });
    connect(m_serverProfiles, &ServerProfileStore::activeProfileChanged, this, [this] {
        clearNativeSession();
        if (m_libraryMountManager) m_libraryMountManager->forceStop();
    });

    m_reconnectTimer->setSingleShot(true);
    connect(m_reconnectTimer, &QTimer::timeout, this, &AppController::attemptReconnect);
}

QString AppController::state() const { return m_state; }
QString AppController::serverUrl() const { return m_serverUrl; }
QString AppController::statusText() const { return m_statusText; }
QVariantMap AppController::error() const { return m_error; }
bool AppController::busy() const { return m_busy; }
QString AppController::version() const { return QStringLiteral(CLUSTER_DESKTOP_VERSION); }
QVariantMap AppController::serverMetadata() const { return m_api->serverMetadata(); }
bool AppController::persistentSessionsAvailable() const { return m_api->persistentSessionsAvailable(); }
bool AppController::connectionOnline() const { return m_api->online(); }
DesktopPreferences *AppController::desktopPreferences() const { return m_desktopPreferences; }
NativeUpdateManager *AppController::updateManager() const { return m_updateManager; }
ServerProfileStore *AppController::serverProfiles() const { return m_serverProfiles; }
NativeCapabilityBroker *AppController::nativeCapabilities() const { return m_nativeCapabilities; }
TransferManager *AppController::transferManager() const { return m_transferManager; }
LibraryMountManager *AppController::libraryMountManager() const { return m_libraryMountManager; }
GlobalShortcutManager *AppController::globalShortcuts() const { return m_globalShortcuts; }
WorkstationServiceManager *AppController::workstationService() const { return m_workstationService; }
int AppController::unreadNotificationCount() const { return m_unreadNotificationCount; }
QVariantMap AppController::previousCrash() const { return m_previousCrash; }
QVariantMap AppController::startupDiagnostics() const { return m_startupDiagnostics; }
bool AppController::nativeSessionReady() const { return m_nativeSessionReady; }

QVariantMap AppController::connectionRecovery() const
{
    return {
        {QStringLiteral("state"), m_connectionRecoveryState},
        {QStringLiteral("attempt"), m_reconnectAttempt},
        {QStringLiteral("delayMs"), m_reconnectDelayMs},
        {QStringLiteral("nextRetryAt"), m_nextReconnectAt.isValid() ? m_nextReconnectAt.toUTC().toString(Qt::ISODateWithMs) : QString()},
        {QStringLiteral("lastConnectedAt"), m_lastConnectedAt.isValid() ? m_lastConnectedAt.toUTC().toString(Qt::ISODateWithMs) : QString()},
        {QStringLiteral("scheduled"), m_reconnectTimer && m_reconnectTimer->isActive()},
    };
}

void AppController::setServerUrl(const QString &value)
{
    if (m_serverUrl == value) return;
    m_serverUrl = value;
    emit serverUrlChanged();
}

void AppController::initialize()
{
    if (m_workstationService) m_workstationService->start();
    setServerUrl(m_serverProfiles->activeServerUrl());
    startServerBootstrap(true);
}

void AppController::connectToServer() { startServerBootstrap(true); }

void AppController::retryConnectionNow()
{
    if (m_busy) return;
    if (m_reconnectTimer->isActive()) m_reconnectTimer->stop();
    m_nextReconnectAt = {};
    m_reconnectDelayMs = 0;
    emit connectionRecoveryChanged();
    attemptReconnect();
}

void AppController::startServerBootstrap(bool resetBackoff)
{
    if (resetBackoff) resetReconnectState(true);
    clearError();
    clearNativeSession();

    QString validationError;
    const QString normalizedServerUrl = ServerProfileStore::normalizeServerUrl(m_serverUrl, &validationError);
    const QString profileId = m_serverProfiles->activeProfileId();
    const QString profileDataPath = m_serverProfiles->activeNativeDataPath();
    const bool profileReady = !normalizedServerUrl.isEmpty() && m_api->setProfileContext(profileId, profileDataPath, &validationError);
    if (!profileReady || !m_api->setBaseUrl(normalizedServerUrl, &validationError)) {
        setError({{QStringLiteral("code"), QStringLiteral("INVALID_SERVER_URL")}, {QStringLiteral("message"), validationError}, {QStringLiteral("retryable"), false}});
        setState(QStringLiteral("server"));
        return;
    }

    setServerUrl(m_api->baseUrl());
    if (ServerProfileStore::profileIdForUrl(m_serverUrl) != m_serverProfiles->activeProfileId()) {
        m_serverProfiles->switchServer(m_serverUrl);
        return;
    }

    m_transferManager->setProfileDataRoot(profileDataPath);
    m_transferManager->setScope(m_serverUrl + QStringLiteral("|native-unclaimed"));
    m_libraryMountManager->setProfileContext(profileId, profileDataPath, m_serverUrl);

    m_connectionRecoveryState = QStringLiteral("connecting");
    emit connectionRecoveryChanged();
    setState(QStringLiteral("connecting"));
    setBusy(true, m_reconnectAttempt > 0 ? QStringLiteral("Reconnecting to Cluster Server…") : QStringLiteral("Contacting Cluster Server…"));
    m_api->getJson(QStringLiteral("health"), QStringLiteral("/health"));
}

void AppController::useDifferentServer()
{
    resetReconnectState(true);
    clearNativeSession();
    if (m_libraryMountManager) m_libraryMountManager->forceStop();
    setBusy(false);
    clearError();
    setState(QStringLiteral("server"));
}

bool AppController::isAllowedRendererUrl(const QString &url) const
{
    return m_serverProfiles && m_serverProfiles->isUrlAllowedForActiveProfile(url);
}

void AppController::openExternalUrl(const QString &url)
{
    const QUrl target(url);
    if (!target.isValid()) return;
    const QString scheme = target.scheme().toLower();
    if (scheme == QStringLiteral("https") || scheme == QStringLiteral("http") || scheme == QStringLiteral("mailto")) QDesktopServices::openUrl(target);
}

void AppController::updateRendererStateJson(const QString &json)
{
    if (json.isEmpty() || json.size() > 4096) return;
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) return;
    const QJsonObject object = document.object();
    if (object.value(QStringLiteral("schema")).toInt(-1) != 2) return;
    const QJsonValue unreadValue = object.value(QStringLiteral("unreadNotifications"));
    if (!unreadValue.isDouble()) return;

    const QString activeRoute = object.value(QStringLiteral("activeRoute")).toString();
    m_serverProfiles->updateRendererIdentity(
        object.value(QStringLiteral("serverLabel")).toString(),
        object.value(QStringLiteral("userLabel")).toString(),
        activeRoute.isEmpty() ? object.value(QStringLiteral("activeScreen")).toString() : activeRoute,
        object.value(QStringLiteral("activeInspector")).toString());
    const QString projectId = object.value(QStringLiteral("activeProjectId")).toString().trimmed();
    const QString projectName = object.value(QStringLiteral("activeProjectName")).toString().trimmed();
    if (!projectId.isEmpty() && !projectName.isEmpty() && !activeRoute.isEmpty()) {
        const QString kind = activeRoute.startsWith(QStringLiteral("board/")) ? QStringLiteral("board")
            : activeRoute.startsWith(QStringLiteral("whiteboard/")) ? QStringLiteral("whiteboard") : QStringLiteral("project");
        m_serverProfiles->recordRecentWorkspace(activeRoute, projectName, kind, projectId);
    }

    const int unread = std::clamp(unreadValue.toInt(0), 0, 100000);
    if (m_unreadNotificationCount != unread) {
        m_unreadNotificationCount = unread;
        emit unreadNotificationCountChanged();
    }
}

void AppController::clearError()
{
    if (m_error.isEmpty()) return;
    m_error.clear();
    emit errorChanged();
}

bool AppController::claimNativeSession(const QString &oneTimeCode)
{
    const QString code = oneTimeCode.trimmed();
    if (code.size() < 32 || code.size() > 256 || m_serverUrl.isEmpty()) return false;
    m_api->postJson(QStringLiteral("desktopSessionRedeem"), QStringLiteral("/api/auth/desktop-session-redeem"), {{QStringLiteral("code"), code}});
    return true;
}

void AppController::clearNativeSession()
{
    m_api->setCsrfToken(QString());
    if (m_transferManager) m_transferManager->setScope(QString());
    if (m_libraryMountManager) m_libraryMountManager->setAuthenticatedUser(QString());
    if (!m_nativeSessionReady) return;
    m_nativeSessionReady = false;
    emit nativeSessionReadyChanged();
}

QString AppController::routeFromDeepLink(const QUrl &url) const
{
    if (!url.isValid() || url.scheme().compare(QStringLiteral("cluster"), Qt::CaseInsensitive) != 0) return {};
    // Resource identifiers are not renderer hash routes. Forward the complete,
    // bounded URI to the shared parser in the renderer, never just host/path.
    const QString host = url.host().toLower();
    const QStringList resourceHosts = {
        QStringLiteral("resource"), QStringLiteral("project"), QStringLiteral("ticket"),
        QStringLiteral("library"), QStringLiteral("repo"), QStringLiteral("build"),
        QStringLiteral("person"), QStringLiteral("whiteboard")
    };
    if (resourceHosts.contains(host)) {
        if (url.hasQuery() || url.hasFragment() || !url.userName().isEmpty() ||
            !url.password().isEmpty() || url.port() != -1) return {};
        const QString encoded = url.toString(QUrl::FullyEncoded);
        return encoded.startsWith(QStringLiteral("cluster://"), Qt::CaseInsensitive) && safeRoute(encoded)
            ? encoded : QString();
    }
    QUrlQuery query(url);
    QString route = query.queryItemValue(QStringLiteral("route"));
    if (route.isEmpty()) route = query.queryItemValue(QStringLiteral("screen"));
    if (route.isEmpty()) {
        const QString host = url.host().trimmed();
        const QString path = url.path().mid(url.path().startsWith(QLatin1Char('/')) ? 1 : 0);
        route = path.isEmpty() ? host : host + QLatin1Char('/') + path;
    }
    return safeRoute(route) ? route : QString();
}

void AppController::openDeepLink(const QUrl &url)
{
    emit activateWindowRequested();
    const QString route = routeFromDeepLink(url);
    if (!route.isEmpty()) emit deepLinkRouteRequested(route);
}

void AppController::handleSuccess(const QString &operation, const QJsonValue &payload)
{
    if (operation == QStringLiteral("health") || operation == QStringLiteral("reconnectProbe")) {
        m_connectionRecoveryState = QStringLiteral("validating");
        emit connectionRecoveryChanged();
        setBusy(true, QStringLiteral("Checking client compatibility…"));
        m_api->getJson(operation == QStringLiteral("health") ? QStringLiteral("compatibility") : QStringLiteral("reconnectCompatibility"),
                       QStringLiteral("/api/meta/compatibility?clientVersion=%1").arg(QStringLiteral(CLUSTER_DESKTOP_VERSION)));
        return;
    }
    if (operation == QStringLiteral("compatibility") || operation == QStringLiteral("reconnectCompatibility")) {
        const QJsonObject object = payload.toObject();
        if (!object.value(QStringLiteral("compatible")).toBool(false)) {
            resetReconnectState(false);
            setBusy(false);
            setError({{QStringLiteral("code"), QStringLiteral("CLIENT_UPGRADE_REQUIRED")},
                      {QStringLiteral("message"), object.value(QStringLiteral("reason")).toString(QStringLiteral("This desktop version is not compatible with the server."))},
                      {QStringLiteral("retryable"), false}});
            setState(QStringLiteral("server"));
            return;
        }
        if (operation == QStringLiteral("reconnectCompatibility")) {
            markConnectionHealthy();
            emit connectionRecovered();
            return;
        }
        setBusy(true, QStringLiteral("Checking instance setup…"));
        m_api->getJson(QStringLiteral("setupStatus"), QStringLiteral("/api/setup/status"));
        return;
    }
    if (operation == QStringLiteral("setupStatus")) {
        markConnectionHealthy();
        setState(payload.toObject().value(QStringLiteral("setupComplete")).toBool(false) ? QStringLiteral("workspace") : QStringLiteral("setup"));
        return;
    }
    if (operation == QStringLiteral("desktopSessionRedeem")) {
        const QJsonObject object = payload.toObject();
        const QString csrf = object.value(QStringLiteral("csrfToken")).toString();
        const QString userId = object.value(QStringLiteral("userId")).toString();
        if (csrf.isEmpty() || userId.isEmpty()) {
            clearNativeSession();
            return;
        }
        m_api->setCsrfToken(csrf);
        m_transferManager->setScope(m_serverUrl + QLatin1Char('|') + userId);
        m_libraryMountManager->setAuthenticatedUser(userId);
        if (!m_nativeSessionReady) {
            m_nativeSessionReady = true;
            emit nativeSessionReadyChanged();
        }
        return;
    }
}

void AppController::handleFailure(const QString &operation, const QVariantMap &error)
{
    if (operation == QStringLiteral("desktopSessionRedeem")) {
        clearNativeSession();
        return;
    }
    if (operation == QStringLiteral("health") || operation == QStringLiteral("compatibility") || operation == QStringLiteral("setupStatus")
        || operation == QStringLiteral("reconnectProbe") || operation == QStringLiteral("reconnectCompatibility")) {
        setBusy(false, QStringLiteral("Offline"));
        const int status = error.value(QStringLiteral("status")).toInt();
        const bool retryable = error.value(QStringLiteral("retryable")).toBool() || status == 0 || status == 408 || status == 429 || status >= 500;
        if (retryable) {
            if (m_state != QStringLiteral("workspace")) setState(QStringLiteral("connecting"));
            scheduleReconnect(error);
        } else {
            resetReconnectState(false);
            setError(error);
            setState(QStringLiteral("server"));
        }
    }
}

void AppController::attemptReconnect()
{
    m_nextReconnectAt = {};
    m_reconnectDelayMs = 0;
    emit connectionRecoveryChanged();
    if (m_state == QStringLiteral("workspace")) probeReconnect();
    else if (!m_serverUrl.trimmed().isEmpty()) startServerBootstrap(false);
}

void AppController::probeReconnect()
{
    m_connectionRecoveryState = QStringLiteral("probing");
    emit connectionRecoveryChanged();
    setBusy(true, QStringLiteral("Checking Cluster Server…"));
    m_api->getJson(QStringLiteral("reconnectProbe"), QStringLiteral("/health"));
}

void AppController::scheduleReconnect(const QVariantMap &error)
{
    if (!m_reconnectTimer || m_serverUrl.trimmed().isEmpty() || m_reconnectTimer->isActive()) return;
    if (!error.isEmpty()) setError(error);
    ++m_reconnectAttempt;
    const int shift = std::min(m_reconnectAttempt - 1, 5);
    m_reconnectDelayMs = std::min(ReconnectMaximumDelayMs, ReconnectBaseDelayMs * (1 << shift));
    m_nextReconnectAt = QDateTime::currentDateTimeUtc().addMSecs(m_reconnectDelayMs);
    m_connectionRecoveryState = QStringLiteral("waiting");
    m_reconnectTimer->start(m_reconnectDelayMs);
    setBusy(false, QStringLiteral("Reconnect scheduled"));
    emit connectionRecoveryChanged();
}

void AppController::resetReconnectState(bool clearAttempts)
{
    if (m_reconnectTimer && m_reconnectTimer->isActive()) m_reconnectTimer->stop();
    if (clearAttempts) m_reconnectAttempt = 0;
    m_reconnectDelayMs = 0;
    m_nextReconnectAt = {};
    m_connectionRecoveryState = QStringLiteral("idle");
    emit connectionRecoveryChanged();
}

void AppController::markConnectionHealthy()
{
    if (m_reconnectTimer && m_reconnectTimer->isActive()) m_reconnectTimer->stop();
    m_lastConnectedAt = QDateTime::currentDateTimeUtc();
    m_reconnectAttempt = 0;
    m_reconnectDelayMs = 0;
    m_nextReconnectAt = {};
    m_connectionRecoveryState = QStringLiteral("idle");
    clearError();
    setBusy(false, QStringLiteral("Connected"));
    emit connectionRecoveryChanged();
}

void AppController::setState(const QString &state)
{
    if (m_state == state) return;
    m_state = state;
    emit stateChanged();
}

void AppController::setBusy(bool busy, const QString &status)
{
    if (m_busy != busy) { m_busy = busy; emit busyChanged(); }
    if (m_statusText != status) { m_statusText = status; emit statusChanged(); }
}

void AppController::setError(const QVariantMap &error)
{
    m_error = error;
    emit errorChanged();
}
