#pragma once

#include <QByteArray>
#include <QHash>
#include <QObject>
#include <QReadWriteLock>
#include <QString>
#include <QStringList>
#include <QThread>
#include <QVariantList>
#include <QVariantMap>

class ClusterFuseMount final : public QObject
{
    Q_OBJECT
public:
    explicit ClusterFuseMount(QObject *parent = nullptr);
    ~ClusterFuseMount() override;

    bool available() const;
    bool running() const { return m_running; }
    QString lastError() const { return m_lastError; }
    QString mountPoint() const { return m_mountPoint; }
    void configure(const QString &mountPoint, const QString &cacheRoot,
                   const QVariantList &sources, const QVariantList &manifest);
    bool start();
    void stop();
    void updateManifest(const QVariantList &manifest);

signals:
    void fileDirty(const QString &sourceId, const QString &relativePath, const QString &itemId,
                   int revision, const QString &localPath, const QString &parentId);
    void metadataChanged(const QString &sourceId);
    void stateChanged();

public:
#ifdef CLUSTER_HAS_FUSE3
    struct Source {
        QString id;
        QString serverUrl;
        QByteArray cookieHeader;
        QString csrfToken;
        QStringList roots;
        bool readOnly = false;
    };
    struct Entry {
        QString id;
        QString parentId;
        QString sourceId;
        QString relativePath;
        QString kind;
        QString mimeType;
        QString checksum;
        qint64 size = 0;
        int revision = 0;
        bool writable = false;
        bool synthetic = false;
    };
    struct fuse *m_fuse = nullptr;
    QThread *m_thread = nullptr;

    Entry entryForPath(const QString &path) const;
    Source sourceForPath(const QString &path) const;
    QString sourceIdForPath(const QString &path) const;
    QString cachePathFor(const QString &relativePath) const;
    bool materialize(const Entry &entry);
    bool childExists(const QString &path) const;
    QStringList childrenForPath(const QString &path) const;
    QString parentRelativePath(const QString &path) const;
    bool canWritePath(const QString &path) const;
    QString parentItemIdForPath(const QString &path) const;
    void addPendingFile(const QString &path);
    void removeEntry(const QString &path);
    bool createRemoteFolder(const QString &path);
    bool deleteRemoteEntry(const Entry &entry);
    bool renameRemoteEntry(const Entry &entry, const QString &newName, int *nextRevision = nullptr);
    bool renameEntryPath(const QString &from, const QString &to, int nextRevision = 0);
#endif

private:
    void rebuildEntries(const QVariantList &manifest);
#ifdef CLUSTER_HAS_FUSE3
    bool performJson(const Source &source, const QByteArray &method, const QString &path,
                     const QVariantMap &body, QVariantMap *response = nullptr) const;
    static QString normalizedRelative(const QString &path);
    static QString hashFileSha256(const QString &path);
#endif

    QString m_mountPoint;
    QString m_cacheRoot;
    QVariantList m_manifest;
    QVariantList m_sourceConfig;
    bool m_running = false;
    QString m_lastError;
    mutable QReadWriteLock m_lock;
#ifdef CLUSTER_HAS_FUSE3
    QHash<QString, Entry> m_entries;
    QHash<QString, Source> m_sources;
#endif
};
