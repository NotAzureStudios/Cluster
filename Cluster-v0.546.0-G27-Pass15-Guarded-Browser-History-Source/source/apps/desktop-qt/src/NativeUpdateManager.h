#pragma once

#include <QJsonObject>
#include <QObject>
#include <QString>

class DesktopPreferences;
class QFile;
class QNetworkAccessManager;
class QNetworkReply;
class QUrl;

class NativeUpdateManager final : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString state READ state NOTIFY stateChanged)
    Q_PROPERTY(QString message READ message NOTIFY stateChanged)
    Q_PROPERTY(QString availableVersion READ availableVersion NOTIFY stateChanged)
    Q_PROPERTY(QString previousVersion READ previousVersion NOTIFY stateChanged)
    Q_PROPERTY(bool updateAvailable READ updateAvailable NOTIFY stateChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY stateChanged)
    Q_PROPERTY(bool recoveryRequired READ recoveryRequired NOTIFY stateChanged)
    Q_PROPERTY(bool rollbackReady READ rollbackReady NOTIFY stateChanged)
    Q_PROPERTY(qreal progress READ progress NOTIFY progressChanged)
    Q_PROPERTY(QString downloadedPath READ downloadedPath NOTIFY stateChanged)

public:
    explicit NativeUpdateManager(DesktopPreferences *preferences, QObject *parent = nullptr);

    QString state() const;
    QString message() const;
    QString availableVersion() const;
    QString previousVersion() const;
    bool updateAvailable() const;
    bool busy() const;
    bool recoveryRequired() const;
    bool rollbackReady() const;
    qreal progress() const;
    QString downloadedPath() const;

    Q_INVOKABLE void checkForUpdates();
    Q_INVOKABLE void downloadUpdate();
    Q_INVOKABLE void installUpdate();
    Q_INVOKABLE void rollbackUpdate();
    Q_INVOKABLE void markRuntimeHealthy();
    Q_INVOKABLE void recordStartupFailure(const QString &reason);
    Q_INVOKABLE void discardDownload();

signals:
    void stateChanged();
    void progressChanged();

private:
    void setState(const QString &state, const QString &message = {});
    void handleManifest(QNetworkReply *reply, const QUrl &manifestUrl);
    void beginArtifactDownload(const QJsonObject &artifact, const QString &targetPath, bool rollback);
    void finishArtifactDownload(QNetworkReply *reply, const QJsonObject &artifact, const QString &targetPath, bool rollback, qint64 resumedFrom);
    bool verifyManifestFile(const QString &manifestPath, QString *errorMessage) const;
    bool verifyArtifactFile(const QString &artifactPath, const QString &sha256, QString *errorMessage) const;
    bool validateArtifact(const QJsonObject &artifact, const QUrl &manifestUrl, bool rollback, QString *errorMessage, QJsonObject *normalizedArtifact) const;
    void loadRecoveryState();
    bool persistPendingInstall(QString *errorMessage);
    void clearRecoveryState(bool removeRollbackFile);
    QString helperPath() const;
    QString publicKeyPath() const;
    QString updateDirectory() const;
    static bool isNewerVersion(const QString &candidate, const QString &current);
    static bool allowedFeedUrl(const QUrl &url);
    static bool sameOrigin(const QUrl &left, const QUrl &right);

    DesktopPreferences *m_preferences = nullptr;
    QNetworkAccessManager *m_network = nullptr;
    QString m_state = QStringLiteral("idle");
    QString m_message;
    QString m_availableVersion;
    QString m_previousVersion;
    qreal m_progress = 0;
    QString m_downloadedPath;
    QString m_rollbackPath;
    QString m_rollbackSha256;
    QJsonObject m_artifact;
    QJsonObject m_rollbackArtifact;
    QNetworkReply *m_activeReply = nullptr;
    QFile *m_activeFile = nullptr;
    bool m_sizeLimitExceeded = false;
};
