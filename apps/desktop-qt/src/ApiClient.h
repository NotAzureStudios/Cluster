#pragma once

#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QNetworkAccessManager>
#include <QNetworkRequest>
#include <QObject>
#include <QUrl>
#include <QVariantMap>

class PersistentCookieJar;
class QNetworkReply;
class QNetworkDiskCache;

class ApiClient final : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString baseUrl READ baseUrl NOTIFY baseUrlChanged)
    Q_PROPERTY(QVariantMap serverMetadata READ serverMetadata NOTIFY serverMetadataChanged)
    Q_PROPERTY(bool persistentSessionsAvailable READ persistentSessionsAvailable CONSTANT)
    Q_PROPERTY(bool online READ online NOTIFY onlineChanged)

public:
    explicit ApiClient(QObject *parent = nullptr);

    QString baseUrl() const;
    QVariantMap serverMetadata() const;
    bool persistentSessionsAvailable() const;
    bool online() const;

    bool setProfileContext(const QString &profileId, const QString &profileDataPath, QString *errorMessage = nullptr);
    bool setBaseUrl(const QString &rawUrl, QString *errorMessage = nullptr);
    void clearSession();
    void setCsrfToken(const QString &token);
    QString csrfToken() const;
    QByteArray sessionCookieHeader() const;

    void requestJson(const QString &operation, const QByteArray &method, const QString &path,
                     const QJsonObject &body = {}, const QString &idempotencyKey = {});
    void getJson(const QString &operation, const QString &path);
    void postJson(const QString &operation, const QString &path, const QJsonObject &body);
    void putJson(const QString &operation, const QString &path, const QJsonObject &body,
                 const QString &idempotencyKey = {});
    void patchJson(const QString &operation, const QString &path, const QJsonObject &body,
                   const QString &idempotencyKey = {});
    void deleteJson(const QString &operation, const QString &path, const QJsonObject &body = {},
                    const QString &idempotencyKey = {});
    void requestConfirmedJson(const QString &operation, const QByteArray &method, const QString &path,
                              const QJsonObject &body, const QString &confirmation);
    void downloadFile(const QString &operation, const QString &path, const QString &suggestedName);
    QNetworkRequest createRequest(const QString &path) const;
    QNetworkAccessManager *networkAccessManager();

signals:
    void baseUrlChanged();
    void serverMetadataChanged();
    void onlineChanged();
    void succeeded(const QString &operation, const QJsonValue &payload);
    void failed(const QString &operation, const QVariantMap &error);
    void downloaded(const QString &operation, const QString &filePath);

private:
    QNetworkRequest requestFor(const QString &path) const;
    void finish(const QString &operation, QNetworkReply *reply);
    QVariantMap errorFromReply(QNetworkReply *reply, const QByteArray &body, const QJsonDocument &document) const;
    void updateMetadata(QNetworkReply *reply);
    void setOnline(bool online);

    QNetworkAccessManager m_network;
    QNetworkDiskCache *m_diskCache = nullptr;
    PersistentCookieJar *m_cookieJar = nullptr;
    QUrl m_baseUrl;
    QString m_profileId;
    QString m_profileDataPath;
    QVariantMap m_serverMetadata;
    bool m_online = false;
    QString m_csrfToken;
};
