#include "AppController.h"
#include "DesktopIntegration.h"
#include "CrashReporter.h"
#include "DeepLinkRouter.h"
#include "ServerProfileStore.h"

#include <QApplication>
#include <QIcon>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <qqml.h>
#include <QWindow>
#include <QQuickStyle>
#include <QSystemTrayIcon>
#include <QTimer>
#include <QtWebView>

#include <cstdlib>
#include <cstdio>

int main(int argc, char *argv[])
{
    bool smokeTest = false;
    for (int index = 1; index < argc; ++index) {
        if (QString::fromLocal8Bit(argv[index]) == QStringLiteral("--smoke-test")) {
            smokeTest = true;
            break;
        }
    }

    // Select the WebView2 user-data directory before Qt initializes its native web backend.
    // One active process == one server-scoped browser profile, so authentication, cookies,
    // local storage and caches never bleed between Cluster servers.
    const QString preparedProfileId = ServerProfileStore::prepareWebViewEnvironment(argc, argv);
    if (preparedProfileId.isEmpty()) {
        std::fputs("Cluster Desktop could not prepare its isolated browser profile. Check local app-data permissions and retry.\n", stderr);
        return EXIT_FAILURE;
    }
    QtWebView::initialize();
    QApplication app(argc, argv);
    QCoreApplication::setOrganizationName(QStringLiteral("Cluster Studio"));
    QCoreApplication::setOrganizationDomain(QStringLiteral("cluster.studio"));
    QCoreApplication::setApplicationName(QStringLiteral("Cluster"));
    QCoreApplication::setApplicationVersion(QStringLiteral(CLUSTER_DESKTOP_VERSION));
    const QIcon clusterIcon(QStringLiteral(":/qt/qml/Cluster/Desktop/assets/cluster-icon.png"));
    app.setWindowIcon(clusterIcon);
    CrashReporter::initialize();

    DeepLinkRouter deepLinks;
    if (!deepLinks.start(app.arguments()))
        return EXIT_SUCCESS;
    app.installEventFilter(&deepLinks);

    if (QSystemTrayIcon::isSystemTrayAvailable())
        app.setQuitOnLastWindowClosed(false);
    QQuickStyle::setStyle(QStringLiteral("Basic"));

    AppController controller;
    const QVariantMap priorCrash = CrashReporter::previousCrash();
    if (!priorCrash.isEmpty())
        controller.updateManager()->recordStartupFailure(QStringLiteral("Previous session ended unexpectedly: %1").arg(priorCrash.value(QStringLiteral("detail"), QStringLiteral("no crash detail was recorded")).toString()));
    QObject::connect(&deepLinks, &DeepLinkRouter::deepLinkReceived, &controller, &AppController::openDeepLink);
    QObject::connect(&deepLinks, &DeepLinkRouter::activateRequested, &controller, &AppController::activateWindowRequested);
    QObject::connect(&app, &QCoreApplication::aboutToQuit, [&controller] {
        controller.serverProfiles()->markCleanExit();
        CrashReporter::markCleanExit();
    });

    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty(QStringLiteral("clusterApp"), &controller);
    engine.loadFromModule(QStringLiteral("Cluster.Desktop"), QStringLiteral("Main"));
    if (engine.rootObjects().isEmpty())
        return EXIT_FAILURE;

    auto *window = qobject_cast<QWindow *>(engine.rootObjects().constFirst());
    if (window)
        window->setIcon(clusterIcon);
    DesktopIntegration desktopIntegration(&controller, window);
    if (app.arguments().contains(QStringLiteral("--background")) && window)
        window->hide();
    if (smokeTest) {
        if (window)
            window->hide();
        QTimer::singleShot(350, &app, &QCoreApplication::quit);
        return app.exec();
    }
    QMetaObject::invokeMethod(&controller, &AppController::initialize, Qt::QueuedConnection);
    // A successful same-origin renderer load confirms health immediately. This fallback
    // confirms the native runtime after a stable grace period so an offline/unreachable
    // server cannot leave a good desktop update permanently stuck in recovery.
    QTimer::singleShot(30'000, &app, [&controller] {
        if (!controller.connectionOnline() || controller.state() == QStringLiteral("server") || controller.state() == QStringLiteral("connecting"))
            controller.updateManager()->markRuntimeHealthy();
    });
    return app.exec();
}
