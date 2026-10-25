#include "LibraryMountManager.h"
#include "ApiClient.h"
#include "ClusterFuseMount.h"
#include "ServerProfileStore.h"
#include "TransferManager.h"

#include <QDir>
#include <QFileInfo>
#include <QJsonObject>
#include <QMimeDatabase>
#include <QStandardPaths>
#include <QUrl>
#include <utility>

namespace {
QString platformName()
{
#ifdef Q_OS_WIN
    return QStringLiteral("windows");
#elif defined(Q_OS_MACOS)
    return QStringLiteral("macos");
#else
    return QStringLiteral("linux");
#endif
}
QString featureLabel()
{
#ifdef Q_OS_WIN
    return QStringLiteral("Cluster Drive");
#elif defined(Q_OS_MACOS)
    return QStringLiteral("Cluster Volume");
#else
    return QStringLiteral("Cluster Mount");
#endif
}
QString locationLabel()
{
#ifdef Q_OS_WIN
    return QStringLiteral("Drive letter");
#elif defined(Q_OS_MACOS)
    return QStringLiteral("Volume name");
#else
    return QStringLiteral("Mount location");
#endif
}
QString safeSegment(QString value)
{
    value = value.trimmed();
    for (const QChar bad : QStringLiteral("\\/:*?\"<>|")) value.replace(bad, QLatin1Char('_'));
    while (value.endsWith(QLatin1Char('.')) || value.endsWith(QLatin1Char(' '))) value.chop(1);
    return value.left(160).isEmpty() ? QStringLiteral("Server") : value.left(160);
}
QString operationFor(const QString &kind, const QString &profileId) { return QStringLiteral("libraryMount:%1:%2").arg(kind, profileId); }
QString operationKind(const QString &operation)
{
    const QStringList parts = operation.split(QLatin1Char(':')); return parts.size() >= 3 ? parts.at(1) : QString();
}
QString operationProfile(const QString &operation)
{
    const QStringList parts = operation.split(QLatin1Char(':')); return parts.size() >= 3 ? parts.mid(2).join(QLatin1Char(':')) : QString();
}
}

LibraryMountManager::LibraryMountManager(ApiClient *api, ServerProfileStore *profiles, TransferManager *transfers, QObject *parent)
    : QObject(parent), m_api(api), m_profiles(profiles), m_transfers(transfers)
{
    if (m_api) {
        connect(m_api, &ApiClient::succeeded, this, [this](const QString &operation, const QJsonValue &payload) {
            if (!operation.startsWith(QStringLiteral("libraryMount:"))) return;
            if (SourceContext *source = sourceById(operationProfile(operation))) handleSourceSuccess(source, operation, payload);
        });
        connect(m_api, &ApiClient::failed, this, [this](const QString &operation, const QVariantMap &error) {
            if (!operation.startsWith(QStringLiteral("libraryMount:"))) return;
            if (SourceContext *source = sourceById(operationProfile(operation))) handleSourceFailure(source, operation, error);
        });
    }
    if (m_profiles) connect(m_profiles, &ServerProfileStore::profilesChanged, this, [this] { if (m_requestedRunning) refresh(); });
}

LibraryMountManager::~LibraryMountManager()
{
    forceStop();
    clearOwnedSourceContexts();
}

QString LibraryMountManager::providerName() const
{
#ifdef Q_OS_WIN
    return QStringLiteral("WinFsp FUSE3");
#elif defined(Q_OS_MACOS)
    return QStringLiteral("macFUSE FUSE3");
#else
    return QStringLiteral("FUSE3");
#endif
}

bool LibraryMountManager::providerDetected() const
{
#ifdef Q_OS_WIN
    return QFileInfo::exists(QStringLiteral("C:/Program Files/WinFsp/bin/fsptool-x64.exe")) || QFileInfo::exists(QStringLiteral("C:/Program Files (x86)/WinFsp/bin/fsptool-x64.exe"));
#elif defined(Q_OS_MACOS)
    return QFileInfo::exists(QStringLiteral("/Library/Filesystems/macfuse.fs"));
#else
    return QFileInfo::exists(QStringLiteral("/dev/fuse"));
#endif
}

bool LibraryMountManager::anyRunning() const
{
    for (const ClusterFuseMount *mount : m_mounts) if (mount && mount->running()) return true;
    return false;
}

bool LibraryMountManager::activeMountRequired() const
{
    const SourceContext *active = m_sources.value(m_profileId, nullptr);
    return active && active->manifest.value(QStringLiteral("mountPolicy")).toString() == QStringLiteral("required");
}

QVariantMap LibraryMountManager::status() const
{
    const bool adapterBuilt = !m_mounts.isEmpty() ? m_mounts.first()->available() : ClusterFuseMount().available();
    const bool detected = providerDetected(); const bool ready = adapterBuilt && detected;
    QVariantList sourceStatus; int authenticatedCount = 0, eligibleCount = 0, entryCount = 0;
    for (SourceContext *source : m_sources) {
        if (!source) continue;
        const QString policy = source->manifest.value(QStringLiteral("mountPolicy")).toString();
        const bool eligible = source->authenticated && policy != QStringLiteral("disabled") && !source->manifest.isEmpty();
        if (source->authenticated) ++authenticatedCount; if (eligible) ++eligibleCount;
        entryCount += source->manifest.value(QStringLiteral("entries")).toList().size();
        sourceStatus << QVariantMap{
            {QStringLiteral("profileId"), source->profileId}, {QStringLiteral("label"), source->label}, {QStringLiteral("active"), source->active},
            {QStringLiteral("authenticated"), source->authenticated}, {QStringLiteral("eligible"), eligible},
            {QStringLiteral("mountPolicy"), policy}, {QStringLiteral("mountIsolation"), source->manifest.value(QStringLiteral("mountIsolation")).toString()},
            {QStringLiteral("readOnly"), source->manifest.value(QStringLiteral("readOnly")).toBool()},
            {QStringLiteral("error"), source->error.isEmpty() ? QVariant() : QVariant(source->error.value(QStringLiteral("message")))},
        };
    }
    const SourceContext *active = m_sources.value(m_profileId, nullptr);
    const QVariantMap activeManifest = active ? active->manifest : m_manifest;
    return {
        {QStringLiteral("platform"), platformName()}, {QStringLiteral("provider"), providerName()}, {QStringLiteral("providerDetected"), detected},
        {QStringLiteral("adapterBuilt"), adapterBuilt}, {QStringLiteral("engineReady"), ready}, {QStringLiteral("running"), anyRunning()},
        {QStringLiteral("authenticated"), !m_userId.isEmpty()}, {QStringLiteral("refreshing"), m_refreshing}, {QStringLiteral("featureLabel"), featureLabel()},
        {QStringLiteral("locationLabel"), locationLabel()}, {QStringLiteral("mountLocation"), m_mountLocation}, {QStringLiteral("layout"), m_layout},
        {QStringLiteral("organization"), m_organization}, {QStringLiteral("entryCount"), entryCount}, {QStringLiteral("serverCount"), m_sources.size()},
        {QStringLiteral("authenticatedServerCount"), authenticatedCount}, {QStringLiteral("eligibleServerCount"), eligibleCount}, {QStringLiteral("mountCount"), m_mounts.size()},
        {QStringLiteral("readOnly"), activeManifest.value(QStringLiteral("readOnly")).toBool()}, {QStringLiteral("mountPolicy"), activeManifest.value(QStringLiteral("mountPolicy")).toString()},
        {QStringLiteral("mountIsolation"), activeManifest.value(QStringLiteral("mountIsolation")).toString()},
        {QStringLiteral("crossServerTransferPolicy"), activeManifest.value(QStringLiteral("crossServerTransferPolicy")).toString()},
        {QStringLiteral("cacheRoot"), QString()}, {QStringLiteral("sources"), sourceStatus}, {QStringLiteral("lastError"), m_lastError},
        {QStringLiteral("supportedLayouts"), QVariantList{QStringLiteral("unified"), QStringLiteral("separate")}},
        {QStringLiteral("supportedOrganization"), QVariantList{QStringLiteral("servers"), QStringLiteral("libraries")}}, {QStringLiteral("defaultLayout"), QStringLiteral("unified")},
        {QStringLiteral("note"), ready
            ? QStringLiteral("Mounted Libraries use isolated native sessions per server. Unified mode can keep authenticated server profiles live under one filesystem while dedicated and exclusive server policies stay isolated.")
            : QStringLiteral("Install the platform filesystem provider and use a Desktop build compiled with its FUSE3 SDK to activate mounted Libraries.")},
    };
}

void LibraryMountManager::setProfileContext(const QString &profileId, const QString &profileDataPath, const QString &serverUrl)
{
    if (m_profileId == profileId && m_profileDataPath == profileDataPath && m_serverUrl == serverUrl) return;
    forceStop(); clearOwnedSourceContexts();
    m_profileId = profileId; m_profileDataPath = QDir::cleanPath(profileDataPath); m_serverUrl = serverUrl; m_userId.clear(); m_manifest.clear();
    m_cacheRoot = QDir::cleanPath(m_profileDataPath + QStringLiteral("/library-mount/cache")); QDir().mkpath(m_cacheRoot); emit statusChanged();
}

void LibraryMountManager::setAuthenticatedUser(const QString &userId)
{
    m_userId = userId.trimmed();
    if (m_userId.isEmpty()) { forceStop(); clearOwnedSourceContexts(); }
    emit statusChanged();
}

QString LibraryMountManager::resolvedMountLocation(const QString &requested) const
{
    QString value = requested.trimmed();
#ifdef Q_OS_WIN
    if (value.isEmpty()) value = QStringLiteral("L:"); if (value.size() == 1 && value.at(0).isLetter()) value += QLatin1Char(':');
    if (value.size() != 2 || !value.at(0).isLetter() || value.at(1) != QLatin1Char(':')) return {}; return value.toUpper();
#elif defined(Q_OS_MACOS)
    if (value.isEmpty() || !value.contains(QLatin1Char('/'))) value = QDir::homePath() + QStringLiteral("/Cluster Volumes/") + safeSegment(value.isEmpty() ? QStringLiteral("Cluster") : value);
    return QDir::cleanPath(value);
#else
    if (value.isEmpty() || value == QStringLiteral("~/Cluster")) value = QDir::homePath() + QStringLiteral("/Cluster"); else if (value.startsWith(QStringLiteral("~/"))) value = QDir::homePath() + value.mid(1);
    return QDir::cleanPath(value);
#endif
}

QString LibraryMountManager::separateMountLocation(const QString &base, const QString &label, int index, QSet<QString> *usedWindowsLetters) const
{
#ifdef Q_OS_WIN
    QChar start = base.size() >= 1 && base.at(0).isLetter() ? base.at(0).toUpper() : QLatin1Char('L');
    for (int offset = index; offset < 26; ++offset) {
        const QChar letter = QChar(start.unicode() + offset <= QLatin1Char('Z').unicode() ? start.unicode() + offset : QLatin1Char('D').unicode() + ((offset - (QLatin1Char('Z').unicode() - start.unicode()) - 1) % 23));
        const QString candidate = QString(letter) + QLatin1Char(':');
        if ((!usedWindowsLetters || !usedWindowsLetters->contains(candidate)) && !QFileInfo::exists(candidate + QLatin1Char('/'))) { if (usedWindowsLetters) usedWindowsLetters->insert(candidate); return candidate; }
    }
    return {};
#else
    Q_UNUSED(index); Q_UNUSED(usedWindowsLetters);
    const QFileInfo baseInfo(base); QString parent = baseInfo.absolutePath();
    if (base.endsWith(QStringLiteral("/Cluster")) || base.endsWith(QStringLiteral("/Cluster Volumes/Cluster"))) parent = baseInfo.absolutePath();
    return QDir::cleanPath(parent + QLatin1Char('/') + safeSegment(QStringLiteral("Cluster - ") + label));
#endif
}

QString LibraryMountManager::sourceLabel(const QVariantMap &profile) const
{
    QString label = profile.value(QStringLiteral("serverLabel")).toString().trimmed(); if (label.isEmpty()) label = profile.value(QStringLiteral("label")).toString().trimmed();
    if (label.isEmpty()) label = QUrl(profile.value(QStringLiteral("url")).toString()).host(); return safeSegment(label);
}

LibraryMountManager::SourceContext *LibraryMountManager::sourceById(const QString &profileId) const { return m_sources.value(profileId, nullptr); }

void LibraryMountManager::clearOwnedSourceContexts()
{
    for (SourceContext *source : std::as_const(m_sources)) {
        if (!source) continue;
        if (source->ownsObjects) { delete source->transfers; delete source->api; }
        delete source;
    }
    m_sources.clear();
}

void LibraryMountManager::rebuildSourceContexts()
{
    clearOwnedSourceContexts();
    const QVariantList profiles = m_profiles ? m_profiles->profiles() : QVariantList{};
    QSet<QString> labels;
    for (const QVariant &value : profiles) {
        const QVariantMap profile = value.toMap(); const QString id = profile.value(QStringLiteral("id")).toString(); if (id.isEmpty()) continue;
        auto *source = new SourceContext; source->profileId = id; source->serverUrl = profile.value(QStringLiteral("url")).toString(); source->nativeDataPath = profile.value(QStringLiteral("nativeDataPath")).toString(); source->active = id == m_profileId;
        QString label = sourceLabel(profile), unique = label; for (int n = 2; labels.contains(unique.toLower()); ++n) unique = QStringLiteral("%1 %2").arg(label).arg(n); labels.insert(unique.toLower()); source->label = unique;
        if (source->active) { source->api = m_api; source->transfers = m_transfers; source->authenticated = !m_userId.isEmpty() && m_api && !m_api->sessionCookieHeader().isEmpty(); }
        else {
            source->ownsObjects = true; source->api = new ApiClient(this); QString error;
            if (!source->api->setProfileContext(id, source->nativeDataPath, &error) || !source->api->setBaseUrl(source->serverUrl, &error)) {
                source->error = {{QStringLiteral("code"), QStringLiteral("PROFILE_INVALID")}, {QStringLiteral("message"), error}}; source->terminal = true;
            } else {
                source->authenticated = !source->api->sessionCookieHeader().isEmpty(); source->transfers = new TransferManager(source->api, this); source->transfers->setProfileDataRoot(source->nativeDataPath); source->transfers->setScope(source->serverUrl + QLatin1Char('|') + id + QStringLiteral("|library-mount"));
                connect(source->api, &ApiClient::succeeded, this, [this, source](const QString &operation, const QJsonValue &payload) { if (operation.startsWith(QStringLiteral("libraryMount:"))) handleSourceSuccess(source, operation, payload); });
                connect(source->api, &ApiClient::failed, this, [this, source](const QString &operation, const QVariantMap &errorMap) { if (operation.startsWith(QStringLiteral("libraryMount:"))) handleSourceFailure(source, operation, errorMap); });
            }
        }
        if (source->transfers) connect(source->transfers, &TransferManager::transferCompleted, this, [this](const QString &, const QVariantMap &result) { if (result.contains(QStringLiteral("item")) && !m_refreshing) refresh(); });
        m_sources.insert(id, source);
    }
}

bool LibraryMountManager::start(const QVariantMap &options)
{
    m_lastError.clear(); if (m_userId.isEmpty()) { m_lastError = {{QStringLiteral("code"), QStringLiteral("NATIVE_SESSION_REQUIRED")}, {QStringLiteral("message"), QStringLiteral("Cluster must establish its native server session before mounting Libraries.")}}; emit statusChanged(); return false; }
    m_layout = options.value(QStringLiteral("layout"), QStringLiteral("unified")).toString() == QStringLiteral("separate") ? QStringLiteral("separate") : QStringLiteral("unified");
    m_organization = options.value(QStringLiteral("organization"), QStringLiteral("servers")).toString() == QStringLiteral("libraries") ? QStringLiteral("libraries") : QStringLiteral("servers");
    m_mountLocation = resolvedMountLocation(options.value(QStringLiteral("location")).toString()); if (m_mountLocation.isEmpty()) { m_lastError = {{QStringLiteral("code"), QStringLiteral("INVALID_MOUNT_LOCATION")}, {QStringLiteral("message"), QStringLiteral("Choose a valid mount location for this operating system.")}}; emit statusChanged(); return false; }
    ClusterFuseMount probe; if (!providerDetected() || !probe.available()) { m_lastError = {{QStringLiteral("code"), QStringLiteral("MOUNT_PROVIDER_UNAVAILABLE")}, {QStringLiteral("message"), status().value(QStringLiteral("note")).toString()}}; emit statusChanged(); return false; }
    m_requestedRunning = true; return refresh();
}

bool LibraryMountManager::stop()
{
    if (activeMountRequired()) { m_lastError = {{QStringLiteral("code"), QStringLiteral("MOUNT_REQUIRED_BY_SERVER")}, {QStringLiteral("message"), QStringLiteral("This server requires its Libraries to remain mounted while the Desktop native session is active.")}}; emit statusChanged(); return false; }
    m_requestedRunning = false; stopMounts(); m_lastError.clear(); emit statusChanged(); return true;
}

void LibraryMountManager::forceStop() { m_requestedRunning = false; stopMounts(); }

void LibraryMountManager::stopMounts()
{
    for (ClusterFuseMount *mount : std::as_const(m_mounts)) { if (mount) { mount->stop(); mount->deleteLater(); } }
    m_mounts.clear();
}

bool LibraryMountManager::refresh()
{
    if (!m_api || m_userId.isEmpty() || m_refreshing) return false;
    m_refreshing = true; m_lastError.clear(); rebuildSourceContexts();
    for (SourceContext *source : std::as_const(m_sources)) requestSourceManifest(source);
    finishSourceRefreshIfReady(); emit statusChanged(); return true;
}

void LibraryMountManager::requestSourceManifest(SourceContext *source)
{
    if (!source || source->terminal) return;
    if (!source->api || !source->authenticated) {
        source->terminal = true; source->error = {{QStringLiteral("code"), QStringLiteral("NATIVE_SESSION_REQUIRED")}, {QStringLiteral("message"), source->active ? QStringLiteral("Native session is not ready.") : QStringLiteral("Activate this server once in Cluster Desktop to establish its secure native session before including it in a unified mount.")}}; return;
    }
    source->terminal = false; source->error.clear();
    if (source->active && !source->api->csrfToken().isEmpty()) source->api->getJson(operationFor(QStringLiteral("manifest"), source->profileId), QStringLiteral("/api/desktop-libraries/mount-manifest"));
    else source->api->getJson(operationFor(QStringLiteral("csrf"), source->profileId), QStringLiteral("/api/auth/csrf"));
}

void LibraryMountManager::handleSourceSuccess(SourceContext *source, const QString &operation, const QJsonValue &payload)
{
    if (!source) return; const QString kind = operationKind(operation);
    if (kind == QStringLiteral("csrf")) {
        const QString token = payload.toObject().value(QStringLiteral("token")).toString(); if (token.isEmpty()) { source->terminal = true; source->authenticated = false; source->error = {{QStringLiteral("code"), QStringLiteral("CSRF_UNAVAILABLE")}, {QStringLiteral("message"), QStringLiteral("The saved native session could not issue a CSRF token.")}}; finishSourceRefreshIfReady(); return; }
        source->api->setCsrfToken(token); source->api->getJson(operationFor(QStringLiteral("manifest"), source->profileId), QStringLiteral("/api/desktop-libraries/mount-manifest")); return;
    }
    if (kind == QStringLiteral("manifest")) {
        source->manifest = payload.toObject().toVariantMap(); source->terminal = true; source->authenticated = true; source->error.clear();
        if (source->active) m_manifest = source->manifest; finishSourceRefreshIfReady();
    }
}

void LibraryMountManager::handleSourceFailure(SourceContext *source, const QString &operation, const QVariantMap &error)
{
    Q_UNUSED(operation) if (!source) return; source->terminal = true; source->error = error;
    if (error.value(QStringLiteral("status")).toInt() == 401) source->authenticated = false; finishSourceRefreshIfReady();
}

void LibraryMountManager::finishSourceRefreshIfReady()
{
    if (!m_refreshing) return;
    for (SourceContext *source : std::as_const(m_sources)) if (source && !source->terminal) return;
    m_refreshing = false; if (m_requestedRunning) applyTopology(); emit statusChanged();
}

QVariantList LibraryMountManager::arrangeSourceManifest(const SourceContext *source, bool unified, QVariantList *roots, QSet<QString> *syntheticPaths) const
{
    QVariantList output; if (!source) return output; const QVariantList entries = source->manifest.value(QStringLiteral("entries")).toList();
    auto addSynthetic = [&](const QString &path) { if (!syntheticPaths || path.isEmpty() || syntheticPaths->contains(path.toLower())) return; syntheticPaths->insert(path.toLower()); output << QVariantMap{{QStringLiteral("relativePath"), path}, {QStringLiteral("kind"), QStringLiteral("folder")}, {QStringLiteral("synthetic"), true}, {QStringLiteral("writable"), false}}; };
    if (!unified) {
        if (roots) *roots << QString(); for (const QVariant &value : entries) { QVariantMap entry = value.toMap(); entry.insert(QStringLiteral("sourceProfileId"), source->profileId); output << entry; } return output;
    }
    const QString serverLabel = safeSegment(source->label);
    if (m_organization == QStringLiteral("servers")) {
        addSynthetic(serverLabel); if (roots) *roots << serverLabel;
        for (const QVariant &value : entries) { QVariantMap entry = value.toMap(); entry.insert(QStringLiteral("sourceProfileId"), source->profileId); entry.insert(QStringLiteral("relativePath"), serverLabel + QLatin1Char('/') + entry.value(QStringLiteral("relativePath")).toString()); output << entry; }
        return output;
    }
    QSet<QString> sourceRoots;
    for (const QVariant &value : entries) {
        QVariantMap entry = value.toMap(); const QString relative = entry.value(QStringLiteral("relativePath")).toString(); const int slash = relative.indexOf(QLatin1Char('/'));
        const bool rootFile = slash < 0 && entry.value(QStringLiteral("kind")).toString() == QStringLiteral("file");
        QString root, tail;
        if (rootFile) { root = QStringLiteral("Loose Files"); tail = relative; }
        else { root = slash >= 0 ? relative.left(slash) : relative; tail = slash >= 0 ? relative.mid(slash + 1) : QString(); }
        addSynthetic(root); const QString routingRoot = root + QLatin1Char('/') + serverLabel; sourceRoots.insert(routingRoot);
        entry.insert(QStringLiteral("sourceProfileId"), source->profileId); entry.insert(QStringLiteral("relativePath"), routingRoot + (tail.isEmpty() ? QString() : QLatin1Char('/') + tail)); output << entry;
    }
    if (entries.isEmpty()) { addSynthetic(QStringLiteral("Libraries")); sourceRoots.insert(QStringLiteral("Libraries/") + serverLabel); }
    for (const QString &root : sourceRoots) if (roots) *roots << root; return output;
}

QVariantMap LibraryMountManager::sourceRuntimeConfig(const SourceContext *source, const QVariantList &roots) const
{
    return {{QStringLiteral("id"), source->profileId}, {QStringLiteral("serverUrl"), source->serverUrl}, {QStringLiteral("cookieHeader"), source->api ? source->api->sessionCookieHeader() : QByteArray{}},
            {QStringLiteral("csrfToken"), source->api ? source->api->csrfToken() : QString()}, {QStringLiteral("roots"), roots}, {QStringLiteral("readOnly"), source->manifest.value(QStringLiteral("readOnly")).toBool()}};
}

void LibraryMountManager::applyTopology()
{
    stopMounts(); m_lastError.clear();
    QList<SourceContext *> eligible; SourceContext *active = sourceById(m_profileId);
    for (SourceContext *source : std::as_const(m_sources)) if (source && source->authenticated && !source->manifest.isEmpty() && source->manifest.value(QStringLiteral("mountPolicy")).toString() != QStringLiteral("disabled")) eligible << source;
    if (eligible.isEmpty()) { m_lastError = {{QStringLiteral("code"), QStringLiteral("NO_MOUNTABLE_SERVERS")}, {QStringLiteral("message"), QStringLiteral("No saved server profile currently has both mounted-Library permission and a valid native session.")}}; emit statusChanged(); return; }
    const bool activeExclusive = active && active->manifest.value(QStringLiteral("mountIsolation")).toString() == QStringLiteral("exclusive");
    if (activeExclusive) eligible = {active};

    QList<SourceContext *> shared; QList<SourceContext *> separate;
    for (SourceContext *source : eligible) {
        const QString isolation = source->manifest.value(QStringLiteral("mountIsolation")).toString();
        if (isolation == QStringLiteral("exclusive") && source != active) continue;
        if (m_layout == QStringLiteral("separate") || isolation == QStringLiteral("dedicated") || isolation == QStringLiteral("exclusive")) separate << source; else shared << source;
    }

    QSet<QString> usedLetters; int separateIndex = 0;
    auto createMount = [this](const QString &location, const QString &cacheRoot, const QList<SourceContext *> &sources, bool unified) -> bool {
        QVariantList allEntries, configs; QSet<QString> syntheticPaths;
        for (SourceContext *source : sources) {
            QVariantList roots; const QVariantList entries = arrangeSourceManifest(source, unified, &roots, &syntheticPaths); allEntries.append(entries); configs << sourceRuntimeConfig(source, roots);
        }
        auto *mount = new ClusterFuseMount(this); connect(mount, &ClusterFuseMount::stateChanged, this, &LibraryMountManager::statusChanged);
        connect(mount, &ClusterFuseMount::fileDirty, this, &LibraryMountManager::queueDirtyFile);
        connect(mount, &ClusterFuseMount::metadataChanged, this, [this](const QString &) { if (!m_refreshing) refresh(); });
        QDir().mkpath(cacheRoot); mount->configure(location, cacheRoot, configs, allEntries);
        if (!mount->start()) { m_lastError = {{QStringLiteral("code"), QStringLiteral("MOUNT_START_FAILED")}, {QStringLiteral("message"), mount->lastError()}}; mount->deleteLater(); return false; }
        m_mounts << mount; return true;
    };

    if (!shared.isEmpty()) {
        const QString cache = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation) + QStringLiteral("/library-mount/unified-cache"));
        if (!createMount(m_mountLocation, cache, shared, true)) return;
#ifdef Q_OS_WIN
        usedLetters.insert(m_mountLocation);
#endif
    }
    for (SourceContext *source : separate) {
        const QString location = shared.isEmpty() && separate.size() == 1 ? m_mountLocation : separateMountLocation(m_mountLocation, source->label, separateIndex++, &usedLetters);
        if (location.isEmpty()) { m_lastError = {{QStringLiteral("code"), QStringLiteral("MOUNT_LOCATION_UNAVAILABLE")}, {QStringLiteral("message"), QStringLiteral("Cluster could not allocate a mount location for every isolated server.")}}; break; }
        const QString cache = QDir::cleanPath(source->nativeDataPath + QStringLiteral("/library-mount/cache")); if (!createMount(location, cache, {source}, false)) break;
    }
    emit statusChanged();
}

bool LibraryMountManager::clearCache()
{
    if (anyRunning()) { m_lastError = {{QStringLiteral("code"), QStringLiteral("MOUNT_ACTIVE")}, {QStringLiteral("message"), QStringLiteral("Unmount Cluster Libraries before clearing their local cache.")}}; emit statusChanged(); return false; }
    QStringList caches; caches << QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation) + QStringLiteral("/library-mount/unified-cache"));
    if (m_profiles) for (const QVariant &value : m_profiles->profiles()) { const QString root = value.toMap().value(QStringLiteral("nativeDataPath")).toString(); if (!root.isEmpty()) caches << QDir::cleanPath(root + QStringLiteral("/library-mount/cache")); }
    for (const QString &path : caches) { QDir cache(path); if (cache.exists() && !cache.removeRecursively()) return false; QDir().mkpath(path); }
    m_lastError.clear(); emit statusChanged(); return true;
}

void LibraryMountManager::queueDirtyFile(const QString &sourceId, const QString &relativePath, const QString &itemId, int revision, const QString &localPath, const QString &parentId)
{
    SourceContext *source = sourceById(sourceId); if (!source || !source->transfers || source->manifest.value(QStringLiteral("readOnly")).toBool()) return;
    const QFileInfo info(localPath); if (!info.exists() || !info.isFile()) return; QMimeDatabase db;
    QVariantMap body {{QStringLiteral("itemId"), itemId.isEmpty() ? QVariant() : QVariant(itemId)}, {QStringLiteral("parentId"), parentId.isEmpty() ? QVariant() : QVariant(parentId)},
                      {QStringLiteral("originalName"), info.fileName()}, {QStringLiteral("mimeType"), db.mimeTypeForFile(info).name()}};
    if (!itemId.isEmpty() && revision > 0) body.insert(QStringLiteral("expectedRevision"), revision);
    if (source->transfers->startUpload(localPath, QStringLiteral("staged-file"),
            QStringLiteral("/api/desktop-libraries/from-upload"), body).isEmpty()) {
        m_lastError = {{QStringLiteral("code"), QStringLiteral("TRANSFER_QUEUE_UNAVAILABLE")},
                       {QStringLiteral("message"), QStringLiteral("The current Desktop process cannot write to this Library transfer queue. Use the owning window or retry after it exits.")}};
        emit statusChanged();
    }
    Q_UNUSED(relativePath)
}
