#pragma once

#include <QVariantMap>

class CrashReporter
{
public:
    static void initialize();
    static void markHealthy();
    static void markCleanExit();
    static QVariantMap previousCrash();
    static QVariantMap startupDiagnostics();
    static QString logDirectory();
};
