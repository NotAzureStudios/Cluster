#include "ApiClient.h"
#include "PersistentCookieJar.h"

#include <QDir>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkCookie>
#include <QNetworkDiskCache>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSaveFile>
#include <QStandardPaths>
#include <QUuid>

namespace {
constexpr char ClientVersionHeader[] = "X-Cluster-Client-Version";
constexpr char ClientHostHeader[] = "X-Cluster-Client-Host";
constexpr char ClientProtocolHeader[] = "X-Cluster-Client-Protocol";
constexpr char ClientRequestIdHeader[] = "X-Client-Request-Id";
constexpr char IdempotencyHeader[] = "X-Cluster-Idempotency-Key";
constexpr char CsrfHeader[] = "X-Cluster-CSRF";

QString normalizedOrigin(const QUrl &url)
{
    QUrl origin = url;
    origin.setPath(QStringLiteral("/"));
    origin.setQuery(QString());
    origin.setFragment(QString());
    QString value = origin.toString(QUrl::RemovePath | QUrl::RemoveQuery | QUrl::RemoveFragment);
    while (value.endsWith(QLatin1Char('/')))
        value.chop(1);
    return value;
}

QString defaultCode(int status)
{
    switch (status) {
    case 400: return QStringLiteral("VALIDATION_FAILED");
    case 401: return QStringLiteral("AUTH_REQUIRED");
    case 403: return QStringLiteral("PERMISSION_DENIED");
    case 404: return QStringLiteral("RESOURCE_NOT_FOUND");
    case 408: return QStringLiteral("REQUEST_TIMEOUT");
    case 409: return QStringLiteral("CONFLICT");
    case 413: return QStringLiteral("BODY_TOO_LARGE");
    case 426: return QStringLiteral("CLIENT_UPGRADE_REQUIRED");
    case 429: return QStringLiteral("RATE_LIMITED");
    case 502:
    case 503:
    case 504: return QStringLiteral("SERVICE_UNAVAILABLE");
    default: return QStringLiteral("INTERNAL_ERROR");
    }
}

QString safeDownloadName(const QString &suggestedName)
{
    QString name = QFileInfo(suggestedName).fileName().trimmed();
    if (name.isEmpty())
        name = QStringLiteral("cluster-download");
    name.replace(QChar(u'/'), QChar(u'_'));
    name.replace(QChar(u'\\'), QChar(u'_'));
    return name;
}

QString availableDownloadPath(const QString &suggestedName)
{
    QString directory = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    if (directory.isEmpty())
        directory = QStandardPaths::writableLocation(QStandardPaths::TempLocation);
    QDir().mkpath(directory);
    const QFileInfo info(safeDownloadName(suggestedName));
    const QString stem = info.completeBaseName().isEmpty() ? QStringLiteral("cluster-download") : info.completeBaseName();
    const QString suffix = info.completeSuffix();
    QString candidate = directory + QLatin1Char('/') + info.fileName();
    for (int index = 2; QFileInfo::exists(candidate); ++index) {
        candidate = directory + QLatin1Char('/') + stem + QStringLiteral(" (%1)").arg(index)
                    + (suffix.isEmpty() ? QString() : QStringLiteral(".") + suffix);
    }
    return candidate;
}
}

ApiClient::ApiClient(QObject *parent)
    : QObject(parent)
    , m_cookieJar(new PersistentCookieJar(this))
{
    m_network.setCookieJar(m_cookieJar);
    m_cookieJar->setParent(&m_network);

    m_network.setTransferTimeout(20'000);
}

bool ApiClient::setProfileContext(const QString &profileId, const QString &profileDataPath, QString *errorMessage)
{
    const QString normalizedId = profileId.trimmed();
    const QString trimmedPath = profileDataPath.trimmed();
    const QString normalizedPath = trimmedPath.isEmpty() ? QString() : QDir::cleanPath(trimmedPath);
    if (!normalizedId.startsWith(QStringLiteral("server-")) || normalizedId.size() != 31
        || normalizedPath.isEmpty() || QDir::isRelativePath(normalizedPath)) {
        if (errorMessage) *errorMessage = QStringLiteral("The active desktop server profile is invalid.");
        return false;
    }
    for (qsizetype index = 7; index < normalizedId.size(); ++index) {
        const QChar c = normalizedId.at(index);
        if (!c.isDigit() && !(c >= QLatin1Char('a') && c <= QLatin1Char('f'))) {
            if (errorMessage) *errorMessage = QStringLiteral("The active desktop server profile is invalid.");
            return false;
        }
    }
    if (m_profileId == normalizedId && m_profileDataPath == normalizedPath)
        return true;

    QDir().mkpath(normalizedPath);
    const QString cachePath = QDir::cleanPath(normalizedPath + QStringLiteral("/http-cache"));
    QDir().mkpath(cachePath);
    if (!m_diskCache) {
        m_diskCache = new QNetworkDiskCache(&m_network);
        m_network.setCache(m_diskCache);
    }
    m_diskCache->setCacheDirectory(cachePath);
    m_diskCache->setMaximumCacheSize(64 * 1024 * 1024);
    m_csrfToken.clear();
    m_profileId = normalizedId;
    m_profileDataPath = normalizedPath;
    m_cookieJar->setProfileContext(m_profileId, normalizedOrigin(m_baseUrl), m_profileDataPath);
    return true;
}

QString ApiClient::baseUrl() const
{
    return normalizedOrigin(m_baseUrl);
}

QVariantMap ApiClient::serverMetadata() const
{
    return m_serverMetadata;
}

bool ApiClient::persistentSessionsAvailable() const
{
    return m_cookieJar->persistenceAvailable();
}

bool ApiClient::online() const
{
    return m_online;
}

bool ApiClient::setBaseUrl(const QString &rawUrl, QString *errorMessage)
{
    if (m_profileId.isEmpty() || m_profileDataPath.isEmpty()) {
        if (errorMessage) *errorMessage = QStringLiteral("The desktop server profile has not been initialized.");
        return false;
    }
    QString input = rawUrl.trimmed();
    if (!input.contains(QStringLiteral("://")))
        input.prepend(QStringLiteral("http://"));
    QUrl url = QUrl::fromUserInput(input);
    const QString scheme = url.scheme().toLower();
    if (!url.isValid() || url.host().isEmpty() || (scheme != QStringLiteral("http") && scheme != QStringLiteral("https"))) {
        if (errorMessage)
            *errorMessage = QStringLiteral("Enter a valid HTTP or HTTPS Cluster Server address.");
        return false;
    }
    if (!url.userInfo().isEmpty()) {
        if (errorMessage)
            *errorMessage = QStringLiteral("Server addresses cannot contain usernames or passwords.");
        return false;
    }
    url.setPath(QStringLiteral("/"));
    url.setQuery(QString());
    url.setFragment(QString());
    if (m_baseUrl == url)
        return true;
    m_csrfToken.clear();
    m_baseUrl = url;
    m_cookieJar->setProfileContext(m_profileId, normalizedOrigin(m_baseUrl), m_profileDataPath);
    m_serverMetadata.clear();
    setOnline(false);
    emit baseUrlChanged();
    emit serverMetadataChanged();
    return true;
}

void ApiClient::clearSession()
{
    m_cookieJar->clearForCurrentOrigin();
    m_csrfToken.clear();
}

void ApiClient::setCsrfToken(const QString &token)
{
    m_csrfToken = token.trimmed().left(512);
}

QString ApiClient::csrfToken() const
{
    return m_csrfToken;
}

QByteArray ApiClient::sessionCookieHeader() const
{
    if (!m_cookieJar || !m_baseUrl.isValid()) return {};
    QByteArray header;
    const auto cookies = m_cookieJar->cookiesForUrl(m_baseUrl);
    for (const QNetworkCookie &cookie : cookies) {
        if (!header.isEmpty()) header += QByteArrayLiteral("; ");
        header += cookie.toRawForm(QNetworkCookie::NameAndValueOnly);
    }
    return header;
}

void ApiClient::requestJson(const QString &operation, const QByteArray &method, const QString &path,
                            const QJsonObject &body, const QString &idempotencyKey)
{
    if (!m_baseUrl.isValid()) {
        emit failed(operation, {
            {QStringLiteral("status"), 0},
            {QStringLiteral("code"), QStringLiteral("SERVER_NOT_CONFIGURED")},
            {QStringLiteral("message"), QStringLiteral("Choose a Cluster Server before continuing.")},
            {QStringLiteral("retryable"), false},
        });
        return;
    }

    QNetworkRequest request = requestFor(path);
    if (!idempotencyKey.isEmpty())
        request.setRawHeader(QByteArray(IdempotencyHeader), idempotencyKey.toUtf8());
    if (method != QByteArrayLiteral("GET") && method != QByteArrayLiteral("HEAD") && !m_csrfToken.isEmpty())
        request.setRawHeader(QByteArray(CsrfHeader), m_csrfToken.toUtf8());

    QNetworkReply *reply = nullptr;
    if (method == QByteArrayLiteral("GET")) {
        reply = m_network.get(request);
    } else {
        request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
        reply = m_network.sendCustomRequest(request, method, QJsonDocument(body).toJson(QJsonDocument::Compact));
    }
    connect(reply, &QNetworkReply::finished, this, [this, operation, reply] { finish(operation, reply); });
}

void ApiClient::getJson(const QString &operation, const QString &path)
{
    requestJson(operation, QByteArrayLiteral("GET"), path);
}

void ApiClient::postJson(const QString &operation, const QString &path, const QJsonObject &body)
{
    requestJson(operation, QByteArrayLiteral("POST"), path, body);
}

void ApiClient::putJson(const QString &operation, const QString &path, const QJsonObject &body, const QString &idempotencyKey)
{
    requestJson(operation, QByteArrayLiteral("PUT"), path, body, idempotencyKey);
}

void ApiClient::patchJson(const QString &operation, const QString &path, const QJsonObject &body, const QString &idempotencyKey)
{
    requestJson(operation, QByteArrayLiteral("PATCH"), path, body, idempotencyKey);
}

void ApiClient::deleteJson(const QString &operation, const QString &path, const QJsonObject &body, const QString &idempotencyKey)
{
    requestJson(operation, QByteArrayLiteral("DELETE"), path, body, idempotencyKey);
}

void ApiClient::requestConfirmedJson(const QString &operation, const QByteArray &method, const QString &path,
                                     const QJsonObject &body, const QString &confirmation)
{
    if (!m_baseUrl.isValid()) {
        emit failed(operation, {
            {QStringLiteral("status"), 0},
            {QStringLiteral("code"), QStringLiteral("SERVER_NOT_CONFIGURED")},
            {QStringLiteral("message"), QStringLiteral("Choose a Cluster Server before continuing.")},
            {QStringLiteral("retryable"), false},
        });
        return;
    }
    QNetworkRequest request = requestFor(path);
    request.setRawHeader(QByteArrayLiteral("X-Cluster-Confirmation"), confirmation.toUtf8());
    if (!m_csrfToken.isEmpty()) request.setRawHeader(QByteArray(CsrfHeader), m_csrfToken.toUtf8());
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QNetworkReply *reply = m_network.sendCustomRequest(request, method, QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, operation, reply] { finish(operation, reply); });
}

void ApiClient::downloadFile(const QString &operation, const QString &path, const QString &suggestedName)
{
    if (!m_baseUrl.isValid()) {
        emit failed(operation, {
            {QStringLiteral("status"), 0},
            {QStringLiteral("code"), QStringLiteral("SERVER_NOT_CONFIGURED")},
            {QStringLiteral("message"), QStringLiteral("Choose a Cluster Server before downloading files.")},
            {QStringLiteral("retryable"), false},
        });
        return;
    }
    QNetworkRequest request = requestFor(path);
    request.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::AlwaysNetwork);
    QNetworkReply *reply = m_network.get(request);
    connect(reply, &QNetworkReply::finished, this, [this, operation, suggestedName, reply] {
        finishDownload(operation, suggestedName, reply);
    });
}

QNetworkRequest ApiClient::createRequest(const QString &path) const
{
    return requestFor(path);
}

QNetworkAccessManager *ApiClient::networkAccessManager()
{
    return &m_network;
}

QNetworkRequest ApiClient::requestFor(const QString &path) const
{
    const QString relativePath = path.startsWith(QLatin1Char('/')) ? path : QStringLiteral("/") + path;
    const QUrl url = m_baseUrl.resolved(QUrl(relativePath));
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("ClusterDesktop/%1 Qt").arg(QStringLiteral(CLUSTER_DESKTOP_VERSION)));
    request.setRawHeader(QByteArrayLiteral("Accept"), QByteArrayLiteral("application/json"));
    request.setRawHeader(QByteArray(ClientVersionHeader), QByteArray(CLUSTER_DESKTOP_VERSION));
    request.setRawHeader(QByteArray(ClientHostHeader), QByteArrayLiteral("desktop-qt"));
    request.setRawHeader(QByteArray(ClientProtocolHeader), QByteArray::number(CLUSTER_TRANSPORT_PROTOCOL));
    request.setRawHeader(QByteArray(ClientRequestIdHeader), QUuid::createUuid().toString(QUuid::WithoutBraces).toUtf8());
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    request.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::PreferNetwork);
    return request;
}

void ApiClient::finish(const QString &operation, QNetworkReply *reply)
{
    const QByteArray body = reply->readAll();
    const QJsonDocument document = QJsonDocument::fromJson(body);
    updateMetadata(reply);

    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const bool networkFailure = reply->error() != QNetworkReply::NoError && status == 0;
    const bool httpFailure = status < 200 || status >= 300;
    setOnline(!networkFailure);
    if (networkFailure || httpFailure || (!body.isEmpty() && document.isNull())) {
        emit failed(operation, errorFromReply(reply, body, document));
    } else {
        if (body.isEmpty())
            emit succeeded(operation, QJsonObject{{QStringLiteral("ok"), true}});
        else
            emit succeeded(operation, document.isArray() ? QJsonValue(document.array()) : QJsonValue(document.object()));
    }
    reply->deleteLater();
}

void ApiClient::finishDownload(const QString &operation, const QString &suggestedName, QNetworkReply *reply)
{
    const QByteArray body = reply->readAll();
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const bool networkFailure = reply->error() != QNetworkReply::NoError && status == 0;
    const bool httpFailure = status < 200 || status >= 300;
    setOnline(!networkFailure);
    updateMetadata(reply);
    if (networkFailure || httpFailure) {
        emit failed(operation, errorFromReply(reply, body, QJsonDocument::fromJson(body)));
        reply->deleteLater();
        return;
    }

    const QString targetPath = availableDownloadPath(suggestedName);
    QSaveFile target(targetPath);
    if (!target.open(QIODevice::WriteOnly) || target.write(body) != body.size() || !target.commit()) {
        emit failed(operation, {
            {QStringLiteral("status"), status},
            {QStringLiteral("code"), QStringLiteral("DOWNLOAD_WRITE_FAILED")},
            {QStringLiteral("message"), QStringLiteral("Cluster could not save the downloaded file to %1.").arg(targetPath)},
            {QStringLiteral("retryable"), false},
        });
    } else {
        emit downloaded(operation, targetPath);
    }
    reply->deleteLater();
}

QVariantMap ApiClient::errorFromReply(QNetworkReply *reply, const QByteArray &body, const QJsonDocument &document) const
{
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QJsonObject payload = document.isObject() ? document.object() : QJsonObject{};
    QString message = payload.value(QStringLiteral("error")).toString();
    if (message.isEmpty())
        message = payload.value(QStringLiteral("message")).toString();
    if (message.isEmpty() && status == 0)
        message = reply->errorString();
    if (message.isEmpty() && document.isNull() && !body.isEmpty())
        message = QStringLiteral("The server returned an unreadable response.");
    if (message.isEmpty())
        message = QStringLiteral("Cluster Server returned HTTP %1.").arg(status);

    const QString requestId = payload.value(QStringLiteral("requestId")).toString(
        QString::fromUtf8(reply->rawHeader(QByteArrayLiteral("X-Request-Id"))));
    return {
        {QStringLiteral("status"), status},
        {QStringLiteral("code"), payload.value(QStringLiteral("code")).toString(status == 0 ? QStringLiteral("NETWORK_UNAVAILABLE") : defaultCode(status))},
        {QStringLiteral("message"), message},
        {QStringLiteral("action"), payload.value(QStringLiteral("action")).toString()},
        {QStringLiteral("requestId"), requestId},
        {QStringLiteral("contractVersion"), QString::fromUtf8(reply->rawHeader(QByteArrayLiteral("X-Cluster-Api-Contract")))},
        {QStringLiteral("retryable"), payload.contains(QStringLiteral("retryable")) ? payload.value(QStringLiteral("retryable")).toBool() : status == 0 || status == 408 || status == 429 || status >= 500},
        {QStringLiteral("current"), payload.value(QStringLiteral("current")).toObject().toVariantMap()},
    };
}

void ApiClient::updateMetadata(QNetworkReply *reply)
{
    const auto header = [reply](const char *name) { return QString::fromUtf8(reply->rawHeader(QByteArray(name))); };
    const QVariantMap next {
        {QStringLiteral("serverVersion"), header("X-Cluster-Version")},
        {QStringLiteral("contractVersion"), header("X-Cluster-Api-Contract")},
        {QStringLiteral("minimumClientVersion"), header("X-Cluster-Minimum-Client-Version")},
        {QStringLiteral("compatibility"), header("X-Cluster-Client-Compatibility")},
        {QStringLiteral("protocolCompatibility"), header("X-Cluster-Client-Protocol-Compatibility")},
        {QStringLiteral("transportProtocolVersion"), header("X-Cluster-Transport-Protocol")},
        {QStringLiteral("serverState"), header("X-Cluster-Server-State")},
        {QStringLiteral("requestId"), header("X-Request-Id")},
    };
    if (next != m_serverMetadata) {
        m_serverMetadata = next;
        emit serverMetadataChanged();
    }
}

void ApiClient::setOnline(bool online)
{
    if (m_online == online)
        return;
    m_online = online;
    emit onlineChanged();
}
