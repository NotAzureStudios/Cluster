#include "WorkstationServiceManager.h"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDebug>
#include <QDateTime>
#include <QDir>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProcess>
#include <QStandardPaths>
#include <QThread>
#include <QTimer>
#include <QUrl>
#include <QUuid>

namespace {
constexpr int RequestTimeoutMs = 8'000;
constexpr int StartupTimeoutMs = 3'000;
constexpr int OperationPollIntervalMs = 750;
constexpr int OperationPollRetryMs = 1'500;
constexpr int OperationPollTimeoutMs = 2'000;
constexpr int OperationPollFailureLimit = 3;
constexpr int HealthProbeTimeoutMs = 900;
#ifndef CLUSTER_RUNTIME_VERSION
#define CLUSTER_RUNTIME_VERSION "0.506.0"
#endif
#ifndef CLUSTER_WORKSTATION_PROTOCOL
#define CLUSTER_WORKSTATION_PROTOCOL 1
#endif
}

WorkstationServiceManager::WorkstationServiceManager(QObject *parent)
    : QObject(parent)
    , m_process(new QProcess(this))
    , m_network(new QNetworkAccessManager(this))
    , m_operationPollTimer(new QTimer(this))
{
    m_process->setProcessChannelMode(QProcess::MergedChannels);
    m_operationPollTimer->setSingleShot(true);
    connect(m_operationPollTimer, &QTimer::timeout, this, &WorkstationServiceManager::pollOperationSnapshots);
    connect(m_process, &QProcess::finished, this, [this]() {
        QFile::remove(discoveryPath());
        m_operationMonitorActive = false;
        m_operationPollTimer->stop();
        emit serviceAvailabilityChanged(false);
    });
}

WorkstationServiceManager::~WorkstationServiceManager()
{
    stop();
}

QString WorkstationServiceManager::stateDirectory() const
{
    return QDir::cleanPath(QDir::homePath() + QStringLiteral("/.cluster/workstation"));
}

QString WorkstationServiceManager::discoveryPath() const
{
    return QDir::cleanPath(stateDirectory() + QStringLiteral("/source-control-endpoint.json"));
}

QString WorkstationServiceManager::helperPath() const
{
#ifdef Q_OS_WIN
    return QDir::cleanPath(QCoreApplication::applicationDirPath() + QStringLiteral("/cluster-workstation-service.exe"));
#else
    return QDir::cleanPath(QCoreApplication::applicationDirPath() + QStringLiteral("/cluster-workstation-service"));
#endif
}

QString WorkstationServiceManager::helperManifestPath() const
{
    return QDir::cleanPath(QCoreApplication::applicationDirPath() + QStringLiteral("/cluster-workstation-service.manifest.json"));
}

QString WorkstationServiceManager::expectedVersion() const
{
    return QString::fromLatin1(CLUSTER_RUNTIME_VERSION);
}

bool WorkstationServiceManager::helperIntegrityValid(QString *errorMessage) const
{
    if (errorMessage) errorMessage->clear();
    QFile manifestFile(helperManifestPath());
    if (!manifestFile.open(QIODevice::ReadOnly) || manifestFile.size() <= 0 || manifestFile.size() > 64 * 1024) {
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation integrity manifest is missing or invalid.");
        return false;
    }
    QJsonParseError parseError;
    const QJsonDocument manifestDocument = QJsonDocument::fromJson(manifestFile.readAll(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !manifestDocument.isObject()) {
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation integrity manifest is malformed.");
        return false;
    }
    const QJsonObject manifest = manifestDocument.object();
    if (manifest.value(QStringLiteral("schema")).toInt() != 1
        || manifest.value(QStringLiteral("protocol")).toInt() != protocol()
        || manifest.value(QStringLiteral("clusterVersion")).toString() != expectedVersion()) {
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation integrity manifest does not match this Desktop runtime.");
        return false;
    }

    const QString helperName = QFileInfo(helperPath()).fileName();
    QJsonObject artifact;
    for (const QJsonValue &value : manifest.value(QStringLiteral("artifacts")).toArray()) {
        const QJsonObject candidate = value.toObject();
        if (candidate.value(QStringLiteral("file")).toString() == helperName) { artifact = candidate; break; }
    }
    if (artifact.isEmpty()) {
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation integrity manifest does not describe the packaged helper.");
        return false;
    }

    QFile helper(helperPath());
    if (!helper.open(QIODevice::ReadOnly)) {
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation helper could not be opened for integrity verification.");
        return false;
    }
    if (artifact.value(QStringLiteral("bytes")).toVariant().toLongLong() != helper.size()) {
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation helper size does not match its verified build manifest.");
        return false;
    }
    QCryptographicHash hash(QCryptographicHash::Sha256);
    while (!helper.atEnd()) hash.addData(helper.read(1024 * 1024));
    const QString actual = QString::fromLatin1(hash.result().toHex());
    const QString expected = artifact.value(QStringLiteral("sha256")).toString().toLower();
    if (expected.size() != 64 || actual != expected) {
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation helper failed SHA-256 integrity verification.");
        return false;
    }
    return true;
}

bool WorkstationServiceManager::probeDiscovery(const DiscoveryState &state, int timeoutMs)
{
    if (!state.valid) return false;
    QNetworkRequest request(QUrl(state.endpoint + QStringLiteral("/health")));
    request.setRawHeader("Accept", "application/json");
    request.setTransferTimeout(timeoutMs);
    QNetworkReply *reply = m_network->get(request);
    QEventLoop loop;
    QTimer timeout;
    timeout.setSingleShot(true);
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(&timeout, &QTimer::timeout, &loop, &QEventLoop::quit);
    timeout.start(timeoutMs);
    loop.exec(QEventLoop::ExcludeUserInputEvents);
    if (!reply->isFinished()) reply->abort();
    const QByteArray bytes = reply->readAll();
    const auto error = reply->error();
    reply->deleteLater();
    if (error != QNetworkReply::NoError) return false;
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(bytes, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) return false;
    const QJsonObject health = document.object();
    return health.value(QStringLiteral("ok")).toBool(false)
        && health.value(QStringLiteral("service")).toString() == QStringLiteral("cluster-workstation")
        && health.value(QStringLiteral("schema")).toInt() == 1
        && health.value(QStringLiteral("protocol")).toInt() == protocol()
        && health.value(QStringLiteral("version")).toString() == expectedVersion();
}

WorkstationServiceManager::DiscoveryState WorkstationServiceManager::readDiscovery() const
{
    DiscoveryState state;
    QFile file(discoveryPath());
    if (!file.open(QIODevice::ReadOnly) || file.size() <= 0 || file.size() > 16 * 1024) return state;
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) return state;
    const QJsonObject object = document.object();
    if (object.value(QStringLiteral("schema")).toInt() != 1 || object.value(QStringLiteral("protocol")).toInt() != protocol()) return state;
    const QUrl endpointUrl(object.value(QStringLiteral("endpoint")).toString());
    const QString token = object.value(QStringLiteral("token")).toString();
    if (!endpointUrl.isValid() || endpointUrl.scheme() != QStringLiteral("http") || token.size() < 32) return state;
    const QString host = endpointUrl.host().toLower();
    if (host != QStringLiteral("127.0.0.1") && host != QStringLiteral("localhost") && host != QStringLiteral("::1")) return state;
    QUrl baseUrl(endpointUrl);
    baseUrl.setPath(QString());
    baseUrl.setQuery(QString());
    baseUrl.setFragment(QString());
    state.endpoint = baseUrl.toString(QUrl::RemoveQuery | QUrl::RemoveFragment);
    if (state.endpoint.endsWith(QLatin1Char('/'))) state.endpoint.chop(1);
    state.token = token;
    state.version = object.value(QStringLiteral("version")).toString();
    if (state.version != expectedVersion()) return DiscoveryState{};
    state.pid = object.value(QStringLiteral("pid")).toInteger();
    state.valid = true;
    return state;
}

QString WorkstationServiceManager::endpoint() const
{
    return readDiscovery().endpoint;
}

bool WorkstationServiceManager::available() const
{
    return readDiscovery().valid;
}

void WorkstationServiceManager::start()
{
    const DiscoveryState existing = readDiscovery();
    if (existing.valid) {
        if (probeDiscovery(existing, HealthProbeTimeoutMs)) {
            emit serviceAvailabilityChanged(true);
            return;
        }
        QFile::remove(discoveryPath());
    }
    if (m_process->state() != QProcess::NotRunning) return;
    const QString executable = helperPath();
    if (!QFileInfo::exists(executable)) return;
    QString integrityError;
    if (!helperIntegrityValid(&integrityError)) {
        qWarning().noquote() << "Cluster Workstation helper rejected:" << integrityError;
        emit serviceAvailabilityChanged(false);
        return;
    }

    QDir().mkpath(stateDirectory());
    QFile::remove(discoveryPath());
    const QString logPath = QDir::cleanPath(stateDirectory() + QStringLiteral("/workstation.log"));
    m_process->setProgram(executable);
    m_process->setArguments({QStringLiteral("--listen"), QStringLiteral("127.0.0.1:0"),
                             QStringLiteral("--state-dir"), stateDirectory(),
                             QStringLiteral("--discovery-file"), discoveryPath()});
    m_process->setStandardOutputFile(logPath, QIODeviceBase::Append);
    m_process->setStandardErrorFile(logPath, QIODeviceBase::Append);
    m_process->start();
    m_process->waitForStarted(1'500);
    if (waitForDiscovery(StartupTimeoutMs)) emit serviceAvailabilityChanged(true);
}

void WorkstationServiceManager::stop()
{
    m_operationMonitorActive = false;
    if (m_operationPollTimer) m_operationPollTimer->stop();
    if (!m_process || m_process->state() == QProcess::NotRunning) return;
    m_process->terminate();
    if (!m_process->waitForFinished(3'000)) {
        m_process->kill();
        m_process->waitForFinished(2'000);
    }
    QFile::remove(discoveryPath());
}

bool WorkstationServiceManager::waitForDiscovery(int timeoutMs)
{
    QElapsedTimer timer;
    timer.start();
    while (timer.elapsed() < timeoutMs) {
        const DiscoveryState state = readDiscovery();
        if (state.valid && probeDiscovery(state, HealthProbeTimeoutMs)) return true;
        if (m_process->state() == QProcess::NotRunning) return false;
        QThread::msleep(25);
        QCoreApplication::processEvents(QEventLoop::ExcludeUserInputEvents, 5);
    }
    const DiscoveryState state = readDiscovery();
    return state.valid && probeDiscovery(state, HealthProbeTimeoutMs);
}

QJsonObject WorkstationServiceManager::postJson(const QString &path, const QJsonObject &body, QString *errorCode, QString *errorMessage)
{
    if (errorCode) errorCode->clear();
    if (errorMessage) errorMessage->clear();
    DiscoveryState discovery = readDiscovery();
    if (!discovery.valid) {
        start();
        discovery = readDiscovery();
    }
    if (!discovery.valid) {
        if (errorCode) *errorCode = QStringLiteral("WORKSTATION_UNAVAILABLE");
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation service is not running.");
        return {};
    }

    QNetworkRequest request(QUrl(discovery.endpoint + path));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setRawHeader("Accept", "application/json");
    request.setRawHeader("Authorization", QByteArray("Bearer ") + discovery.token.toUtf8());
    request.setTransferTimeout(RequestTimeoutMs);

    QNetworkReply *reply = m_network->post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    QEventLoop loop;
    QTimer timeout;
    timeout.setSingleShot(true);
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(&timeout, &QTimer::timeout, &loop, &QEventLoop::quit);
    timeout.start(RequestTimeoutMs);
    loop.exec(QEventLoop::ExcludeUserInputEvents);

    if (!reply->isFinished()) {
        reply->abort();
        reply->deleteLater();
        QFile::remove(discoveryPath());
        start();
        if (errorCode) *errorCode = QStringLiteral("WORKSTATION_TIMEOUT");
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation did not respond in time. Its endpoint was retired and recovery was started.");
        return {};
    }
    const QByteArray bytes = reply->readAll();
    const auto networkError = reply->error();
    const QString networkErrorString = reply->errorString();
    reply->deleteLater();
    if (networkError != QNetworkReply::NoError) {
        // Discovery records are intentionally ephemeral. If the helper died or its
        // loopback endpoint changed, retire the stale record before trying to start
        // a replacement. Never keep forwarding credentials to a dead endpoint.
        QFile::remove(discoveryPath());
        start();
        if (errorCode) *errorCode = QStringLiteral("WORKSTATION_UNAVAILABLE");
        if (errorMessage) *errorMessage = networkErrorString.isEmpty()
            ? QStringLiteral("Cluster Workstation is unavailable; recovery was started.")
            : QStringLiteral("Cluster Workstation is unavailable: %1").arg(networkErrorString);
        return {};
    }
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(bytes, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        if (errorCode) *errorCode = QStringLiteral("WORKSTATION_INVALID_RESPONSE");
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation returned invalid JSON.");
        return {};
    }
    const QJsonObject response = document.object();
    if (!response.value(QStringLiteral("ok")).toBool(false)) {
        const QJsonObject error = response.value(QStringLiteral("error")).toObject();
        if (errorCode) *errorCode = error.value(QStringLiteral("code")).toString(QStringLiteral("WORKSTATION_REQUEST_FAILED"));
        if (errorMessage) *errorMessage = error.value(QStringLiteral("message")).toString(QStringLiteral("Cluster Workstation request failed."));
        return {};
    }
    return response.value(QStringLiteral("result")).toObject();
}

QJsonObject WorkstationServiceManager::status(QString *errorMessage)
{
    QString code;
    return requestCapability(QStringLiteral("workstation.status"), {}, &code, errorMessage);
}

QJsonObject WorkstationServiceManager::requestCapability(const QString &capability, const QJsonObject &payload,
                                                         QString *errorCode, QString *errorMessage)
{
    const QJsonObject result = postJson(QStringLiteral("/v1/native/capability"), {
        {QStringLiteral("capability"), capability},
        {QStringLiteral("payload"), payload},
    }, errorCode, errorMessage);

    if ((!errorCode || errorCode->isEmpty()) && capability == QStringLiteral("git.local.operation.list")) {
        handleOperationSnapshot(result.value(QStringLiteral("operations")).toArray());
    } else if ((!errorCode || errorCode->isEmpty())
               && (capability == QStringLiteral("git.local.operation.start")
                   || capability == QStringLiteral("git.local.operation.cancel")
                   || capability == QStringLiteral("git.local.clone"))) {
        scheduleOperationMonitor();
    }
    return result;
}


QJsonValue WorkstationServiceManager::postSourceControlJson(const QJsonObject &body, QString *errorCode, QString *errorMessage)
{
    if (errorCode) errorCode->clear();
    if (errorMessage) errorMessage->clear();
    DiscoveryState discovery = readDiscovery();
    if (!discovery.valid) {
        start();
        discovery = readDiscovery();
    }
    if (!discovery.valid) {
        if (errorCode) *errorCode = QStringLiteral("WORKSTATION_UNAVAILABLE");
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation service is not running.");
        return {};
    }

    QNetworkRequest request(QUrl(discovery.endpoint + QStringLiteral("/v1/source-control/actions")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setRawHeader("Accept", "application/json");
    request.setRawHeader("Authorization", QByteArray("Bearer ") + discovery.token.toUtf8());
    request.setTransferTimeout(RequestTimeoutMs);

    QNetworkReply *reply = m_network->post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    QEventLoop loop;
    QTimer timeout;
    timeout.setSingleShot(true);
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(&timeout, &QTimer::timeout, &loop, &QEventLoop::quit);
    timeout.start(RequestTimeoutMs);
    loop.exec(QEventLoop::ExcludeUserInputEvents);

    if (!reply->isFinished()) {
        reply->abort();
        reply->deleteLater();
        QFile::remove(discoveryPath());
        start();
        if (errorCode) *errorCode = QStringLiteral("WORKSTATION_TIMEOUT");
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation source-control request timed out; recovery was started.");
        return {};
    }
    const QByteArray bytes = reply->readAll();
    const auto networkError = reply->error();
    const QString networkErrorString = reply->errorString();
    reply->deleteLater();
    if (networkError != QNetworkReply::NoError) {
        QFile::remove(discoveryPath());
        start();
        if (errorCode) *errorCode = QStringLiteral("WORKSTATION_UNAVAILABLE");
        if (errorMessage) *errorMessage = networkErrorString.isEmpty()
            ? QStringLiteral("Cluster Workstation source control is unavailable; recovery was started.")
            : QStringLiteral("Cluster Workstation source control is unavailable: %1").arg(networkErrorString);
        return {};
    }

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(bytes, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        if (errorCode) *errorCode = QStringLiteral("WORKSTATION_INVALID_RESPONSE");
        if (errorMessage) *errorMessage = QStringLiteral("Cluster Workstation returned invalid source-control JSON.");
        return {};
    }
    const QJsonObject response = document.object();
    if (!response.value(QStringLiteral("ok")).toBool(false)) {
        const QJsonObject error = response.value(QStringLiteral("error")).toObject();
        if (errorCode) *errorCode = error.value(QStringLiteral("code")).toString(QStringLiteral("WORKSTATION_REQUEST_FAILED"));
        if (errorMessage) *errorMessage = error.value(QStringLiteral("message")).toString(QStringLiteral("Cluster Workstation source-control request failed."));
        return {};
    }
    return response.value(QStringLiteral("result"));
}

QJsonValue WorkstationServiceManager::requestSourceControlAction(
    const QString &action,
    const QString &repositoryId,
    const QStringList &paths,
    const QJsonObject &input,
    QString *errorCode,
    QString *errorMessage)
{
    QJsonArray jsonPaths;
    for (const QString &path : paths) jsonPaths.append(path);
    QJsonObject envelope{
        {QStringLiteral("schema"), 1},
        {QStringLiteral("protocol"), protocol()},
        {QStringLiteral("requestId"), QUuid::createUuid().toString(QUuid::WithoutBraces)},
        {QStringLiteral("action"), action},
        {QStringLiteral("paths"), jsonPaths},
        {QStringLiteral("input"), input},
    };
    if (!repositoryId.isEmpty()) envelope.insert(QStringLiteral("repositoryId"), repositoryId);
    const QJsonValue result = postSourceControlJson(envelope, errorCode, errorMessage);
    if ((!errorCode || errorCode->isEmpty())
        && (action == QStringLiteral("operation.start") || action == QStringLiteral("operation.cancel"))) {
        scheduleOperationMonitor();
    }
    return result;
}

void WorkstationServiceManager::scheduleOperationMonitor(int delayMs)
{
    m_operationMonitorActive = true;
    m_operationPollFailures = 0;
    if (!m_operationPollTimer || m_operationPollInFlight) return;
    m_operationPollTimer->start(qMax(0, delayMs));
}

bool WorkstationServiceManager::hasActiveOperations(const QJsonArray &operations) const
{
    for (const QJsonValue &value : operations) {
        if (!value.isObject()) continue;
        const QJsonObject operation = value.toObject();
        const QString state = operation.value(QStringLiteral("state")).toString();
        const QString status = operation.value(QStringLiteral("status")).toString();
        if (state == QStringLiteral("queued") || state == QStringLiteral("running") || state == QStringLiteral("cancelling")
            || status == QStringLiteral("queued") || status == QStringLiteral("running")) return true;
    }
    return false;
}

void WorkstationServiceManager::handleOperationSnapshot(const QJsonArray &operations)
{
    const QByteArray digest = QJsonDocument(operations).toJson(QJsonDocument::Compact);
    if (digest != m_lastOperationSnapshot) {
        m_lastOperationSnapshot = digest;
        emit operationSnapshotChanged(operations);
    }
    if (hasActiveOperations(operations)) {
        m_operationMonitorActive = true;
        m_operationPollFailures = 0;
        if (m_operationPollTimer && !m_operationPollInFlight) m_operationPollTimer->start(OperationPollIntervalMs);
    } else {
        m_operationMonitorActive = false;
        if (m_operationPollTimer) m_operationPollTimer->stop();
    }
}

void WorkstationServiceManager::pollOperationSnapshots()
{
    if (!m_operationMonitorActive || m_operationPollInFlight) return;
    const DiscoveryState discovery = readDiscovery();
    if (!discovery.valid) {
        m_operationMonitorActive = false;
        return;
    }

    QNetworkRequest request(QUrl(discovery.endpoint + QStringLiteral("/v1/native/capability")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setRawHeader("Accept", "application/json");
    request.setRawHeader("Authorization", QByteArray("Bearer ") + discovery.token.toUtf8());
    request.setTransferTimeout(OperationPollTimeoutMs);
    const QJsonObject body{
        {QStringLiteral("capability"), QStringLiteral("git.local.operation.list")},
        {QStringLiteral("payload"), QJsonObject{}},
    };
    m_operationPollInFlight = true;
    QNetworkReply *reply = m_network->post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        m_operationPollInFlight = false;
        const QByteArray bytes = reply->readAll();
        const auto networkError = reply->error();
        reply->deleteLater();
        if (networkError != QNetworkReply::NoError) {
            ++m_operationPollFailures;
            if (m_operationPollFailures >= OperationPollFailureLimit) {
                m_operationMonitorActive = false;
                return;
            }
            if (m_operationMonitorActive) m_operationPollTimer->start(OperationPollRetryMs);
            return;
        }
        QJsonParseError parseError;
        const QJsonDocument document = QJsonDocument::fromJson(bytes, &parseError);
        const QJsonObject response = document.object();
        if (parseError.error != QJsonParseError::NoError || !response.value(QStringLiteral("ok")).toBool(false)) {
            ++m_operationPollFailures;
            if (m_operationPollFailures < OperationPollFailureLimit && m_operationMonitorActive)
                m_operationPollTimer->start(OperationPollRetryMs);
            else
                m_operationMonitorActive = false;
            return;
        }
        m_operationPollFailures = 0;
        handleOperationSnapshot(response.value(QStringLiteral("result")).toObject().value(QStringLiteral("operations")).toArray());
    });
}
