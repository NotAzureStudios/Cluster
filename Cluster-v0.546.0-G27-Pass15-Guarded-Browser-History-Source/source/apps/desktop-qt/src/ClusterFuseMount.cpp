#include "ClusterFuseMount.h"

#include <QCryptographicHash>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSaveFile>
#include <QSet>
#include <QTimer>
#include <QUrl>

#ifdef CLUSTER_HAS_FUSE3
#define FUSE_USE_VERSION 32
#include <fuse3/fuse.h>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

ClusterFuseMount::ClusterFuseMount(QObject *parent) : QObject(parent) {}
ClusterFuseMount::~ClusterFuseMount() { stop(); }

bool ClusterFuseMount::available() const
{
#ifdef CLUSTER_HAS_FUSE3
    return true;
#else
    return false;
#endif
}

void ClusterFuseMount::configure(const QString &mountPoint, const QString &cacheRoot,
                                 const QVariantList &sources, const QVariantList &manifest)
{
    if (m_running) return;
    m_mountPoint = QDir::cleanPath(mountPoint);
    m_cacheRoot = QDir::cleanPath(cacheRoot);
    m_sourceConfig = sources;
#ifdef CLUSTER_HAS_FUSE3
    {
        QWriteLocker locker(&m_lock);
        m_sources.clear();
        for (const QVariant &value : sources) {
            const QVariantMap map = value.toMap();
            Source source;
            source.id = map.value(QStringLiteral("id")).toString();
            source.serverUrl = map.value(QStringLiteral("serverUrl")).toString();
            source.cookieHeader = map.value(QStringLiteral("cookieHeader")).toByteArray();
            source.csrfToken = map.value(QStringLiteral("csrfToken")).toString();
            source.readOnly = map.value(QStringLiteral("readOnly")).toBool();
            for (const QVariant &root : map.value(QStringLiteral("roots")).toList())
                source.roots << normalizedRelative(root.toString());
            if (!source.id.isEmpty() && !source.serverUrl.isEmpty()) m_sources.insert(source.id, source);
        }
    }
#endif
    updateManifest(manifest);
}

void ClusterFuseMount::updateManifest(const QVariantList &manifest)
{
    QWriteLocker locker(&m_lock);
    m_manifest = manifest;
#ifdef CLUSTER_HAS_FUSE3
    m_entries.clear();
    for (const QVariant &value : manifest) {
        const QVariantMap map = value.toMap();
        Entry entry;
        entry.id = map.value(QStringLiteral("id")).toString();
        entry.parentId = map.value(QStringLiteral("parentId")).toString();
        entry.sourceId = map.value(QStringLiteral("sourceProfileId")).toString();
        entry.relativePath = normalizedRelative(map.value(QStringLiteral("relativePath")).toString());
        entry.kind = map.value(QStringLiteral("kind")).toString();
        entry.mimeType = map.value(QStringLiteral("mimeType")).toString();
        entry.checksum = map.value(QStringLiteral("checksumSha256")).toString().toLower();
        entry.size = map.value(QStringLiteral("sizeBytes")).toLongLong();
        entry.revision = map.value(QStringLiteral("revision")).toInt();
        entry.writable = map.value(QStringLiteral("writable")).toBool();
        entry.synthetic = map.value(QStringLiteral("synthetic")).toBool();
        if (!entry.relativePath.isEmpty()) m_entries.insert(entry.relativePath, entry);
    }
#endif
}

void ClusterFuseMount::rebuildEntries(const QVariantList &manifest) { updateManifest(manifest); }

#ifdef CLUSTER_HAS_FUSE3
QString ClusterFuseMount::normalizedRelative(const QString &path)
{
    QString value = QDir::cleanPath(path).replace(QChar(u'\\'), QChar(u'/'));
    while (value.startsWith(QLatin1Char('/'))) value.remove(0, 1);
    if (value == QStringLiteral(".") || value.startsWith(QStringLiteral("..")) || QDir::isAbsolutePath(value)) return {};
    return value;
}

QString ClusterFuseMount::hashFileSha256(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) return {};
    QCryptographicHash hash(QCryptographicHash::Sha256);
    while (!file.atEnd()) hash.addData(file.read(1024 * 1024));
    return QString::fromLatin1(hash.result().toHex());
}

namespace {
ClusterFuseMount *mountSelf()
{
    const fuse_context *context = fuse_get_context();
    return context ? static_cast<ClusterFuseMount *>(context->private_data) : nullptr;
}
QString rel(const char *path)
{
    QString value = QString::fromUtf8(path ? path : "");
    while (value.startsWith(QLatin1Char('/'))) value.remove(0, 1);
    value = QDir::cleanPath(value).replace(QChar(u'\\'), QChar(u'/'));
    return value == QStringLiteral(".") ? QString() : value;
}
int clusterGetattr(const char *path, struct stat *st, struct fuse_file_info *)
{
    std::memset(st, 0, sizeof(*st));
    auto *self = mountSelf(); if (!self) return -EIO;
    const QString relative = rel(path);
    if (relative.isEmpty()) { st->st_mode = S_IFDIR | 0755; st->st_nlink = 2; return 0; }
    const auto entry = self->entryForPath(relative);
    if (!entry.relativePath.isEmpty()) {
        if (entry.kind == QStringLiteral("folder")) { st->st_mode = S_IFDIR | (entry.writable ? 0755 : 0555); st->st_nlink = 2; return 0; }
        st->st_mode = S_IFREG | (entry.writable ? 0644 : 0444); st->st_nlink = 1;
        const QFileInfo cached(self->cachePathFor(relative)); st->st_size = cached.exists() ? cached.size() : entry.size; return 0;
    }
    const QFileInfo local(self->cachePathFor(relative));
    if (local.exists()) {
        if (local.isDir()) { st->st_mode = S_IFDIR | (self->canWritePath(relative) ? 0755 : 0555); st->st_nlink = 2; }
        else { st->st_mode = S_IFREG | (self->canWritePath(relative) ? 0644 : 0444); st->st_nlink = 1; st->st_size = local.size(); }
        return 0;
    }
    if (self->childExists(relative)) { st->st_mode = S_IFDIR | (self->canWritePath(relative) ? 0755 : 0555); st->st_nlink = 2; return 0; }
    return -ENOENT;
}
int clusterReaddir(const char *path, void *buf, fuse_fill_dir_t filler, off_t, struct fuse_file_info *, enum fuse_readdir_flags)
{
    auto *self = mountSelf(); if (!self) return -EIO;
    const QString parent = rel(path);
    filler(buf, ".", nullptr, 0, fuse_fill_dir_flags(0)); filler(buf, "..", nullptr, 0, fuse_fill_dir_flags(0));
    QSet<QString> names;
    for (const QString &name : self->childrenForPath(parent)) names.insert(name);
    const QDir local(self->cachePathFor(parent));
    if (local.exists()) for (const QFileInfo &info : local.entryInfoList(QDir::NoDotAndDotDot | QDir::AllEntries)) names.insert(info.fileName());
    for (const QString &name : names) filler(buf, name.toUtf8().constData(), nullptr, 0, fuse_fill_dir_flags(0));
    return 0;
}
int clusterOpen(const char *path, struct fuse_file_info *fi)
{
    auto *self = mountSelf(); if (!self) return -EIO;
    const auto entry = self->entryForPath(rel(path));
    if (entry.relativePath.isEmpty() || entry.kind == QStringLiteral("folder")) return -ENOENT;
    if ((fi->flags & O_ACCMODE) != O_RDONLY && (!entry.writable || !self->canWritePath(entry.relativePath))) return -EACCES;
    if (!self->materialize(entry)) return -EIO;
    return 0;
}
int clusterRead(const char *path, char *buf, size_t size, off_t offset, struct fuse_file_info *)
{
    auto *self = mountSelf(); if (!self) return -EIO;
    const QString relative = rel(path); const auto entry = self->entryForPath(relative);
    if (!entry.relativePath.isEmpty() && !self->materialize(entry)) return -EIO;
    QFile file(self->cachePathFor(relative)); if (!file.open(QIODevice::ReadOnly)) return -ENOENT;
    if (!file.seek(offset)) return -EIO;
    const qint64 read = file.read(buf, qint64(size)); return read < 0 ? -EIO : int(read);
}
int clusterWrite(const char *path, const char *buf, size_t size, off_t offset, struct fuse_file_info *)
{
    auto *self = mountSelf(); if (!self) return -EIO;
    const QString relative = rel(path); const auto entry = self->entryForPath(relative);
    if (!self->canWritePath(relative) || (!entry.relativePath.isEmpty() && !entry.writable)) return -EACCES;
    if (!entry.relativePath.isEmpty() && !entry.id.isEmpty() && !self->materialize(entry)) return -EIO;
    const QString localPath = self->cachePathFor(relative); QDir().mkpath(QFileInfo(localPath).absolutePath());
    QFile file(localPath); if (!file.open(QIODevice::ReadWrite)) return -EIO;
    if (!file.seek(offset)) return -EIO;
    const qint64 written = file.write(buf, qint64(size)); return written < 0 ? -EIO : int(written);
}
int clusterCreate(const char *path, mode_t, struct fuse_file_info *)
{
    auto *self = mountSelf(); if (!self) return -EIO;
    const QString relative = rel(path); if (relative.isEmpty() || !self->canWritePath(relative)) return -EACCES;
    if (!self->entryForPath(relative).relativePath.isEmpty() || QFileInfo::exists(self->cachePathFor(relative))) return -EEXIST;
    const QString localPath = self->cachePathFor(relative); QDir().mkpath(QFileInfo(localPath).absolutePath());
    QFile file(localPath); if (!file.open(QIODevice::WriteOnly | QIODevice::NewOnly)) return -EIO;
    file.close(); self->addPendingFile(relative); return 0;
}
int clusterMkdir(const char *path, mode_t)
{
    auto *self = mountSelf(); if (!self) return -EIO;
    const QString relative = rel(path); if (relative.isEmpty() || !self->canWritePath(relative)) return -EACCES;
    if (self->childExists(relative) || !self->entryForPath(relative).relativePath.isEmpty()) return -EEXIST;
    return self->createRemoteFolder(relative) ? 0 : -EIO;
}
int clusterTruncate(const char *path, off_t size, struct fuse_file_info *)
{
    auto *self = mountSelf(); if (!self) return -EIO; const QString relative = rel(path); const auto entry = self->entryForPath(relative);
    if (!self->canWritePath(relative) || (!entry.relativePath.isEmpty() && !entry.writable)) return -EACCES;
    if (!entry.relativePath.isEmpty() && !entry.id.isEmpty() && !self->materialize(entry)) return -EIO;
    QFile file(self->cachePathFor(relative)); if (!file.open(QIODevice::ReadWrite)) return -EIO; return file.resize(size) ? 0 : -EIO;
}
int clusterRelease(const char *path, struct fuse_file_info *fi)
{
    auto *self = mountSelf(); if (!self) return -EIO;
    if ((fi->flags & O_ACCMODE) == O_RDONLY) return 0;
    const QString relative = rel(path); const auto entry = self->entryForPath(relative);
    if (!self->canWritePath(relative)) return -EACCES;
    emit self->fileDirty(self->sourceIdForPath(relative), relative, entry.id, entry.revision,
                         self->cachePathFor(relative), self->parentItemIdForPath(relative));
    return 0;
}
int clusterUnlink(const char *path)
{
    auto *self = mountSelf(); if (!self) return -EIO; const QString relative = rel(path); const auto entry = self->entryForPath(relative);
    if (!self->canWritePath(relative) || (!entry.relativePath.isEmpty() && !entry.writable)) return -EACCES;
    if (!entry.id.isEmpty() && !self->deleteRemoteEntry(entry)) return -EIO;
    QFile::remove(self->cachePathFor(relative)); self->removeEntry(relative); emit self->metadataChanged(entry.sourceId.isEmpty() ? self->sourceIdForPath(relative) : entry.sourceId); return 0;
}
int clusterRmdir(const char *path)
{
    auto *self = mountSelf(); if (!self) return -EIO; const QString relative = rel(path); const auto entry = self->entryForPath(relative);
    if (entry.relativePath.isEmpty() || entry.synthetic) return -EACCES;
    if (!entry.writable || !self->canWritePath(relative)) return -EACCES;
    if (self->childExists(relative) || !self->childrenForPath(relative).isEmpty()) return -ENOTEMPTY;
    if (!entry.id.isEmpty() && !self->deleteRemoteEntry(entry)) return -EIO;
    QDir(self->cachePathFor(relative)).removeRecursively(); self->removeEntry(relative); emit self->metadataChanged(entry.sourceId); return 0;
}
int clusterRename(const char *from, const char *to, unsigned int flags)
{
    if (flags) return -EINVAL; auto *self = mountSelf(); if (!self) return -EIO;
    const QString source = rel(from), destination = rel(to);
    if (source.isEmpty() || destination.isEmpty()) return -EINVAL;
    if (self->parentRelativePath(source) != self->parentRelativePath(destination)) return -EXDEV;
    if (!self->entryForPath(destination).relativePath.isEmpty() || QFileInfo::exists(self->cachePathFor(destination))) return -EEXIST;
    const auto entry = self->entryForPath(source);
    if (!self->canWritePath(source) || !self->canWritePath(destination) || (!entry.relativePath.isEmpty() && !entry.writable) || entry.synthetic) return -EACCES;
    int nextRevision = entry.revision;
    if (!entry.id.isEmpty() && !self->renameRemoteEntry(entry, QFileInfo(destination).fileName(), &nextRevision)) return -EIO;
    if (!self->renameEntryPath(source, destination, nextRevision)) return -EIO;
    emit self->metadataChanged(entry.sourceId.isEmpty() ? self->sourceIdForPath(destination) : entry.sourceId); return 0;
}
}

ClusterFuseMount::Entry ClusterFuseMount::entryForPath(const QString &path) const
{
    QReadLocker locker(&m_lock); return m_entries.value(normalizedRelative(path));
}

ClusterFuseMount::Source ClusterFuseMount::sourceForPath(const QString &path) const
{
    QReadLocker locker(&m_lock);
    const QString normalized = normalizedRelative(path);
    QString probe = normalized;
    while (!probe.isEmpty()) {
        const auto entry = m_entries.constFind(probe);
        if (entry != m_entries.constEnd() && !entry->sourceId.isEmpty()) return m_sources.value(entry->sourceId);
        probe = parentRelativePath(probe);
    }
    int bestLength = -1; Source best;
    for (auto it = m_sources.constBegin(); it != m_sources.constEnd(); ++it) {
        for (const QString &root : it->roots) {
            if (root.isEmpty() || normalized == root || normalized.startsWith(root + QLatin1Char('/'))) {
                if (root.size() > bestLength) { bestLength = root.size(); best = it.value(); }
            }
        }
    }
    return best;
}

QString ClusterFuseMount::sourceIdForPath(const QString &path) const { return sourceForPath(path).id; }

QString ClusterFuseMount::cachePathFor(const QString &relativePath) const
{
    const QString cleaned = normalizedRelative(relativePath);
    if (cleaned.isEmpty() && !relativePath.trimmed().isEmpty()) return m_cacheRoot;
    return cleaned.isEmpty() ? m_cacheRoot : QDir::cleanPath(m_cacheRoot + QLatin1Char('/') + cleaned);
}

QString ClusterFuseMount::parentRelativePath(const QString &path) const
{
    const QString normalized = normalizedRelative(path); if (normalized.isEmpty()) return {};
    const int slash = normalized.lastIndexOf(QLatin1Char('/')); return slash < 0 ? QString() : normalized.left(slash);
}

bool ClusterFuseMount::childExists(const QString &path) const
{
    QReadLocker locker(&m_lock); const QString normalized = normalizedRelative(path); const QString prefix = normalized.isEmpty() ? QString() : normalized + QLatin1Char('/');
    for (auto it = m_entries.constBegin(); it != m_entries.constEnd(); ++it) if (it.key().startsWith(prefix) && it.key() != normalized) return true; return false;
}

QStringList ClusterFuseMount::childrenForPath(const QString &path) const
{
    QReadLocker locker(&m_lock); QSet<QString> names; const QString normalized = normalizedRelative(path);
    for (auto it = m_entries.constBegin(); it != m_entries.constEnd(); ++it) if (parentRelativePath(it.key()) == normalized) names.insert(QFileInfo(it.key()).fileName());
    QStringList result = names.values(); result.sort(Qt::CaseInsensitive); return result;
}

bool ClusterFuseMount::canWritePath(const QString &path) const
{
    const Source source = sourceForPath(path); if (source.id.isEmpty() || source.readOnly) return false;
    QString probe = normalizedRelative(path);
    while (!probe.isEmpty()) {
        const Entry entry = entryForPath(probe);
        if (!entry.relativePath.isEmpty() && !entry.synthetic) return entry.writable;
        probe = parentRelativePath(probe);
    }
    return true;
}

QString ClusterFuseMount::parentItemIdForPath(const QString &path) const
{
    QString probe = parentRelativePath(path);
    while (!probe.isEmpty()) {
        const Entry entry = entryForPath(probe);
        if (!entry.id.isEmpty() && entry.kind == QStringLiteral("folder")) return entry.id;
        probe = parentRelativePath(probe);
    }
    return {};
}

void ClusterFuseMount::addPendingFile(const QString &path)
{
    const QString normalized = normalizedRelative(path); const Source source = sourceForPath(normalized); if (normalized.isEmpty() || source.id.isEmpty()) return;
    Entry entry; entry.sourceId = source.id; entry.parentId = parentItemIdForPath(normalized); entry.relativePath = normalized; entry.kind = QStringLiteral("file"); entry.writable = !source.readOnly;
    QWriteLocker locker(&m_lock); m_entries.insert(normalized, entry);
}

void ClusterFuseMount::removeEntry(const QString &path)
{
    const QString normalized = normalizedRelative(path); QWriteLocker locker(&m_lock);
    const QString prefix = normalized + QLatin1Char('/');
    for (auto it = m_entries.begin(); it != m_entries.end();) it = (it.key() == normalized || it.key().startsWith(prefix)) ? m_entries.erase(it) : ++it;
}

bool ClusterFuseMount::performJson(const Source &source, const QByteArray &method, const QString &path, const QVariantMap &body, QVariantMap *response) const
{
    if (source.serverUrl.isEmpty() || source.cookieHeader.isEmpty()) return false;
    QString base = source.serverUrl; while (base.endsWith(QLatin1Char('/'))) base.chop(1);
    QNetworkRequest request(QUrl(base + path));
    request.setRawHeader(QByteArrayLiteral("Accept"), QByteArrayLiteral("application/json"));
    request.setRawHeader(QByteArrayLiteral("Cookie"), source.cookieHeader);
    if (method != QByteArrayLiteral("GET")) {
        request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
        if (!source.csrfToken.isEmpty()) request.setRawHeader(QByteArrayLiteral("X-Cluster-CSRF"), source.csrfToken.toUtf8());
    }
    QNetworkAccessManager network; const QByteArray payload = QJsonDocument(QJsonObject::fromVariantMap(body)).toJson(QJsonDocument::Compact);
    QNetworkReply *reply = method == QByteArrayLiteral("GET") ? network.get(request) : network.sendCustomRequest(request, method, payload);
    QEventLoop loop; QTimer timer; timer.setSingleShot(true); timer.setInterval(30000);
    QObject::connect(&timer, &QTimer::timeout, reply, &QNetworkReply::abort); QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit); timer.start(); loop.exec(); timer.stop();
    const QByteArray bytes = reply->readAll(); const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const bool ok = reply->error() == QNetworkReply::NoError && status >= 200 && status < 300;
    if (ok && response) { const QJsonDocument doc = QJsonDocument::fromJson(bytes); if (doc.isObject()) *response = doc.object().toVariantMap(); }
    reply->deleteLater(); return ok;
}

bool ClusterFuseMount::createRemoteFolder(const QString &path)
{
    const QString normalized = normalizedRelative(path); const Source source = sourceForPath(normalized); if (source.id.isEmpty() || source.readOnly) return false;
    QVariantMap result; if (!performJson(source, QByteArrayLiteral("POST"), QStringLiteral("/api/desktop-libraries/folders"),
        {{QStringLiteral("parentId"), parentItemIdForPath(normalized)}, {QStringLiteral("title"), QFileInfo(normalized).fileName()}}, &result)) return false;
    const QVariantMap item = result.value(QStringLiteral("item")).toMap(); const QString id = item.value(QStringLiteral("id")).toString(); if (id.isEmpty()) return false;
    Entry entry; entry.id = id; entry.parentId = parentItemIdForPath(normalized); entry.sourceId = source.id; entry.relativePath = normalized; entry.kind = QStringLiteral("folder"); entry.revision = item.value(QStringLiteral("revision"), 1).toInt(); entry.writable = true;
    { QWriteLocker locker(&m_lock); m_entries.insert(normalized, entry); }
    QDir().mkpath(cachePathFor(normalized)); emit metadataChanged(source.id); return true;
}

bool ClusterFuseMount::deleteRemoteEntry(const Entry &entry)
{
    if (entry.id.isEmpty() || entry.revision <= 0 || entry.synthetic) return false; const Source source = m_sources.value(entry.sourceId); if (source.id.isEmpty() || source.readOnly) return false;
    return performJson(source, QByteArrayLiteral("DELETE"), QStringLiteral("/api/knowledge/%1").arg(QString::fromLatin1(QUrl::toPercentEncoding(entry.id))), {{QStringLiteral("expectedRevision"), entry.revision}});
}

bool ClusterFuseMount::renameRemoteEntry(const Entry &entry, const QString &newName, int *nextRevision)
{
    if (entry.id.isEmpty() || entry.revision <= 0 || entry.synthetic) return false; const Source source = m_sources.value(entry.sourceId); if (source.id.isEmpty() || source.readOnly) return false;
    QVariantMap result; const bool ok = performJson(source, QByteArrayLiteral("PATCH"), QStringLiteral("/api/desktop-libraries/%1/rename").arg(QString::fromLatin1(QUrl::toPercentEncoding(entry.id))),
        {{QStringLiteral("expectedRevision"), entry.revision}, {QStringLiteral("name"), newName}}, &result);
    if (ok && nextRevision) *nextRevision = result.value(QStringLiteral("item")).toMap().value(QStringLiteral("revision"), entry.revision + 1).toInt();
    return ok;
}

bool ClusterFuseMount::renameEntryPath(const QString &from, const QString &to, int nextRevision)
{
    const QString source = normalizedRelative(from), destination = normalizedRelative(to); if (source.isEmpty() || destination.isEmpty()) return false;
    const QString sourceLocal = cachePathFor(source), destinationLocal = cachePathFor(destination); QDir().mkpath(QFileInfo(destinationLocal).absolutePath());
    if (QFileInfo::exists(sourceLocal)) {
        bool moved = QFileInfo(sourceLocal).isDir() ? QDir().rename(sourceLocal, destinationLocal) : QFile::rename(sourceLocal, destinationLocal); if (!moved) return false;
    }
    QWriteLocker locker(&m_lock); QHash<QString, Entry> replacements; const QString prefix = source + QLatin1Char('/');
    for (auto it = m_entries.begin(); it != m_entries.end();) {
        if (it.key() == source || it.key().startsWith(prefix)) {
            Entry entry = it.value(); const QString tail = it.key() == source ? QString() : it.key().mid(source.size()); entry.relativePath = destination + tail;
            if (it.key() == source && nextRevision > 0) entry.revision = nextRevision; replacements.insert(entry.relativePath, entry); it = m_entries.erase(it);
        } else ++it;
    }
    for (auto it = replacements.constBegin(); it != replacements.constEnd(); ++it) m_entries.insert(it.key(), it.value()); return true;
}

bool ClusterFuseMount::materialize(const Entry &entry)
{
    if (entry.kind != QStringLiteral("file") || entry.id.isEmpty()) return true;
    const Source source = m_sources.value(entry.sourceId); if (source.id.isEmpty()) return false;
    const QString target = cachePathFor(entry.relativePath); QFileInfo existing(target);
    if (existing.exists() && existing.isFile() && (entry.size < 0 || existing.size() == entry.size)) {
        if (entry.checksum.isEmpty() || hashFileSha256(target).compare(entry.checksum, Qt::CaseInsensitive) == 0) return true;
        QFile::remove(target);
    }
    QDir().mkpath(QFileInfo(target).absolutePath());
    QString base = source.serverUrl; while (base.endsWith(QLatin1Char('/'))) base.chop(1);
    QNetworkRequest request(QUrl(base + QStringLiteral("/api/knowledge/") + QString::fromLatin1(QUrl::toPercentEncoding(entry.id)) + QStringLiteral("/file")));
    request.setRawHeader(QByteArrayLiteral("Accept"), QByteArrayLiteral("application/octet-stream")); request.setRawHeader(QByteArrayLiteral("Cookie"), source.cookieHeader);
    QNetworkAccessManager network; QNetworkReply *reply = network.get(request); QSaveFile output(target); if (!output.open(QIODevice::WriteOnly)) { reply->abort(); reply->deleteLater(); return false; }
    QCryptographicHash hash(QCryptographicHash::Sha256); bool writeOk = true;
    QObject::connect(reply, &QNetworkReply::readyRead, [&] { const QByteArray bytes = reply->readAll(); hash.addData(bytes); if (output.write(bytes) != bytes.size()) writeOk = false; });
    QEventLoop loop; QTimer timer; timer.setSingleShot(true); timer.setInterval(120000); QObject::connect(&timer, &QTimer::timeout, reply, &QNetworkReply::abort); QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit); timer.start(); loop.exec(); timer.stop();
    const QByteArray tail = reply->readAll(); if (!tail.isEmpty()) { hash.addData(tail); if (output.write(tail) != tail.size()) writeOk = false; }
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt(); const bool ok = writeOk && reply->error() == QNetworkReply::NoError && status >= 200 && status < 300 && (entry.checksum.isEmpty() || QString::fromLatin1(hash.result().toHex()) == entry.checksum);
    reply->deleteLater(); if (!ok) { output.cancelWriting(); return false; } return output.commit();
}
#endif

bool ClusterFuseMount::start()
{
#ifdef CLUSTER_HAS_FUSE3
    if (m_running) return true;
    if (m_mountPoint.isEmpty() || m_cacheRoot.isEmpty() || m_sources.isEmpty()) { m_lastError = QStringLiteral("Mount, cache, and authenticated server sources are required."); return false; }
    QDir().mkpath(m_mountPoint); QDir().mkpath(m_cacheRoot);
    static fuse_operations operations{}; static bool initialized = false;
    if (!initialized) {
        operations.getattr = clusterGetattr; operations.readdir = clusterReaddir; operations.open = clusterOpen; operations.read = clusterRead;
        operations.write = clusterWrite; operations.create = clusterCreate; operations.mkdir = clusterMkdir; operations.truncate = clusterTruncate;
        operations.release = clusterRelease; operations.unlink = clusterUnlink; operations.rmdir = clusterRmdir; operations.rename = clusterRename; initialized = true;
    }
    QByteArray program = QByteArrayLiteral("cluster-library"), foreground = QByteArrayLiteral("-f"), singleThread = QByteArrayLiteral("-s");
    char *argv[] = {program.data(), foreground.data(), singleThread.data()}; int argc = 3; struct fuse_args args = FUSE_ARGS_INIT(argc, argv);
    m_fuse = fuse_new(&args, &operations, sizeof(operations), this); fuse_opt_free_args(&args);
    if (!m_fuse || fuse_mount(m_fuse, m_mountPoint.toUtf8().constData()) != 0) { if (m_fuse) fuse_destroy(m_fuse); m_fuse = nullptr; m_lastError = QStringLiteral("The FUSE provider could not mount the Cluster filesystem."); return false; }
    m_thread = QThread::create([this] { fuse_loop(m_fuse); }); connect(m_thread, &QThread::finished, this, [this] { m_running = false; emit stateChanged(); });
    m_running = true; m_lastError.clear(); m_thread->start(); emit stateChanged(); return true;
#else
    m_lastError = QStringLiteral("This build does not contain a compatible FUSE/WinFsp adapter."); emit stateChanged(); return false;
#endif
}

void ClusterFuseMount::stop()
{
#ifdef CLUSTER_HAS_FUSE3
    if (m_fuse) { fuse_exit(m_fuse); fuse_unmount(m_fuse); if (m_thread) { m_thread->quit(); m_thread->wait(3000); m_thread->deleteLater(); m_thread = nullptr; } fuse_destroy(m_fuse); m_fuse = nullptr; }
#endif
    if (m_running) { m_running = false; emit stateChanged(); }
}
