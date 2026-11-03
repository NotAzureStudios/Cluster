#pragma once

#include <QObject>
#include <QString>

class QAction;

class AppController;
class QMenu;
class QSystemTrayIcon;
class QWindow;
class QEvent;

class DesktopIntegration final : public QObject
{
    Q_OBJECT

public:
    DesktopIntegration(AppController *controller, QWindow *window, QObject *parent = nullptr);
    ~DesktopIntegration() override;
    bool eventFilter(QObject *watched, QEvent *event) override;

private:
    void showWindow();
    void updateTrayStatus();
    void rebuildServerMenu();
    void rebuildRecentMenu();
    void rebuildQuickActionsMenu();
    void rebuildNotificationToggle();

    AppController *m_controller = nullptr;
    QWindow *m_window = nullptr;
    QSystemTrayIcon *m_tray = nullptr;
    QMenu *m_menu = nullptr;
    QMenu *m_serversMenu = nullptr;
    QMenu *m_recentMenu = nullptr;
    QMenu *m_quickActionsMenu = nullptr;
    QAction *m_connectionAction = nullptr;
    QAction *m_notificationsAction = nullptr;
    bool m_quitting = false;
    QString m_pendingNotificationRoute;
};
