#include "CrashReporter.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMutex>
#include <QMutexLocker>
#include <QSaveFile>
#include <QStandardPaths>
#include <QSysInfo>
#include <QUuid>
#include <QtGlobal>

#include <cstdlib>
#include <exception>

#ifdef Q_OS_WIN
#include <windows.h>
#endif

namespace {
QMutex logMutex;
QVariantMap priorCrash;
QString markerPath;
QString desktopLogPath;
QtMessageHandler previousHandler = nullptr;
int crashStreak = 0;
QString sessionId;

void writeMarker(const QString &state, const QString &detail = {})
{
    QJsonObject object {
        {QStringLiteral("state"), state},
        {QStringLiteral("version"), QCoreApplication::applicationVersion()},
        {QStringLiteral("pid"), static_cast<qint64>(QCoreApplication::applicationPid())},
        {QStringLiteral("timestamp"), QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
        {QStringLiteral("sessionId"), sessionId},
        {QStringLiteral("crashStreak"), crashStreak},
        {QStringLiteral("platform"), QSysInfo::prettyProductName().left(160)},
        {QStringLiteral("cpuArchitecture"), QSysInfo::currentCpuArchitecture().left(80)},
    };
    if (!detail.isEmpty()) object.insert(QStringLiteral("detail"), detail.left(4000));
    QSaveFile file(markerPath);
    if (file.open(QIODevice::WriteOnly)) {
        file.write(QJsonDocument(object).toJson(QJsonDocument::Indented));
        file.commit();
    }
}

void messageHandler(QtMsgType type, const QMessageLogContext &context, const QString &message)
{
    QMutexLocker locker(&logMutex);
    QFile file(desktopLogPath);
    if (file.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text)) {
        const char *label = type == QtDebugMsg ? "DEBUG" : type == QtInfoMsg ? "INFO" : type == QtWarningMsg ? "WARN" : type == QtCriticalMsg ? "ERROR" : "FATAL";
        const QString line = QStringLiteral("%1 [%2] %3 (%4:%5)\n")
                                 .arg(QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs), QString::fromLatin1(label), message,
                                      QString::fromUtf8(context.file ? context.file : "unknown"))
                                 .arg(context.line);
        file.write(line.toUtf8());
    }
    if (type == QtFatalMsg)
        writeMarker(QStringLiteral("crashed"), message);
    if (previousHandler)
        previousHandler(type, context, message);
}

void terminateHandler()
{
    writeMarker(QStringLiteral("crashed"), QStringLiteral("Unhandled C++ termination."));
    std::abort();
}

#ifdef Q_OS_WIN
LONG WINAPI unhandledExceptionFilter(EXCEPTION_POINTERS *exception)
{
    const quint64 code = exception && exception->ExceptionRecord ? exception->ExceptionRecord->ExceptionCode : 0;
    writeMarker(QStringLiteral("crashed"), QStringLiteral("Windows exception 0x%1").arg(code, 0, 16));
    return EXCEPTION_EXECUTE_HANDLER;
}
#endif
}

void CrashReporter::initialize()
{
    const QString directory = logDirectory();
    QDir().mkpath(directory);
    markerPath = directory + QStringLiteral("/desktop-session.json");
    desktopLogPath = directory + QStringLiteral("/desktop.log");

    QFile previous(markerPath);
    if (previous.open(QIODevice::ReadOnly)) {
        const QJsonObject object = QJsonDocument::fromJson(previous.readAll()).object();
        const QString state = object.value(QStringLiteral("state")).toString();
        if (state == QStringLiteral("running") || state == QStringLiteral("crashed")) {
            priorCrash = object.toVariantMap();
            const bool sameVersion = object.value(QStringLiteral("version")).toString() == QCoreApplication::applicationVersion();
            crashStreak = sameVersion ? qBound(1, object.value(QStringLiteral("crashStreak")).toInt(0) + 1, 99) : 1;
            priorCrash.insert(QStringLiteral("crashStreak"), crashStreak);
            priorCrash.insert(QStringLiteral("safeModeRecommended"), crashStreak >= 3);
        }
    }

    sessionId = QUuid::createUuid().toString(QUuid::WithoutBraces);
    writeMarker(QStringLiteral("running"));
    previousHandler = qInstallMessageHandler(messageHandler);
    std::set_terminate(terminateHandler);
#ifdef Q_OS_WIN
    SetUnhandledExceptionFilter(unhandledExceptionFilter);
#endif
}

void CrashReporter::markHealthy()
{
    crashStreak = 0;
    writeMarker(QStringLiteral("healthy"));
}

void CrashReporter::markCleanExit()
{
    writeMarker(QStringLiteral("clean"));
}

QVariantMap CrashReporter::previousCrash()
{
    return priorCrash;
}

QVariantMap CrashReporter::startupDiagnostics()
{
    return QVariantMap {
        {QStringLiteral("sessionId"), sessionId},
        {QStringLiteral("crashStreak"), crashStreak},
        {QStringLiteral("safeModeRecommended"), crashStreak >= 3},
        {QStringLiteral("logDirectory"), logDirectory()},
        {QStringLiteral("version"), QCoreApplication::applicationVersion()},
        {QStringLiteral("platform"), QSysInfo::prettyProductName().left(160)},
        {QStringLiteral("cpuArchitecture"), QSysInfo::currentCpuArchitecture().left(80)},
    };
}

QString CrashReporter::logDirectory()
{
    return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + QStringLiteral("/logs");
}
