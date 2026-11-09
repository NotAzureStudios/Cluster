#include "ServerProfileStore.h"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDateTime>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSettings>
#include <QThread>
#include <QUrl>

#include <algorithm>

#ifdef Q_OS_WIN
#include <windows.h>
#else
#include <cerrno>
#include <csignal>
#include <unistd.h>
#endif

namespace {
constexpr int RegistrySchemaVersion = 4;
constexpr int MaxServerProfiles = 32;
constexpr int RecoveryFailureThreshold = 3;
constexpr int MaximumStoredErrorLength = 320;
constexpr int MaximumLabelLength = 80;
constexpr int MaximumIdentityLength = 120;
constexpr int MaximumRouteLength = 420;
constexpr int MaximumInspectorLength = 220;
constexpr int MaximumRecentWorkspaces = 12;
constexpr int MaximumRecentTitleLength = 120;

QString isoNow()
{
    return QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
}

QString localDataRoot()
{
#ifdef Q_OS_WIN
    QString base = qEnvironmentVariable("LOCALAPPDATA").trimmed();
    if (base.isEmpty()) base = QDir::homePath() + QStringLiteral("/AppData/Local");
    return QDir::cleanPath(base + QStringLiteral("/Cluster"));
#elif defined(Q_OS_MACOS)
    return QDir::cleanPath(QDir::homePath() + QStringLiteral("/Library/Application Support/Cluster"));
#else
    QString base = qEnvironmentVariable("XDG_DATA_HOME").trimmed();
    if (base.isEmpty()) base = QDir::homePath() + QStringLiteral("/.local/share");
    return QDir::cleanPath(base + QStringLiteral("/cluster"));
#endif
}

QString registryFilePath()
{
    return localDataRoot() + QStringLiteral("/profiles.json");
}

QString sessionMarkerRoot()
{
    return localDataRoot() + QStringLiteral("/profile-sessions");
}

QString nativeProfileDataRoot()
{
    return localDataRoot() + QStringLiteral("/Profiles");
}

QString nativeProfilePathForId(const QString &profileId)
{
    return QDir::cleanPath(nativeProfileDataRoot() + QLatin1Char('/') + profileId);
}

void removeLegacyApiSession(const QString &origin)
{
    if (origin.isEmpty()) return;
    const QString key = QString::fromLatin1(QCryptographicHash::hash(origin.toUtf8(), QCryptographicHash::Sha256).toHex());
    QSettings settings;
    settings.beginGroup(QStringLiteral("sessions"));
    settings.remove(key);
    settings.endGroup();
    settings.sync();
}


QString recentWorkspacesPath(const QString &nativeProfilePath)
{
    return QDir::cleanPath(nativeProfilePath + QStringLiteral("/recent-workspaces.json"));
}

QJsonArray readRecentWorkspaceArray(const QString &nativeProfilePath)
{
    QFile file(recentWorkspacesPath(nativeProfilePath));
    if (!file.open(QIODevice::ReadOnly)) return {};
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll());
    return document.isArray() ? document.array() : QJsonArray{};
}

bool writeRecentWorkspaceArray(const QString &nativeProfilePath, const QJsonArray &items)
{
    if (nativeProfilePath.isEmpty()) return false;
    if (!QDir().mkpath(nativeProfilePath)) return false;
    QSaveFile file(recentWorkspacesPath(nativeProfilePath));
    if (!file.open(QIODevice::WriteOnly)) return false;
    if (file.write(QJsonDocument(items).toJson(QJsonDocument::Indented)) < 0) return false;
    return file.commit();
}

QString sessionMarkerPath(const QString &profileId)
{
    return QDir::cleanPath(sessionMarkerRoot() + QLatin1Char('/') + profileId + QStringLiteral(".json"));
}

bool loopbackHost(const QString &host)
{
    const QString normalized = host.trimmed().toLower();
    return normalized == QStringLiteral("localhost") || normalized == QStringLiteral("127.0.0.1") || normalized == QStringLiteral("::1");
}

bool allowInsecureRemoteHttp()
{
    const QString value = qEnvironmentVariable("CLUSTER_DESKTOP_ALLOW_INSECURE_HTTP").trimmed().toLower();
    return value == QStringLiteral("1") || value == QStringLiteral("true") || value == QStringLiteral("yes") || value == QStringLiteral("on");
}

bool validProfileId(const QString &value)
{
    if (!value.startsWith(QStringLiteral("server-")) || value.size() != 31) return false;
    for (qsizetype index = 7; index < value.size(); ++index) {
        const QChar c = value.at(index);
        if (!c.isDigit() && !(c >= QLatin1Char('a') && c <= QLatin1Char('f'))) return false;
    }
    return true;
}

QString safeLabel(const QString &value, int maximum = MaximumLabelLength)
{
    QString result = value.trimmed();
    return result.left(maximum);
}

QString safeRoute(const QString &value)
{
    QString route = value.trimmed();
    while (route.startsWith(QLatin1Char('#'))) route.remove(0, 1);
    if (route.size() > MaximumRouteLength) route = route.left(MaximumRouteLength);
    for (const QChar c : route) {
        if (!(c.isLetterOrNumber() || c == QLatin1Char('-') || c == QLatin1Char('_') || c == QLatin1Char('/') || c == QLatin1Char(':') || c == QLatin1Char('.')))
            return {};
    }
    return route;
}

QString safeInspector(const QString &value)
{
    const QString inspector = value.trimmed().left(MaximumInspectorLength);
    if (inspector.isEmpty()) return {};
    static const QRegularExpression pattern(QStringLiteral("^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9._:-]{1,160}$"));
    return pattern.match(inspector).hasMatch() ? inspector : QString();
}

QJsonObject readRegistry()
{
    QFile file(registryFilePath());
    if (!file.open(QIODevice::ReadOnly)) return {};
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll());
    return document.isObject() ? document.object() : QJsonObject{};
}

bool writeRegistry(const QJsonObject &registry)
{
    QDir().mkpath(localDataRoot());
    QSaveFile file(registryFilePath());
    if (!file.open(QIODevice::WriteOnly)) return false;
    if (file.write(QJsonDocument(registry).toJson(QJsonDocument::Indented)) < 0) return false;
    return file.commit();
}

QString commandLineProfileId(int argc, char *argv[])
{
    for (int index = 1; index < argc; ++index) {
        const QString value = QString::fromLocal8Bit(argv[index]);
        if (value == QStringLiteral("--profile") && index + 1 < argc)
            return QString::fromLocal8Bit(argv[index + 1]).trimmed();
        if (value.startsWith(QStringLiteral("--profile=")))
            return value.mid(QStringLiteral("--profile=").size()).trimmed();
    }
    return {};
}

qint64 commandLineWaitPid(int argc, char *argv[])
{
    for (int index = 1; index < argc; ++index) {
        const QString value = QString::fromLocal8Bit(argv[index]);
        QString candidate;
        if (value == QStringLiteral("--wait-for-pid") && index + 1 < argc)
            candidate = QString::fromLocal8Bit(argv[index + 1]).trimmed();
        else if (value.startsWith(QStringLiteral("--wait-for-pid=")))
            candidate = value.mid(QStringLiteral("--wait-for-pid=").size()).trimmed();
        if (!candidate.isEmpty()) {
            bool ok = false;
            const qint64 pid = candidate.toLongLong(&ok);
            return ok && pid > 0 ? pid : 0;
        }
    }
    return 0;
}

qint64 currentProcessId()
{
#ifdef Q_OS_WIN
    return static_cast<qint64>(GetCurrentProcessId());
#else
    return static_cast<qint64>(::getpid());
#endif
}

bool processIsAlive(qint64 pid)
{
    if (pid <= 0) return false;
#ifdef Q_OS_WIN
    if (pid > 0xffffffffLL) return false;
    HANDLE process = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid));
    if (!process) return false;
    DWORD code = 0;
    const bool alive = GetExitCodeProcess(process, &code) && code == STILL_ACTIVE;
    CloseHandle(process);
    return alive;
#else
    const int result = ::kill(static_cast<pid_t>(pid), 0);
    return result == 0 || errno == EPERM;
#endif
}

void waitForPreviousDesktopProcess(qint64 pid)
{
#ifdef Q_OS_WIN
    if (pid <= 0 || pid > 0xffffffffLL) return;
    HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(pid));
    if (!process) return;
    WaitForSingleObject(process, 10000);
    CloseHandle(process);
#else
    if (pid <= 0) return;
    for (int attempt = 0; attempt < 100 && processIsAlive(pid); ++attempt)
        QThread::msleep(100);
#endif
}

QJsonObject readSessionMarker(const QString &profileId)
{
    if (!validProfileId(profileId)) return {};
    QFile file(sessionMarkerPath(profileId));
    if (!file.open(QIODevice::ReadOnly)) return {};
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll());
    return document.isObject() ? document.object() : QJsonObject{};
}

void writeSessionMarker(const QString &profileId)
{
    if (!validProfileId(profileId)) return;
    QDir().mkpath(sessionMarkerRoot());
    QSaveFile file(sessionMarkerPath(profileId));
    if (!file.open(QIODevice::WriteOnly)) return;
    const QJsonObject marker{
        {QStringLiteral("profileId"), profileId},
        {QStringLiteral("pid"), static_cast<double>(currentProcessId())},
        {QStringLiteral("startedAt"), isoNow()},
    };
    file.write(QJsonDocument(marker).toJson(QJsonDocument::Compact));
    file.commit();
}

bool removeSessionMarker(const QString &profileId)
{
    if (!validProfileId(profileId)) return false;
    const QString marker = sessionMarkerPath(profileId);
    return !QFileInfo::exists(marker) || QFile::remove(marker);
}

int objectProfileIndex(const QJsonArray &profiles, const QString &profileId)
{
    for (int index = 0; index < profiles.size(); ++index) {
        const QJsonObject profile = profiles.at(index).toObject();
        QString error;
        const QString normalized = ServerProfileStore::normalizeServerUrl(profile.value(QStringLiteral("url")).toString(), &error);
        if (!normalized.isEmpty() && ServerProfileStore::profileIdForUrl(normalized) == profileId) return index;
    }
    return -1;
}
}

ServerProfileStore::ServerProfileStore(QObject *parent)
    : QObject(parent)
    , m_registryRoot(localDataRoot())
    , m_profileDataRoot(localDataRoot() + QStringLiteral("/WebView2"))
    , m_nativeDataRoot(nativeProfileDataRoot())
{
    load();
}

QString ServerProfileStore::normalizeServerUrl(const QString &rawUrl, QString *errorMessage)
{
    QString input = rawUrl.trimmed();
    if (input.isEmpty()) {
        if (errorMessage) *errorMessage = QStringLiteral("Enter a Cluster Server address.");
        return {};
    }
    if (!input.contains(QStringLiteral("://")))
        input.prepend(QStringLiteral("http://"));
    QUrl url = QUrl::fromUserInput(input);
    const QString scheme = url.scheme().toLower();
    if (!url.isValid() || url.host().isEmpty() || (scheme != QStringLiteral("http") && scheme != QStringLiteral("https"))) {
        if (errorMessage) *errorMessage = QStringLiteral("Enter a valid HTTP or HTTPS Cluster Server address.");
        return {};
    }
    if (!url.userInfo().isEmpty()) {
        if (errorMessage) *errorMessage = QStringLiteral("Server addresses cannot contain usernames or passwords.");
        return {};
    }
    if (url.port() == 0 || url.port() < -1 || url.port() > 65535) {
        if (errorMessage) *errorMessage = QStringLiteral("Server address contains an invalid port.");
        return {};
    }
    if (scheme == QStringLiteral("http") && !loopbackHost(url.host()) && !allowInsecureRemoteHttp()) {
        if (errorMessage) *errorMessage = QStringLiteral("Remote Cluster servers must use HTTPS. Plain HTTP is allowed only for localhost development.");
        return {};
    }
    url.setUserInfo(QString());
    url.setPath(QStringLiteral("/"));
    url.setQuery(QString());
    url.setFragment(QString());
    QString normalized = url.toString(QUrl::RemovePath | QUrl::RemoveQuery | QUrl::RemoveFragment | QUrl::NormalizePathSegments);
    while (normalized.endsWith(QLatin1Char('/'))) normalized.chop(1);
    if (normalized.isEmpty()) {
        if (errorMessage) *errorMessage = QStringLiteral("Server address could not be normalized.");
        return {};
    }
    return normalized;
}

QString ServerProfileStore::profileIdForUrl(const QString &normalizedUrl)
{
    const QByteArray digest = QCryptographicHash::hash(normalizedUrl.toUtf8(), QCryptographicHash::Sha256).toHex();
    return QStringLiteral("server-") + QString::fromLatin1(digest.left(24));
}

QString ServerProfileStore::prepareWebViewEnvironment(int argc, char *argv[])
{
    waitForPreviousDesktopProcess(commandLineWaitPid(argc, argv));
    QJsonObject registry = readRegistry();
    QJsonArray rawProfiles = registry.value(QStringLiteral("profiles")).toArray();

    struct PreparedProfile { QString id; QString url; bool pendingClear = false; };
    QList<PreparedProfile> profiles;
    profiles.reserve(qMin(rawProfiles.size(), qsizetype(MaxServerProfiles)));
    for (const QJsonValue &value : rawProfiles) {
        if (profiles.size() >= MaxServerProfiles) break;
        const QJsonObject profile = value.toObject();
        QString error;
        const QString url = normalizeServerUrl(profile.value(QStringLiteral("url")).toString(), &error);
        if (url.isEmpty()) continue;
        const QString id = profileIdForUrl(url);
        if (!validProfileId(id)) continue;
        bool duplicate = false;
        for (const PreparedProfile &existing : profiles) {
            if (existing.id == id) { duplicate = true; break; }
        }
        if (duplicate) continue;
        profiles.append({id, url, profile.value(QStringLiteral("pendingClear")).toBool(false)});
    }

    const QString defaultUrl = QStringLiteral("http://localhost:3000");
    if (profiles.isEmpty()) {
        const QString id = profileIdForUrl(defaultUrl);
        profiles.append({id, defaultUrl, false});
        rawProfiles.append(QJsonObject{
            {QStringLiteral("id"), id},
            {QStringLiteral("url"), defaultUrl},
            {QStringLiteral("label"), QStringLiteral("Local server")},
            {QStringLiteral("createdAt"), isoNow()},
            {QStringLiteral("lastUsedAt"), isoNow()},
        });
    }

    QString requested = commandLineProfileId(argc, argv);
    if (!validProfileId(requested)) requested.clear();
    QString active = requested;
    if (active.isEmpty()) {
        const QString storedActive = registry.value(QStringLiteral("activeProfileId")).toString().trimmed();
        if (validProfileId(storedActive)) active = storedActive;
    }
    if (active.isEmpty()) active = profiles.constFirst().id;

    QString selectedUrl = profiles.constFirst().url;
    QString selectedId = profiles.constFirst().id;
    bool pendingClear = profiles.constFirst().pendingClear;
    for (const PreparedProfile &profile : profiles) {
        if (profile.id == active) {
            selectedId = profile.id;
            selectedUrl = profile.url;
            pendingClear = profile.pendingClear;
            break;
        }
    }

    const QString root = localDataRoot() + QStringLiteral("/WebView2");
    const QString profileRoot = QDir::cleanPath(root + QLatin1Char('/') + selectedId);
    const QString relative = QDir(root).relativeFilePath(profileRoot);
    const QString nativeRoot = nativeProfileDataRoot();
    const QString nativeProfileRoot = nativeProfilePathForId(selectedId);
    const QString nativeRelative = QDir(nativeRoot).relativeFilePath(nativeProfileRoot);
    if (!validProfileId(selectedId)
        || relative.startsWith(QStringLiteral("..")) || QDir::isAbsolutePath(relative)
        || nativeRelative.startsWith(QStringLiteral("..")) || QDir::isAbsolutePath(nativeRelative))
        return {};

    QDir().mkpath(root);
    QDir().mkpath(nativeRoot);
    if (pendingClear) {
        if (QFileInfo::exists(profileRoot) && !QDir(profileRoot).removeRecursively())
            return {};
        if (QFileInfo::exists(nativeProfileRoot) && !QDir(nativeProfileRoot).removeRecursively())
            return {};
        removeLegacyApiSession(selectedUrl);
    }
    QDir().mkpath(nativeProfileRoot);

    // If the previous owner is gone while its marker remains, preserve that signal as a
    // profile-specific unclean launch instead of treating it as a generic app crash.
    const QJsonObject marker = readSessionMarker(selectedId);
    const qint64 markerPid = static_cast<qint64>(marker.value(QStringLiteral("pid")).toDouble(0));
    const bool unclean = markerPid > 0 && markerPid != currentProcessId() && !processIsAlive(markerPid);

    int rawIndex = objectProfileIndex(rawProfiles, selectedId);
    if (rawIndex < 0) {
        rawProfiles.append(QJsonObject{
            {QStringLiteral("id"), selectedId},
            {QStringLiteral("url"), selectedUrl},
            {QStringLiteral("createdAt"), isoNow()},
            {QStringLiteral("lastUsedAt"), isoNow()},
        });
        rawIndex = rawProfiles.size() - 1;
    }
    QJsonObject selectedObject = rawProfiles.at(rawIndex).toObject();
    selectedObject.insert(QStringLiteral("id"), selectedId);
    selectedObject.insert(QStringLiteral("url"), selectedUrl);
    selectedObject.insert(QStringLiteral("pendingClear"), false);
    selectedObject.insert(QStringLiteral("lastUsedAt"), isoNow());
    int uncleanLaunches = selectedObject.value(QStringLiteral("uncleanLaunches")).toInt(0);
    if (unclean) ++uncleanLaunches;
    selectedObject.insert(QStringLiteral("uncleanLaunches"), uncleanLaunches);
    if (uncleanLaunches >= RecoveryFailureThreshold)
        selectedObject.insert(QStringLiteral("recoveryRequired"), true);
    rawProfiles.replace(rawIndex, selectedObject);
    registry.insert(QStringLiteral("schemaVersion"), RegistrySchemaVersion);
    registry.insert(QStringLiteral("activeProfileId"), selectedId);
    registry.insert(QStringLiteral("profiles"), rawProfiles);
    if (!writeRegistry(registry)) return {};

#ifdef Q_OS_WIN
    // Qt WebView creates its WebView2 environment after initialize(). WebView2 honors
    // this process-scoped UDF override, so each active Cluster server receives an
    // isolated cookie/DOM-storage/permission/cache container without copying auth
    // material into Qt settings.
    qputenv("WEBVIEW2_USER_DATA_FOLDER", QDir::toNativeSeparators(profileRoot).toUtf8());
#endif
    qputenv("CLUSTER_DESKTOP_PROFILE_ID", selectedId.toUtf8());
    qputenv("CLUSTER_DESKTOP_SERVER_URL", selectedUrl.toUtf8());
    qputenv("CLUSTER_DESKTOP_NATIVE_PROFILE_PATH", QDir::toNativeSeparators(nativeProfileRoot).toUtf8());
    writeSessionMarker(selectedId);
    return selectedId;
}

QVariantList ServerProfileStore::profiles() const
{
    QList<ProfileRecord> sorted = m_profiles;
    std::sort(sorted.begin(), sorted.end(), [](const ProfileRecord &a, const ProfileRecord &b) {
        return a.lastUsedAt > b.lastUsedAt;
    });
    QVariantList result;
    result.reserve(sorted.size());
    for (const ProfileRecord &profile : sorted) result.append(toVariant(profile));
    return result;
}

QString ServerProfileStore::activeProfileId() const { return m_activeProfileId; }
QString ServerProfileStore::profileDataRoot() const { return m_profileDataRoot; }
QString ServerProfileStore::activeNativeDataPath() const { return nativeProfilePath(m_activeProfileId); }
bool ServerProfileStore::recoveryRequired() const { return m_recoveryRequired; }
QString ServerProfileStore::lastOperationError() const { return m_lastOperationError; }

QString ServerProfileStore::activeServerUrl() const
{
    const int index = indexOf(m_activeProfileId);
    return index >= 0 ? m_profiles.at(index).url : QStringLiteral("http://localhost:3000");
}

QVariantMap ServerProfileStore::activeProfile() const
{
    const int index = indexOf(m_activeProfileId);
    return index >= 0 ? toVariant(m_profiles.at(index)) : QVariantMap{};
}

QString ServerProfileStore::activeLastRoute() const
{
    const int index = indexOf(m_activeProfileId);
    return index >= 0 ? m_profiles.at(index).lastRoute : QString();
}

QString ServerProfileStore::activeLastInspector() const
{
    const int index = indexOf(m_activeProfileId);
    return index >= 0 ? m_profiles.at(index).lastInspector : QString();
}

QVariantMap ServerProfileStore::validateServer(const QString &rawUrl) const
{
    QString error;
    const QString normalized = normalizeServerUrl(rawUrl, &error);
    if (normalized.isEmpty()) return {{QStringLiteral("ok"), false}, {QStringLiteral("error"), error}};
    const QUrl url(normalized);
    return {
        {QStringLiteral("ok"), true},
        {QStringLiteral("url"), normalized},
        {QStringLiteral("id"), profileIdForUrl(normalized)},
        {QStringLiteral("secure"), url.scheme() == QStringLiteral("https") || loopbackHost(url.host())},
        {QStringLiteral("host"), url.host()},
    };
}

QVariantMap ServerProfileStore::addServer(const QString &rawUrl, const QString &label)
{
    setLastOperationError(QString());
    QString error;
    const QString url = normalizeServerUrl(rawUrl, &error);
    if (url.isEmpty()) {
        setLastOperationError(error);
        return {{QStringLiteral("ok"), false}, {QStringLiteral("error"), error}};
    }
    const QString id = profileIdForUrl(url);
    int index = indexOf(id);
    if (index < 0) {
        if (m_profiles.size() >= MaxServerProfiles) {
            const QString message = QStringLiteral("Cluster supports up to 32 saved server profiles on one desktop installation.");
            setLastOperationError(message);
            return {{QStringLiteral("ok"), false}, {QStringLiteral("error"), message}};
        }
        ProfileRecord record;
        record.id = id;
        record.url = url;
        record.label = safeLabel(label);
        record.createdAt = isoNow();
        record.lastUsedAt = record.createdAt;
        m_profiles.append(record);
        index = m_profiles.size() - 1;
    } else if (!label.trimmed().isEmpty()) {
        m_profiles[index].label = safeLabel(label);
    }
    if (!save()) {
        const QString message = QStringLiteral("Cluster could not save the server profile registry.");
        setLastOperationError(message);
        return {{QStringLiteral("ok"), false}, {QStringLiteral("error"), message}};
    }
    emit profilesChanged();
    QVariantMap result = toVariant(m_profiles.at(index));
    result.insert(QStringLiteral("ok"), true);
    return result;
}

bool ServerProfileStore::switchProfile(const QString &profileId)
{
    setLastOperationError(QString());
    const int index = indexOf(profileId.trimmed());
    if (index < 0) {
        setLastOperationError(QStringLiteral("That server profile no longer exists."));
        return false;
    }
    return activateProfileIndex(index, true);
}

bool ServerProfileStore::switchServer(const QString &rawUrl, const QString &label)
{
    const QVariantMap added = addServer(rawUrl, label);
    if (!added.value(QStringLiteral("ok")).toBool()) return false;
    return switchProfile(added.value(QStringLiteral("id")).toString());
}

bool ServerProfileStore::renameProfile(const QString &profileId, const QString &label)
{
    setLastOperationError(QString());
    const int index = indexOf(profileId);
    if (index < 0) return false;
    m_profiles[index].label = safeLabel(label);
    if (!save()) {
        setLastOperationError(QStringLiteral("Cluster could not save the profile name."));
        return false;
    }
    emit profilesChanged();
    if (profileId == m_activeProfileId) emit activeProfileChanged();
    return true;
}

bool ServerProfileStore::forgetProfile(const QString &profileId)
{
    setLastOperationError(QString());
    const int index = indexOf(profileId);
    if (index < 0) return false;
    if (m_profiles[index].id == m_activeProfileId) {
        setLastOperationError(QStringLiteral("Switch to another server before forgetting the active profile."));
        return false;
    }
    const ProfileRecord removed = m_profiles.at(index);
    if (!removeProfileData(removed.id)) {
        setLastOperationError(QStringLiteral("Cluster could not remove the profile's local browser data. Close other Cluster windows using this server and retry."));
        return false;
    }
    removeSessionMarker(removed.id);
    m_profiles.removeAt(index);
    if (!save()) {
        m_profiles.insert(index, removed);
        setLastOperationError(QStringLiteral("Cluster could not update the profile registry."));
        return false;
    }
    emit profilesChanged();
    refreshRecoveryState();
    return true;
}

bool ServerProfileStore::clearProfileData(const QString &profileId)
{
    return resetProfileData(profileId);
}

bool ServerProfileStore::resetProfileData(const QString &profileId)
{
    setLastOperationError(QString());
    const int index = indexOf(profileId);
    if (index < 0) return false;
    m_profiles[index].consecutiveFailures = 0;
    m_profiles[index].uncleanLaunches = 0;
    m_profiles[index].recoveryRequired = false;
    m_profiles[index].lastError.clear();
    m_profiles[index].lastFailureAt.clear();
    if (m_profiles[index].id == m_activeProfileId) {
        m_profiles[index].pendingClear = true;
        if (!save()) return false;
        refreshRecoveryState();
        return restartIntoProfile(m_activeProfileId);
    }
    if (!removeProfileData(profileId)) {
        setLastOperationError(QStringLiteral("Cluster could not reset the profile while another process is using its WebView2 data."));
        return false;
    }
    m_profiles[index].pendingClear = false;
    if (!save()) return false;
    emit profilesChanged();
    refreshRecoveryState();
    return true;
}

bool ServerProfileStore::clearRecoveryState(const QString &profileId)
{
    const int index = indexOf(profileId);
    if (index < 0) return false;
    m_profiles[index].consecutiveFailures = 0;
    m_profiles[index].uncleanLaunches = 0;
    m_profiles[index].recoveryRequired = false;
    m_profiles[index].lastError.clear();
    m_profiles[index].lastFailureAt.clear();
    if (!save()) return false;
    emit profilesChanged();
    if (profileId == m_activeProfileId) emit activeProfileChanged();
    refreshRecoveryState();
    return true;
}

bool ServerProfileStore::openProfileFolder(const QString &profileId) const
{
    const QString path = profilePath(profileId);
    if (path.isEmpty()) return false;
    QDir().mkpath(path);
    return QDesktopServices::openUrl(QUrl::fromLocalFile(path));
}

bool ServerProfileStore::openProfilesFolder() const
{
    QDir().mkpath(m_registryRoot);
    return QDesktopServices::openUrl(QUrl::fromLocalFile(m_registryRoot));
}

bool ServerProfileStore::requestSignOut(const QString &profileId)
{
    setLastOperationError(QString());
    const int index = indexOf(profileId);
    if (index < 0) return false;
    if (profileId != m_activeProfileId) {
        // Inactive profiles have no live WebView from which to revoke the server session.
        // Removing the UDF still removes every local credential, cookie, permission, cache,
        // and offline browser datum for that server.
        return resetProfileData(profileId);
    }
    emit signOutRequested(profileId);
    return true;
}

void ServerProfileStore::completeSignOut(const QString &profileId, bool serverSessionRevoked)
{
    const int index = indexOf(profileId);
    if (index < 0) return;
    m_profiles[index].userLabel.clear();
    m_profiles[index].lastRoute.clear();
    m_profiles[index].lastInspector.clear();
    m_profiles[index].consecutiveFailures = 0;
    m_profiles[index].recoveryRequired = false;
    m_profiles[index].lastError = serverSessionRevoked
        ? QString()
        : QStringLiteral("Server session revocation could not be confirmed; local credentials will still be removed.");
    if (profileId == m_activeProfileId) {
        m_profiles[index].pendingClear = true;
        save();
        restartIntoProfile(profileId);
    } else {
        removeProfileData(profileId);
        save();
        emit profilesChanged();
    }
}

bool ServerProfileStore::isUrlAllowedForActiveProfile(const QString &rawUrl) const
{
    const QUrl target(rawUrl);
    const QUrl active(activeServerUrl());
    if (!target.isValid() || !active.isValid()) return false;
    const QString scheme = target.scheme().toLower();
    if (scheme != QStringLiteral("http") && scheme != QStringLiteral("https")) return false;
    const int targetPort = target.port(scheme == QStringLiteral("https") ? 443 : 80);
    const int activePort = active.port(active.scheme().toLower() == QStringLiteral("https") ? 443 : 80);
    return target.scheme().compare(active.scheme(), Qt::CaseInsensitive) == 0
        && target.host().compare(active.host(), Qt::CaseInsensitive) == 0
        && targetPort == activePort;
}

void ServerProfileStore::recordRendererLoadSucceeded(const QString &rawUrl)
{
    const int index = indexOf(m_activeProfileId);
    if (index < 0) return;
    ProfileRecord &profile = m_profiles[index];
    const QUrl url(rawUrl);
    const QString route = safeRoute(url.fragment());
    profile.lastConnectedAt = isoNow();
    profile.lastUsedAt = profile.lastConnectedAt;
    profile.successfulLoads = qMin(profile.successfulLoads + 1, 1000000);
    profile.consecutiveFailures = 0;
    profile.uncleanLaunches = 0;
    profile.recoveryRequired = false;
    profile.lastError.clear();
    profile.lastFailureAt.clear();
    if (!route.isEmpty()) profile.lastRoute = route;
    save();
    emit profilesChanged();
    emit activeProfileChanged();
    refreshRecoveryState();
    emit rendererLoadSucceeded();
}

void ServerProfileStore::recordRendererLoadFailed(const QString &errorMessage)
{
    const int index = indexOf(m_activeProfileId);
    if (index < 0) return;
    ProfileRecord &profile = m_profiles[index];
    profile.lastFailureAt = isoNow();
    profile.failedLoads = qMin(profile.failedLoads + 1, 1000000);
    profile.consecutiveFailures = qMin(profile.consecutiveFailures + 1, 1000);
    profile.lastError = safeLabel(errorMessage, MaximumStoredErrorLength);
    if (profile.consecutiveFailures >= RecoveryFailureThreshold)
        profile.recoveryRequired = true;
    save();
    emit profilesChanged();
    emit activeProfileChanged();
    refreshRecoveryState();
    emit rendererLoadFailed(profile.lastError);
}

QVariantList ServerProfileStore::recentWorkspaces() const
{
    QVariantList result;
    const QString nativePath = activeNativeDataPath();
    if (nativePath.isEmpty()) return result;
    const QJsonArray items = readRecentWorkspaceArray(nativePath);
    for (const QJsonValue &value : items) {
        if (!value.isObject() || result.size() >= MaximumRecentWorkspaces) break;
        const QJsonObject object = value.toObject();
        const QString route = safeRoute(object.value(QStringLiteral("route")).toString());
        const QString title = safeLabel(object.value(QStringLiteral("title")).toString(), MaximumRecentTitleLength);
        const QString kind = safeLabel(object.value(QStringLiteral("kind")).toString(), 24);
        const QString resourceId = safeLabel(object.value(QStringLiteral("resourceId")).toString(), 120);
        if (route.isEmpty() || title.isEmpty()) continue;
        result.append(QVariantMap{
            {QStringLiteral("route"), route},
            {QStringLiteral("title"), title},
            {QStringLiteral("kind"), kind},
            {QStringLiteral("resourceId"), resourceId},
            {QStringLiteral("lastOpenedAt"), object.value(QStringLiteral("lastOpenedAt")).toString()},
        });
    }
    return result;
}

void ServerProfileStore::recordRecentWorkspace(const QString &routeValue, const QString &titleValue, const QString &kindValue, const QString &resourceIdValue)
{
    const QString route = safeRoute(routeValue);
    const QString title = safeLabel(titleValue, MaximumRecentTitleLength);
    const QString kind = safeLabel(kindValue, 24).toLower();
    const QString resourceId = safeLabel(resourceIdValue, 120);
    const QString nativePath = activeNativeDataPath();
    if (nativePath.isEmpty() || route.isEmpty() || title.isEmpty()) return;
    if (kind != QStringLiteral("project") && kind != QStringLiteral("board") && kind != QStringLiteral("whiteboard")) return;

    QJsonArray existing = readRecentWorkspaceArray(nativePath);
    if (!existing.isEmpty() && existing.first().isObject()) {
        const QJsonObject current = existing.first().toObject();
        if (safeRoute(current.value(QStringLiteral("route")).toString()) == route
            && safeLabel(current.value(QStringLiteral("title")).toString(), MaximumRecentTitleLength) == title
            && safeLabel(current.value(QStringLiteral("kind")).toString(), 24).toLower() == kind
            && safeLabel(current.value(QStringLiteral("resourceId")).toString(), 120) == resourceId)
            return;
    }
    QJsonArray next;
    next.append(QJsonObject{
        {QStringLiteral("route"), route},
        {QStringLiteral("title"), title},
        {QStringLiteral("kind"), kind},
        {QStringLiteral("resourceId"), resourceId},
        {QStringLiteral("lastOpenedAt"), isoNow()},
    });
    for (const QJsonValue &value : existing) {
        if (!value.isObject() || next.size() >= MaximumRecentWorkspaces) break;
        const QJsonObject object = value.toObject();
        if (safeRoute(object.value(QStringLiteral("route")).toString()) == route) continue;
        next.append(object);
    }
    if (writeRecentWorkspaceArray(nativePath, next)) emit recentWorkspacesChanged();
}

bool ServerProfileStore::clearRecentWorkspaces()
{
    const QString nativePath = activeNativeDataPath();
    if (nativePath.isEmpty()) return false;
    const QString path = recentWorkspacesPath(nativePath);
    const bool ok = !QFileInfo::exists(path) || QFile::remove(path);
    if (ok) emit recentWorkspacesChanged();
    return ok;
}

void ServerProfileStore::updateRendererIdentity(const QString &serverLabel, const QString &userLabel, const QString &route, const QString &inspector)
{
    const int index = indexOf(m_activeProfileId);
    if (index < 0) return;
    ProfileRecord &profile = m_profiles[index];
    const QString nextServerLabel = safeLabel(serverLabel, MaximumIdentityLength);
    const QString nextUserLabel = safeLabel(userLabel, MaximumIdentityLength);
    const QString nextRoute = safeRoute(route);
    const QString nextInspector = safeInspector(inspector);
    bool changed = false;
    if (!nextServerLabel.isEmpty() && profile.serverLabel != nextServerLabel) { profile.serverLabel = nextServerLabel; changed = true; }
    if (profile.userLabel != nextUserLabel) { profile.userLabel = nextUserLabel; changed = true; }
    if (!nextRoute.isEmpty() && profile.lastRoute != nextRoute) { profile.lastRoute = nextRoute; changed = true; }
    if (profile.lastInspector != nextInspector) { profile.lastInspector = nextInspector; changed = true; }
    if (!changed) return;
    save();
    emit profilesChanged();
    emit activeProfileChanged();
}

void ServerProfileStore::markCleanExit()
{
    const QString sessionId = validProfileId(m_sessionProfileId) ? m_sessionProfileId : m_activeProfileId;
    const int index = indexOf(sessionId);
    if (index >= 0) {
        m_profiles[index].uncleanLaunches = 0;
        save();
    }
    removeSessionMarker(sessionId);
}

void ServerProfileStore::load()
{
    QDir().mkpath(m_registryRoot);
    QDir().mkpath(m_profileDataRoot);
    QDir().mkpath(m_nativeDataRoot);
    QDir().mkpath(sessionMarkerRoot());
    const QJsonObject registry = readRegistry();
    m_profiles.clear();
    for (const QJsonValue &value : registry.value(QStringLiteral("profiles")).toArray()) {
        if (m_profiles.size() >= MaxServerProfiles) break;
        const QJsonObject object = value.toObject();
        QString error;
        const QString url = normalizeServerUrl(object.value(QStringLiteral("url")).toString(), &error);
        if (url.isEmpty()) continue;
        ProfileRecord record;
        record.url = url;
        // Never trust a persisted path-like identifier. Profile IDs are derived from the
        // normalized origin, which makes profile deletion incapable of escaping the
        // Cluster WebView2 data root even if profiles.json is tampered with.
        record.id = profileIdForUrl(record.url);
        if (indexOf(record.id) >= 0) continue;
        record.label = safeLabel(object.value(QStringLiteral("label")).toString());
        record.serverLabel = safeLabel(object.value(QStringLiteral("serverLabel")).toString(), MaximumIdentityLength);
        record.userLabel = safeLabel(object.value(QStringLiteral("userLabel")).toString(), MaximumIdentityLength);
        record.createdAt = object.value(QStringLiteral("createdAt")).toString();
        record.lastUsedAt = object.value(QStringLiteral("lastUsedAt")).toString();
        record.lastConnectedAt = object.value(QStringLiteral("lastConnectedAt")).toString();
        record.lastFailureAt = object.value(QStringLiteral("lastFailureAt")).toString();
        record.lastError = safeLabel(object.value(QStringLiteral("lastError")).toString(), MaximumStoredErrorLength);
        record.lastRoute = safeRoute(object.value(QStringLiteral("lastRoute")).toString());
        record.lastInspector = safeInspector(object.value(QStringLiteral("lastInspector")).toString());
        record.successfulLoads = qMax(0, object.value(QStringLiteral("successfulLoads")).toInt(0));
        record.failedLoads = qMax(0, object.value(QStringLiteral("failedLoads")).toInt(0));
        record.consecutiveFailures = qMax(0, object.value(QStringLiteral("consecutiveFailures")).toInt(0));
        record.uncleanLaunches = qMax(0, object.value(QStringLiteral("uncleanLaunches")).toInt(0));
        record.pendingClear = object.value(QStringLiteral("pendingClear")).toBool(false);
        record.recoveryRequired = object.value(QStringLiteral("recoveryRequired")).toBool(false)
            || record.consecutiveFailures >= RecoveryFailureThreshold
            || record.uncleanLaunches >= RecoveryFailureThreshold;
        if (record.createdAt.isEmpty()) record.createdAt = isoNow();
        if (record.lastUsedAt.isEmpty()) record.lastUsedAt = record.createdAt;
        m_profiles.append(record);
    }

    QString requested = qEnvironmentVariable("CLUSTER_DESKTOP_PROFILE_ID").trimmed();
    if (!validProfileId(requested)) requested.clear();
    QString storedActive = registry.value(QStringLiteral("activeProfileId")).toString().trimmed();
    if (!validProfileId(storedActive)) storedActive.clear();
    m_activeProfileId = requested.isEmpty() ? storedActive : requested;
    m_sessionProfileId = requested;
    if (indexOf(m_activeProfileId) < 0) {
        const QString environmentUrl = qEnvironmentVariable("CLUSTER_DESKTOP_SERVER_URL", QStringLiteral("http://localhost:3000"));
        ProfileRecord record;
        record.url = normalizeServerUrl(environmentUrl);
        if (record.url.isEmpty()) record.url = QStringLiteral("http://localhost:3000");
        record.id = profileIdForUrl(record.url);
        record.label = QStringLiteral("Local server");
        record.createdAt = isoNow();
        record.lastUsedAt = record.createdAt;
        m_profiles.prepend(record);
        m_activeProfileId = record.id;
    }
    if (!validProfileId(m_sessionProfileId)) m_sessionProfileId = m_activeProfileId;
    const int activeIndex = indexOf(m_activeProfileId);
    if (activeIndex >= 0) {
        m_profiles[activeIndex].pendingClear = false;
        m_profiles[activeIndex].lastUsedAt = isoNow();
    }
    save();
    refreshRecoveryState();
}

bool ServerProfileStore::save() const
{
    QDir().mkpath(m_registryRoot);
    QJsonArray profiles;
    for (const ProfileRecord &record : m_profiles) {
        profiles.append(QJsonObject{
            {QStringLiteral("id"), record.id},
            {QStringLiteral("url"), record.url},
            {QStringLiteral("label"), record.label},
            {QStringLiteral("serverLabel"), record.serverLabel},
            {QStringLiteral("userLabel"), record.userLabel},
            {QStringLiteral("createdAt"), record.createdAt},
            {QStringLiteral("lastUsedAt"), record.lastUsedAt},
            {QStringLiteral("lastConnectedAt"), record.lastConnectedAt},
            {QStringLiteral("lastFailureAt"), record.lastFailureAt},
            {QStringLiteral("lastError"), record.lastError},
            {QStringLiteral("lastRoute"), record.lastRoute},
            {QStringLiteral("lastInspector"), record.lastInspector},
            {QStringLiteral("successfulLoads"), record.successfulLoads},
            {QStringLiteral("failedLoads"), record.failedLoads},
            {QStringLiteral("consecutiveFailures"), record.consecutiveFailures},
            {QStringLiteral("uncleanLaunches"), record.uncleanLaunches},
            {QStringLiteral("pendingClear"), record.pendingClear},
            {QStringLiteral("recoveryRequired"), record.recoveryRequired},
        });
    }
    const QJsonObject registry{
        {QStringLiteral("schemaVersion"), RegistrySchemaVersion},
        {QStringLiteral("activeProfileId"), m_activeProfileId},
        {QStringLiteral("profiles"), profiles},
    };
    return writeRegistry(registry);
}

int ServerProfileStore::indexOf(const QString &profileId) const
{
    for (int index = 0; index < m_profiles.size(); ++index)
        if (m_profiles[index].id == profileId) return index;
    return -1;
}

QVariantMap ServerProfileStore::toVariant(const ProfileRecord &profile) const
{
    const QUrl url(profile.url);
    QString status = QStringLiteral("Saved");
    if (profile.id == m_activeProfileId) status = QStringLiteral("Active");
    if (!profile.lastConnectedAt.isEmpty()) status = QStringLiteral("Connected");
    if (profile.consecutiveFailures > 0) status = QStringLiteral("Connection issue");
    if (profile.recoveryRequired) status = QStringLiteral("Recovery needed");
    const QString displayLabel = !profile.label.isEmpty()
        ? profile.label
        : !profile.serverLabel.isEmpty() ? profile.serverLabel : url.host();
    return {
        {QStringLiteral("id"), profile.id},
        {QStringLiteral("url"), profile.url},
        {QStringLiteral("label"), displayLabel},
        {QStringLiteral("customLabel"), profile.label},
        {QStringLiteral("serverLabel"), profile.serverLabel},
        {QStringLiteral("userLabel"), profile.userLabel},
        {QStringLiteral("createdAt"), profile.createdAt},
        {QStringLiteral("lastUsedAt"), profile.lastUsedAt},
        {QStringLiteral("lastConnectedAt"), profile.lastConnectedAt},
        {QStringLiteral("lastFailureAt"), profile.lastFailureAt},
        {QStringLiteral("lastError"), profile.lastError},
        {QStringLiteral("lastRoute"), profile.lastRoute},
        {QStringLiteral("lastInspector"), profile.lastInspector},
        {QStringLiteral("successfulLoads"), profile.successfulLoads},
        {QStringLiteral("failedLoads"), profile.failedLoads},
        {QStringLiteral("consecutiveFailures"), profile.consecutiveFailures},
        {QStringLiteral("uncleanLaunches"), profile.uncleanLaunches},
        {QStringLiteral("active"), profile.id == m_activeProfileId},
        {QStringLiteral("secure"), url.scheme().compare(QStringLiteral("https"), Qt::CaseInsensitive) == 0 || loopbackHost(url.host())},
        {QStringLiteral("recoveryRequired"), profile.recoveryRequired},
        {QStringLiteral("status"), status},
        {QStringLiteral("profilePath"), profilePath(profile.id)},
        {QStringLiteral("nativeDataPath"), nativeProfilePath(profile.id)},
        {QStringLiteral("isolationVersion"), 2},
    };
}

bool ServerProfileStore::activateProfileIndex(int index, bool restart)
{
    if (index < 0 || index >= m_profiles.size()) return false;
    const QString nextId = m_profiles[index].id;
    const QString previousId = m_activeProfileId;
    const QString previousUsedAt = m_profiles[index].lastUsedAt;
    m_profiles[index].lastUsedAt = isoNow();
    if (previousId == nextId) {
        if (!save()) {
            m_profiles[index].lastUsedAt = previousUsedAt;
            setLastOperationError(QStringLiteral("Cluster could not save the active Server profile."));
            return false;
        }
        emit profilesChanged();
        return true;
    }

    // Keep the on-disk registry and in-memory selection together. If the
    // registry cannot be committed, the current WebView/session must continue
    // to own the original Server profile.
    m_activeProfileId = nextId;
    if (!save()) {
        m_activeProfileId = previousId;
        m_profiles[index].lastUsedAt = previousUsedAt;
        setLastOperationError(QStringLiteral("Cluster could not save the Server profile switch."));
        return false;
    }
    if (restart && !restartIntoProfile(nextId)) {
        // The new process was not started. Roll back both views of the
        // selection rather than leaving the old WebView running under a
        // newly selected persistent profile.
        m_activeProfileId = previousId;
        m_profiles[index].lastUsedAt = previousUsedAt;
        const bool restored = save();
        setLastOperationError(restored
            ? QStringLiteral("Cluster could not restart into the selected Server. The previous profile remains active.")
            : QStringLiteral("Cluster could not restart or restore the Server profile registry. Repair the saved profile selection before relaunching."));
        return false;
    }
    emit profilesChanged();
    emit activeProfileChanged();
    refreshRecoveryState();
    return true;
}

bool ServerProfileStore::restartIntoProfile(const QString &profileId) const
{
    if (!validProfileId(profileId)) return false;
    QStringList arguments;
    arguments << QStringLiteral("--profile") << profileId
              << QStringLiteral("--wait-for-pid") << QString::number(QCoreApplication::applicationPid());
    const bool started = QProcess::startDetached(QCoreApplication::applicationFilePath(), arguments, QCoreApplication::applicationDirPath());
    if (started) {
        emit const_cast<ServerProfileStore *>(this)->restartRequested();
        QCoreApplication::quit();
    }
    return started;
}

QString ServerProfileStore::profilePath(const QString &profileId) const
{
    if (!validProfileId(profileId)) return {};
    const QString candidate = QDir::cleanPath(m_profileDataRoot + QLatin1Char('/') + profileId);
    const QString relative = QDir(m_profileDataRoot).relativeFilePath(candidate);
    if (relative.startsWith(QStringLiteral("..")) || QDir::isAbsolutePath(relative)) return {};
    return candidate;
}

QString ServerProfileStore::nativeProfilePath(const QString &profileId) const
{
    if (!validProfileId(profileId)) return {};
    const QString candidate = QDir::cleanPath(m_nativeDataRoot + QLatin1Char('/') + profileId);
    const QString relative = QDir(m_nativeDataRoot).relativeFilePath(candidate);
    if (relative.startsWith(QStringLiteral("..")) || QDir::isAbsolutePath(relative)) return {};
    return candidate;
}

void ServerProfileStore::setLastOperationError(const QString &message)
{
    const QString next = safeLabel(message, MaximumStoredErrorLength);
    if (m_lastOperationError == next) return;
    m_lastOperationError = next;
    emit lastOperationErrorChanged();
}

bool ServerProfileStore::removeProfileData(const QString &profileId) const
{
    const QString webViewPath = profilePath(profileId);
    const QString nativePath = nativeProfilePath(profileId);
    if (webViewPath.isEmpty() || nativePath.isEmpty()) return false;
    const bool webViewRemoved = !QFileInfo::exists(webViewPath) || QDir(webViewPath).removeRecursively();
    const bool nativeRemoved = !QFileInfo::exists(nativePath) || QDir(nativePath).removeRecursively();
    const int index = indexOf(profileId);
    if (index >= 0) removeLegacyApiSession(m_profiles.at(index).url);
    return webViewRemoved && nativeRemoved;
}

void ServerProfileStore::refreshRecoveryState()
{
    const int index = indexOf(m_activeProfileId);
    const bool next = index >= 0 && m_profiles[index].recoveryRequired;
    if (m_recoveryRequired == next) return;
    m_recoveryRequired = next;
    emit recoveryRequiredChanged();
}
