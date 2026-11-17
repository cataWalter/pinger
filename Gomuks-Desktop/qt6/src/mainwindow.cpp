#include "mainwindow.h"

#include "backendclient.h"
#include "aitoolsdialog.h"
#include "animations.h"
#include "chatitemdelegate.h"
#include "localaichatdialog.h"
#include "mediaclient.h"
#include "mediadialogs.h"
#include "qtutil.h"
#include "settingsdialog.h"
#include "stylesheet.h"

#include <QAction>
#include <QActionGroup>
#include <QAbstractItemView>
#include <QApplication>
#include <QButtonGroup>
#include <QComboBox>
#include <QClipboard>
#include <QCheckBox>
#include <QColorDialog>
#include <QDateTime>
#include <QDateTimeEdit>
#include <QCloseEvent>
#include <QDesktopServices>
#include <QDialog>
#include <QDialogButtonBox>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QFrame>
#include <QGuiApplication>
#include <QGraphicsBlurEffect>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QImage>
#include <QKeyEvent>
#include <QKeySequence>
#include <QDragEnterEvent>
#include <QDropEvent>
#include <QMimeData>
#include <QUrl>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonValue>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QListWidgetItem>
#include <QMenu>
#include <QMessageBox>
#include <QPlainTextEdit>
#include <QPixmap>
#include <QPushButton>
#include <QPointer>
#include <QRegularExpression>
#include <QSignalBlocker>
#include <QSet>
#include <QSplitter>
#include <QStackedWidget>
#include <QStatusBar>
#include <QStyle>
#include <QSystemTrayIcon>
#include <QStyleHints>
#include <QStringList>
#include <QTabWidget>
#include <QTextCursor>
#include <QToolButton>
#include <QTimer>
#include <QUrl>
#include <QVector>
#include <QUuid>
#include <QVBoxLayout>
#include <QWidget>

#include <functional>
#include <memory>
#include <QColor>
#include <QFontMetrics>
#include <QPainter>
#include <QPainterPath>
#include <QPalette>
#include <QScrollBar>

namespace {

QKeySequence primaryShortcut(const QString &key) {
#if defined(Q_OS_MACOS)
    return QKeySequence(QStringLiteral("Meta+%1").arg(key));
#else
    return QKeySequence(QStringLiteral("Ctrl+%1").arg(key));
#endif
}

QString roomDraftKey(const QString &accountID, const QString &roomID) {
    return accountID + QChar(0x1f) + roomID;
}

void drawLucideIcon(QPainter &painter, const QString &name, const QColor &color) {
    QPen pen(color, 2.0);
    pen.setCapStyle(Qt::RoundCap);
    pen.setJoinStyle(Qt::RoundJoin);
    painter.setPen(pen);
    painter.setBrush(Qt::NoBrush);

    if (name == QStringLiteral("search")) {
        painter.drawEllipse(QRectF(3, 3, 14, 14));
        painter.drawLine(QPointF(16.5, 16.5), QPointF(21, 21));
    } else if (name == QStringLiteral("eye-off")) {
        QPainterPath eye;
        eye.moveTo(2.5, 12);
        eye.cubicTo(5, 7.5, 8.5, 5, 12, 5);
        eye.cubicTo(16.5, 5, 20, 8.5, 21.5, 12);
        eye.cubicTo(20, 15.5, 16.5, 19, 12, 19);
        eye.cubicTo(8.5, 19, 5, 16.5, 2.5, 12);
        painter.drawPath(eye);
        painter.drawEllipse(QRectF(9, 9, 6, 6));
        painter.drawLine(QPointF(4, 4), QPointF(20, 20));
    } else if (name == QStringLiteral("all") || name == QStringLiteral("rooms")) {
        QPainterPath bubble;
        bubble.moveTo(7.5, 20.2);
        bubble.cubicTo(4.5, 18.7, 2.5, 15.6, 2.5, 12);
        bubble.cubicTo(2.5, 6.8, 6.8, 2.5, 12, 2.5);
        bubble.cubicTo(17.2, 2.5, 21.5, 6.8, 21.5, 12);
        bubble.cubicTo(21.5, 17.2, 17.2, 21.5, 12, 21.5);
        bubble.cubicTo(10.4, 21.5, 8.9, 21.1, 7.5, 20.2);
        painter.drawPath(bubble);
        painter.drawLine(QPointF(7.5, 20.2), QPointF(3.2, 21.2));
        painter.drawLine(QPointF(3.2, 21.2), QPointF(4.2, 17));
        painter.setBrush(color);
        painter.drawEllipse(QRectF(7, 10.5, 2, 2));
        painter.drawEllipse(QRectF(11, 10.5, 2, 2));
        painter.drawEllipse(QRectF(15, 10.5, 2, 2));
    } else if (name == QStringLiteral("unread") || name == QStringLiteral("needs-reply")) {
        painter.drawEllipse(QRectF(3, 3, 18, 18));
        painter.setBrush(color);
        painter.drawEllipse(QRectF(10, 10, 4, 4));
    } else if (name == QStringLiteral("mention")) {
        painter.drawEllipse(QRectF(3, 3, 18, 18));
        painter.drawEllipse(QRectF(8, 8, 8, 8));
        painter.drawLine(QPointF(16, 11), QPointF(16, 15));
        painter.drawLine(QPointF(16, 15), QPointF(19, 15));
    } else if (name == QStringLiteral("unanswered")) {
        QPainterPath reply;
        reply.moveTo(9, 17);
        reply.lineTo(4, 12);
        reply.lineTo(9, 7);
        reply.moveTo(4, 12);
        reply.lineTo(14, 12);
        reply.cubicTo(18, 12, 20, 14, 20, 18);
        painter.drawPath(reply);
    } else if (name == QStringLiteral("star")) {
        QPainterPath path;
        path.moveTo(12, 3);
        path.lineTo(14.8, 9);
        path.lineTo(21.3, 9.7);
        path.lineTo(16.5, 14);
        path.lineTo(17.8, 20.5);
        path.lineTo(12, 17.2);
        path.lineTo(6.2, 20.5);
        path.lineTo(7.5, 14);
        path.lineTo(2.7, 9.7);
        path.lineTo(9.2, 9);
        path.closeSubpath();
        painter.drawPath(path);
    } else if (name == QStringLiteral("archive")) {
        painter.drawRoundedRect(QRectF(3, 4, 18, 4), 1, 1);
        painter.drawLine(QPointF(5, 8), QPointF(5, 19));
        painter.drawLine(QPointF(19, 8), QPointF(19, 19));
        painter.drawLine(QPointF(5, 19), QPointF(19, 19));
        painter.drawLine(QPointF(9, 12), QPointF(15, 12));
    } else if (name == QStringLiteral("more")) {
        painter.setBrush(color);
        painter.drawEllipse(QRectF(4, 10, 2, 2));
        painter.drawEllipse(QRectF(11, 10, 2, 2));
        painter.drawEllipse(QRectF(18, 10, 2, 2));
    } else if (name == QStringLiteral("add")) {
        painter.drawLine(QPointF(12, 5), QPointF(12, 19));
        painter.drawLine(QPointF(5, 12), QPointF(19, 12));
    } else if (name == QStringLiteral("people")) {
        painter.drawEllipse(QRectF(8, 3, 8, 8));
        QPainterPath people;
        people.moveTo(3, 21);
        people.cubicTo(3, 16.5, 6, 14, 12, 14);
        people.cubicTo(18, 14, 21, 16.5, 21, 21);
        people.moveTo(17, 5);
        people.cubicTo(20, 5, 21, 7, 21, 10);
        people.moveTo(19, 14);
        people.cubicTo(21, 14.5, 22, 16.5, 22, 19);
        painter.drawPath(people);
    } else if (name == QStringLiteral("info")) {
        painter.drawEllipse(QRectF(3, 3, 18, 18));
        painter.drawLine(QPointF(12, 11), QPointF(12, 16));
        painter.setBrush(color);
        painter.drawEllipse(QRectF(11, 7, 2, 2));
    } else if (name == QStringLiteral("schedule")) {
        painter.drawEllipse(QRectF(3, 3, 18, 18));
        painter.drawLine(QPointF(12, 7), QPointF(12, 12));
        painter.drawLine(QPointF(12, 12), QPointF(16, 14));
    } else if (name == QStringLiteral("attach")) {
        QPainterPath path;
        path.moveTo(8, 12);
        path.lineTo(15, 5);
        path.cubicTo(19, 1, 24, 6, 20, 10);
        path.lineTo(10, 20);
        path.cubicTo(5, 25, -1, 19, 4, 14);
        path.lineTo(14, 4);
        painter.drawPath(path);
    } else if (name == QStringLiteral("mic")) {
        painter.drawRoundedRect(QRectF(9, 2, 6, 13), 3, 3);
        painter.drawArc(QRectF(5, 7, 14, 12), 180 * 16, 180 * 16);
        painter.drawLine(QPointF(12, 19), QPointF(12, 22));
        painter.drawLine(QPointF(8, 22), QPointF(16, 22));
    } else if (name == QStringLiteral("send")) {
        QPainterPath path;
        path.moveTo(22, 2);
        path.lineTo(15, 22);
        path.lineTo(11, 13);
        path.lineTo(2, 9);
        path.closeSubpath();
        painter.drawPath(path);
        painter.drawLine(QPointF(22, 2), QPointF(11, 13));
    } else if (name == QStringLiteral("sparkle")) {
        QPainterPath sparkle;
        sparkle.moveTo(12, 2);
        sparkle.cubicTo(12.3, 8.5, 14.5, 10.8, 22, 12);
        sparkle.cubicTo(14.5, 13.2, 12.3, 15.5, 12, 22);
        sparkle.cubicTo(11.7, 15.5, 9.5, 13.2, 2, 12);
        sparkle.cubicTo(9.5, 10.8, 11.7, 8.5, 12, 2);
        sparkle.closeSubpath();
        painter.drawPath(sparkle);
        painter.drawLine(QPointF(19, 3), QPointF(19, 7));
        painter.drawLine(QPointF(17, 5), QPointF(21, 5));
        painter.drawLine(QPointF(5, 17), QPointF(5, 21));
        painter.drawLine(QPointF(3, 19), QPointF(7, 19));
    } else if (name == QStringLiteral("smile")) {
        painter.drawEllipse(QRectF(3, 3, 18, 18));
        painter.setBrush(color);
        painter.drawEllipse(QRectF(8, 9, 2, 2));
        painter.drawEllipse(QRectF(14, 9, 2, 2));
        QPainterPath smile;
        smile.moveTo(7, 14);
        smile.cubicTo(9, 18, 15, 18, 17, 14);
        painter.drawPath(smile);
    } else if (name == QStringLiteral("settings")) {
        painter.drawEllipse(QRectF(6, 6, 12, 12));
        painter.drawEllipse(QRectF(9, 9, 6, 6));
        for (int angle = 0; angle < 360; angle += 45) {
            painter.save();
            painter.translate(12, 12);
            painter.rotate(angle);
            painter.drawLine(QPointF(0, -10), QPointF(0, -8));
            painter.restore();
        }
    } else if (name == QStringLiteral("images")) {
        painter.drawRoundedRect(QRectF(4, 4, 16, 16), 2, 2);
        painter.drawEllipse(QRectF(8, 8, 3, 3));
        QPainterPath mountains;
        mountains.moveTo(5, 18);
        mountains.lineTo(10, 13);
        mountains.lineTo(13, 16);
        mountains.lineTo(16, 12);
        mountains.lineTo(19, 15);
        painter.drawPath(mountains);
    } else if (name == QStringLiteral("bold") || name == QStringLiteral("italic")
               || name == QStringLiteral("strikethrough")) {
        QFont font = painter.font();
        font.setPixelSize(16);
        font.setBold(name != QStringLiteral("italic"));
        font.setItalic(name == QStringLiteral("italic"));
        painter.setFont(font);
        painter.drawText(QRectF(2, 2, 20, 20), Qt::AlignCenter,
                         name == QStringLiteral("strikethrough")
                             ? QStringLiteral("S") : QStringLiteral("B"));
        if (name == QStringLiteral("strikethrough")) {
            painter.drawLine(QPointF(4, 12), QPointF(20, 12));
        }
    } else if (name == QStringLiteral("code") || name == QStringLiteral("code-block")) {
        QPainterPath brackets;
        brackets.moveTo(9, 6);
        brackets.lineTo(4, 12);
        brackets.lineTo(9, 18);
        brackets.moveTo(15, 6);
        brackets.lineTo(20, 12);
        brackets.lineTo(15, 18);
        if (name == QStringLiteral("code-block")) {
            painter.drawRoundedRect(QRectF(2, 3, 20, 18), 2, 2);
            painter.save();
            painter.translate(-1, 0);
            painter.drawPath(brackets);
            painter.restore();
        } else {
            painter.drawPath(brackets);
        }
    } else if (name == QStringLiteral("link")) {
        painter.drawRoundedRect(QRectF(2.5, 8, 11, 7), 3.5, 3.5);
        painter.drawRoundedRect(QRectF(10.5, 9, 11, 7), 3.5, 3.5);
        painter.drawLine(QPointF(9, 12), QPointF(15, 12));
    } else if (name == QStringLiteral("heading")) {
        QFont font = painter.font();
        font.setPixelSize(14);
        font.setBold(true);
        painter.setFont(font);
        painter.drawText(QRectF(2, 2, 20, 17), Qt::AlignCenter, QStringLiteral("H"));
        painter.drawLine(QPointF(5, 20), QPointF(19, 20));
    } else if (name == QStringLiteral("list") || name == QStringLiteral("list-ordered")) {
        QFont font = painter.font();
        font.setPixelSize(8);
        font.setBold(true);
        painter.setFont(font);
        for (int row = 0; row < 2; ++row) {
            const int y = 7 + row * 8;
            if (name == QStringLiteral("list")) {
                painter.setBrush(color);
                painter.drawEllipse(QRectF(3, y, 2, 2));
            } else {
                painter.drawText(QRectF(1, y - 4, 7, 8), Qt::AlignCenter,
                                 QString::number(row + 1));
            }
            painter.drawLine(QPointF(9, y + 1), QPointF(21, y + 1));
        }
    } else if (name == QStringLiteral("quote")) {
        QFont font = painter.font();
        font.setPixelSize(19);
        font.setBold(true);
        painter.setFont(font);
        painter.drawText(QRectF(2, 1, 20, 20), Qt::AlignCenter, QStringLiteral("\""));
    }
}

QIcon uiIcon(const QString &name) {
    constexpr int logicalSize = 18;
    QIcon icon;
    for (qreal dpr : {1.0, 2.0, 3.0}) {
        for (QIcon::State state : {QIcon::Off, QIcon::On}) {
            const int pixelSize = qRound(logicalSize * dpr);
            QPixmap pixmap(pixelSize, pixelSize);
            pixmap.setDevicePixelRatio(dpr);
            pixmap.fill(Qt::transparent);
            QPainter painter(&pixmap);
            painter.setRenderHint(QPainter::Antialiasing);
            painter.setRenderHint(QPainter::TextAntialiasing);
            painter.scale(logicalSize / 24.0, logicalSize / 24.0);
            const QColor color = state == QIcon::On
                ? QColor(QStringLiteral("#F0A5BC"))
                : QColor(QStringLiteral("#91A3BB"));
            drawLucideIcon(painter, name, color);
            painter.end();
            icon.addPixmap(pixmap, QIcon::Normal, state);
            icon.addPixmap(pixmap, QIcon::Selected, state);
        }
    }
    return icon;
}

QString avatarInitials(const QString &name) {
    const QStringList words = name.trimmed().split(
        QRegularExpression(QStringLiteral("[\\s_.@-]+")), Qt::SkipEmptyParts);
    if (words.isEmpty()) {
        return QStringLiteral("?");
    }
    QString result = words.first().left(1).toUpper();
    if (words.size() > 1) {
        result += words.at(1).left(1).toUpper();
    }
    return result;
}

QIcon trayIconWithBadge(const QIcon &base, int unread) {
    if (unread <= 0) {
        return base;
    }
    constexpr int size = 22;
    constexpr int badgeHeight = 10;
    QPixmap pixmap = base.pixmap(QSize(size, size), 2.0);
    if (pixmap.isNull()) {
        return base;
    }
    QPainter painter(&pixmap);
    painter.setRenderHint(QPainter::Antialiasing);
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(9);
    painter.setFont(font);
    const QString label = unread > 99 ? QStringLiteral("99+") : QString::number(unread);
    const int badgeWidth = qMax(badgeHeight, QFontMetrics(font).horizontalAdvance(label) + 4);
    const QRect badge(size - badgeWidth, size - badgeHeight, badgeWidth, badgeHeight);
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#e0245e")));
    painter.drawRoundedRect(badge, badgeHeight / 2, badgeHeight / 2);
    painter.setPen(Qt::white);
    painter.drawText(badge, Qt::AlignCenter, label);
    painter.end();
    return QIcon(pixmap);
}

void preparePopupMenu(QMenu *menu) {
    menu->setAttribute(Qt::WA_TranslucentBackground);
    menu->setWindowFlags(menu->windowFlags() | Qt::FramelessWindowHint);
}

void setContextShortcut(QAction *action, const QKeySequence &shortcut) {
    if (!action || shortcut.isEmpty()) {
        return;
    }
    action->setShortcut(shortcut);
    action->setShortcutContext(Qt::WidgetShortcut);
    const QString label = action->text().section(QLatin1Char('\t'), 0, 0);
    action->setText(label + QLatin1Char('\t')
                    + shortcut.toString(QKeySequence::NativeText));
}

} // namespace

MainWindow::MainWindow(BackendClient *backend, QWidget *parent)
    : QMainWindow(parent), backend_(backend), media_(new MediaClient(this)) {
    setWindowTitle(QStringLiteral("Pinger"));
    const QIcon appIcon = qtutil::applicationIcon();
    QApplication::setWindowIcon(appIcon);
    setWindowIcon(appIcon);
    resize(1100, 720);

    pages_ = new QStackedWidget(this);
    setCentralWidget(pages_);
    buildLoginPage();
    buildVerificationPage();
    buildChatPage();
    buildMenuBar();
    qApp->installEventFilter(this);
    setAcceptDrops(true);
    configureListViews(this);
#if defined(Q_OS_MACOS)
    QStyleHints *styleHints = QGuiApplication::styleHints();
    trayBaseIcon_ = qtutil::menuBarIcon(
        styleHints->colorScheme() == Qt::ColorScheme::Dark);
    connect(styleHints, &QStyleHints::colorSchemeChanged, this,
            [this](Qt::ColorScheme scheme) {
                trayBaseIcon_ = qtutil::menuBarIcon(scheme == Qt::ColorScheme::Dark);
                updateTrayIcon();
            });
#else
    trayBaseIcon_ = appIcon;
#endif
    trayIcon_ = new QSystemTrayIcon(trayBaseIcon_, this);
    trayIcon_->setToolTip(QStringLiteral("Pinger"));
    trayMenu_ = new QMenu(this);
    auto *showAction = trayMenu_->addAction(QStringLiteral("Show Pinger"));
    trayMenu_->addSeparator();
    auto *quitAction = trayMenu_->addAction(QStringLiteral("Quit"));
    trayIcon_->setContextMenu(trayMenu_);
    if (QSystemTrayIcon::isSystemTrayAvailable()) {
        trayIcon_->show();
    }
    connect(showAction, &QAction::triggered, this, [this] {
        showNormal();
        raise();
        activateWindow();
    });
    connect(quitAction, &QAction::triggered, qApp, &QApplication::quit);
    connect(trayIcon_, &QSystemTrayIcon::activated, this,
            [this](QSystemTrayIcon::ActivationReason reason) {
                if (reason == QSystemTrayIcon::Trigger || reason == QSystemTrayIcon::DoubleClick) {
                    showNormal();
                    raise();
                    activateWindow();
                }
            });
    connect(trayIcon_, &QSystemTrayIcon::messageClicked, this, [this] {
        showNormal();
        raise();
        activateWindow();
        const QString roomID = pendingNotificationRoomID_;
        const QString accountID = pendingNotificationAccountID_;
        pendingNotificationRoomID_.clear();
        pendingNotificationAccountID_.clear();
        if (roomID.isEmpty()) {
            return;
        }
        roomFilter_->clear();
        pendingRoomID_ = roomID;
        if (!accountID.isEmpty()
            && accountID != snapshot_.value(QStringLiteral("activeAccountId")).toString()) {
            switchAccount(accountID);
        } else {
            loadSnapshot();
        }
    });
    pages_->setCurrentWidget(loginPage_);

    refreshTimer_ = new QTimer(this);
    refreshTimer_->setInterval(500);
    refreshTimer_->setSingleShot(true);
    connect(refreshTimer_, &QTimer::timeout, this, [this] {
        loadSnapshot();
        if (!currentRoomID_.isEmpty() && historyBefore_ == 0) {
            loadHistory(currentRoomID_);
        }
    });
    accountRoomsTimer_ = new QTimer(this);
    accountRoomsTimer_->setInterval(15000);
    connect(accountRoomsTimer_, &QTimer::timeout, this, &MainWindow::refreshAccountRooms);
    undoAnsweredTimer_ = new QTimer(this);
    undoAnsweredTimer_->setSingleShot(true);
    undoAnsweredTimer_->setInterval(10000);
    connect(undoAnsweredTimer_, &QTimer::timeout, this, [this] {
        undoAnsweredRoomID_.clear();
    });
    connect(backend_, &BackendClient::eventReceived, this,
            [this](const QString &event, const QJsonValue &data) {
                if (event == QStringLiteral("quit")) {
                    close();
                    return;
                }
                if (event == QStringLiteral("scheduler:reminder")) {
                    const auto reminder = data.toObject();
                    const QString roomID = reminder.value(QStringLiteral("roomId")).toString();
                    const QString roomName = roomByID(roomID).value(QStringLiteral("name")).toString(roomID);
                    QString text = reminder.value(QStringLiteral("text")).toString().trimmed();
                    if (text.isEmpty()) {
                        text = QStringLiteral("A scheduled reminder is due.");
                    }
                    statusBar()->showMessage(QStringLiteral("%1: %2").arg(roomName, text), 15000);
                    return;
                }
                if (event == QStringLiteral("chat-export:progress")) {
                    const auto progress = data.toObject();
                    statusBar()->showMessage(
                        QStringLiteral("Exporting chat history · %1 messages loaded")
                            .arg(progress.value(QStringLiteral("messages")).toInt()));
                    return;
                }
                if (event == QStringLiteral("media-ready")) {
                    media_->setBaseUrl(data.toObject().value(QStringLiteral("url")).toString());
                    requestVisibleRoomAvatars();
                    requestAvatar(profileAvatarUri_);
                    requestAvatar(activeRoomAvatarUri_);
                    for (int index = 0; index < messages_->count(); ++index) {
                        const auto message = QJsonObject::fromVariantMap(
                            messages_->item(index)->data(Qt::UserRole + 1).toMap());
                        requestAvatar(message.value(QStringLiteral("avatar")).toString());
                    }
                    return;
                }
                if (event == QStringLiteral("update")) {
                    const auto update = data.toObject();
                    if (trayIcon_ && trayIcon_->isVisible()
                        && preferences_.value(QStringLiteral("notifications.enabled")).toBool(true)
                        && (!preferences_.value(QStringLiteral("notifications.only_when_unfocused"))
                             .toBool(true) || !isActiveWindow())) {
                        const QString privacy = preferences_.value(QStringLiteral("notifications.privacy"))
                            .toString(QStringLiteral("Sender and message preview"));
                        for (const auto &entry : update.value(QStringLiteral("notifications")).toArray()) {
                            const auto alert = entry.toObject();
                            const QString roomID = alert.value(QStringLiteral("roomId")).toString();
                            const QString room = alert.value(QStringLiteral("room")).toString(
                                QStringLiteral("Pinger"));
                            const QString sender = alert.value(QStringLiteral("sender")).toString();
                            QString message;
                            if (privacy == QStringLiteral("Hidden content")) {
                                message = QStringLiteral("New activity");
                            } else if (privacy == QStringLiteral("Sender only")) {
                                message = sender;
                            } else {
                                const QString body = alert.value(QStringLiteral("body")).toString();
                                message = sender.isEmpty() ? body : QStringLiteral("%1: %2").arg(sender, body);
                            }
                            if (message.trimmed().isEmpty()) {
                                message = QStringLiteral("New activity");
                            }
                            pendingNotificationRoomID_ = roomID;
                            pendingNotificationAccountID_ =
                                alert.value(QStringLiteral("accountId")).toString();
                            trayIcon_->showMessage(room, message,
                                                   QSystemTrayIcon::Information, 5000);
                        }
                    }
                    refreshTimer_->start();
                    updateTrayIcon();
                    return;
                }
                if (event == QStringLiteral("update") || event == QStringLiteral("preferences")) {
                    refreshTimer_->start();
                }
            });
    connect(backend_, &BackendClient::backendFailed, this, &MainWindow::showError);
    media_->setBaseUrl(backend_->mediaBaseUrl());
    loadSnapshot();
}

void MainWindow::closeEvent(QCloseEvent *event) {
    if (trayIcon_ && trayIcon_->isVisible()
        && (preferences_.value(QStringLiteral("window.minimize_to_tray")).toBool()
            || !preferences_.value(QStringLiteral("window.quit_on_close")).toBool(true))) {
        hide();
        event->ignore();
        return;
    }
    QMainWindow::closeEvent(event);
}

void MainWindow::updateTrayIcon() {
    if (!trayIcon_) {
        return;
    }
    int unread = 0;
    for (const auto &entry : snapshot_.value(QStringLiteral("rooms")).toArray()) {
        unread += entry.toObject().value(QStringLiteral("unread")).toInt();
    }
    trayIcon_->setIcon(trayIconWithBadge(trayBaseIcon_, unread));
    trayIcon_->setToolTip(unread > 0
        ? QStringLiteral("Pinger · %1 unread").arg(unread)
        : QStringLiteral("Pinger"));
}

void MainWindow::keyPressEvent(QKeyEvent *event) {
    if (handleApplicationKey(event)) {
        event->accept();
        return;
    }
    QMainWindow::keyPressEvent(event);
}

bool MainWindow::handleApplicationKey(QKeyEvent *event) {
    if (pages_->currentWidget() != chatPage_ || event->isAutoRepeat()) {
        return false;
    }
    const auto *focus = QApplication::focusWidget();
    const bool textEntry = qobject_cast<const QLineEdit *>(focus)
        || qobject_cast<const QPlainTextEdit *>(focus)
        || (qobject_cast<const QComboBox *>(focus)
            && qobject_cast<const QComboBox *>(focus)->isEditable());
    const Qt::KeyboardModifiers modifiers = event->modifiers();
    const bool primary = modifiers.testFlag(Qt::ControlModifier)
        || modifiers.testFlag(Qt::MetaModifier);
    const bool shift = modifiers.testFlag(Qt::ShiftModifier);
    const bool alt = modifiers.testFlag(Qt::AltModifier);
    const int key = event->key();
    const bool timelineFocus = focus == messages_ || focus == messages_->viewport();

    if (primary && shift && !alt && key == Qt::Key_P) {
        contentBlurAction_->trigger();
        return true;
    }

    if (primary && shift && !alt && textEntry && focus != composer_
        && (key == Qt::Key_T || key == Qt::Key_B || key == Qt::Key_J)) {
        return true;
    }

    if (primary && shift && !alt && (!textEntry || focus == composer_)) {
        if (key == Qt::Key_T || key == Qt::Key_B || key == Qt::Key_J) {
            const QString shortcut = QString(QChar(key));
            const QString tab = key == Qt::Key_T ? QStringLiteral("Language Tutor")
                              : key == Qt::Key_B ? QStringLiteral("Suggestions")
                                                 : QStringLiteral("Image");
            showAITools(tab, shortcut, composer_->toPlainText());
            return true;
        }
        if (timelineFocus && messages_->currentItem()) {
            const QJsonObject message = messagesByID_.value(
                messages_->currentItem()->data(Qt::UserRole).toString());
            const QString body = message.value(QStringLiteral("body")).toString();
            if (key == Qt::Key_C || key == Qt::Key_D || key == Qt::Key_E) {
                const QString shortcut = QString(QChar(key));
                const QString tab = key == Qt::Key_D ? QStringLiteral("Suggestions")
                                                     : QStringLiteral("Language Tutor");
                showAITools(tab, shortcut, body);
                return true;
            }
            if (key == Qt::Key_V
                && (message.value(QStringLiteral("mediaType")).toString() == QStringLiteral("m.audio")
                    || message.value(QStringLiteral("mediaMime")).toString()
                           .startsWith(QStringLiteral("audio/")))) {
                transcribeMessage(message);
                return true;
            }
        }
    }

    if (!textEntry && focus == rooms_ && shift
        && (key == Qt::Key_F10 || key == Qt::Key_Menu)) {
        if (rooms_->currentItem()) {
            const QRect itemRect = rooms_->visualItemRect(rooms_->currentItem());
            if (itemRect.isValid()) {
                showRoomContextMenu(itemRect.center());
            }
            return true;
        }
    }
    if (!textEntry && (focus == messages_ || focus == messages_->viewport())) {
        const bool singleKeyShortcuts =
            preferences_.value(QStringLiteral("shortcuts.single_keys")).toBool(true);
        if (singleKeyShortcuts && (key == Qt::Key_J || key == Qt::Key_K)) {
            const int direction = key == Qt::Key_J ? 1 : -1;
            if (messages_->count() > 0) {
                messages_->setCurrentRow(qBound(0, messages_->currentRow() + direction,
                                                messages_->count() - 1));
            }
            return true;
        }
        if (key == Qt::Key_Home || key == Qt::Key_End) {
            if (messages_->count() > 0) {
                messages_->setCurrentRow(key == Qt::Key_Home ? 0 : messages_->count() - 1);
            }
            return true;
        }
        if (singleKeyShortcuts && key == Qt::Key_R && !primary && !shift && !alt
            && messages_->currentItem()) {
            const QString eventID = messages_->currentItem()->data(Qt::UserRole).toString();
            const QJsonObject message = messagesByID_.value(eventID);
            if (!eventID.isEmpty() && !message.value(QStringLiteral("sending")).toBool()) {
                editEventID_.clear();
                replyToEventID_ = eventID;
                composer_->clear();
                setComposeContext(QStringLiteral("Replying to %1: %2")
                                      .arg(message.value(QStringLiteral("senderName")).toString(),
                                           message.value(QStringLiteral("body")).toString()));
                composer_->setFocus();
                return true;
            }
        }
    }

    if (key == Qt::Key_Escape) {
        if (roomFilter_->hasFocus() && !roomFilter_->text().isEmpty()) {
            roomFilter_->clear();
            return true;
        }
        if (!textEntry) {
            return false;
        }
    }
    if (!textEntry && !primary && !alt && key == Qt::Key_Slash) {
        roomFilter_->setFocus();
        return true;
    }
    if (!textEntry && !primary && !alt && key == Qt::Key_Question) {
        showSettings(QStringLiteral("Keyboard"));
        return true;
    }

    if (!textEntry && primary && !shift && !alt && key == Qt::Key_Z
        && !undoAnsweredRoomID_.isEmpty()) {
        undoMarkAnswered();
        return true;
    }

    if (!textEntry && primary && alt && !shift
        && key >= Qt::Key_1 && key <= Qt::Key_9) {
        const int accountIndex = key - Qt::Key_1;
        const auto accounts = snapshot_.value(QStringLiteral("accounts")).toArray();
        if (accountIndex < accounts.size()) {
            switchAccount(accounts.at(accountIndex).toObject()
                              .value(QStringLiteral("id")).toString());
            return true;
        }
        return false;
    }

    if (!textEntry && primary && shift) {
        if (key == Qt::Key_Up || key == Qt::Key_Down) {
            selectRoomByOffset(key == Qt::Key_Down ? 1 : -1, true);
            return true;
        }
    }

    if (!textEntry && primary && !shift && !alt) {
        if (key == Qt::Key_Up || key == Qt::Key_Down) {
            selectRoomByOffset(key == Qt::Key_Down ? 1 : -1);
            return true;
        }
        if (key >= Qt::Key_1 && key <= Qt::Key_9) {
            const int row = key - Qt::Key_1;
            if (row < rooms_->count()) {
                rooms_->setCurrentRow(row);
                return true;
            }
        }
    }

    if (!textEntry && alt && !primary && !shift
        && (key == Qt::Key_Up || key == Qt::Key_Down)) {
        selectRoomByOffset(key == Qt::Key_Down ? 1 : -1);
        return true;
    }

    if (!textEntry && !primary && !alt && !shift
        && preferences_.value(QStringLiteral("shortcuts.single_keys")).toBool(true)
        && !currentRoomID_.isEmpty()) {
        if (key == Qt::Key_N || key == Qt::Key_U || key == Qt::Key_A
            || key == Qt::Key_F || key == Qt::Key_M) {
            applyRoomShortcut(QString(QChar(key)).toLower());
            return true;
        }
        const QString answered = preferences_.value(QStringLiteral("shortcuts.mark_answered"))
                                     .toString(QStringLiteral("E")).trimmed();
        if (!answered.isEmpty() && event->text().compare(answered, Qt::CaseInsensitive) == 0) {
            const QJsonObject room = roomByID(currentRoomID_);
            if (room.value(QStringLiteral("needsReply")).toBool()) {
                markRoomAnswered(currentRoomID_);
                return true;
            }
        }
    }
    return false;
}

void MainWindow::selectRoomByOffset(int direction, bool needsReplyOnly) {
    QVector<int> rows;
    for (int index = 0; index < rooms_->count(); ++index) {
        const auto room = roomByID(rooms_->item(index)->data(Qt::UserRole).toString());
        if (!needsReplyOnly || room.value(QStringLiteral("needsReply")).toBool()) {
            rows.append(index);
        }
    }
    if (rows.isEmpty()) {
        return;
    }
    int current = rows.indexOf(rooms_->currentRow());
    int next = current < 0 ? (direction > 0 ? 0 : rows.size() - 1)
                           : (current + direction + rows.size()) % rows.size();
    rooms_->setCurrentRow(rows.at(next));
}

void MainWindow::applyRoomShortcut(const QString &key) {
    const QJsonObject room = roomByID(currentRoomID_);
    if (room.isEmpty()) {
        return;
    }
    const bool unread = room.value(QStringLiteral("unread")).toInt() > 0
        || room.value(QStringLiteral("markedUnread")).toBool();
    if (key == QStringLiteral("n")) {
        if (room.value(QStringLiteral("unanswered")).toBool()
            && !room.value(QStringLiteral("needsReply")).toBool()) {
            runRoomAction(QStringLiteral("SetRoomUnanswered"), {currentRoomID_, true});
        }
    } else if (key == QStringLiteral("u")) {
        if (unread) {
            const QString eventID = room.value(QStringLiteral("lastEventId")).toString();
            if (!eventID.isEmpty()) {
                runRoomAction(QStringLiteral("MarkRead"), {currentRoomID_, eventID});
            }
        } else {
            runRoomAction(QStringLiteral("MarkUnread"), {currentRoomID_});
        }
    } else if (key == QStringLiteral("a")) {
        runRoomAction(QStringLiteral("SetBooleanPreference"),
                      {archivePreferenceKey(room), !roomIsArchived(room)});
    } else if (key == QStringLiteral("f") || key == QStringLiteral("m")) {
        const bool favorite = key == QStringLiteral("f");
        const QString preference = favorite ? QStringLiteral("room.favorite.")
                                            : QStringLiteral("room.muted.");
        const QString field = favorite ? QStringLiteral("favorite") : QStringLiteral("muted");
        runRoomAction(QStringLiteral("SetBooleanPreference"),
                      {preference + currentRoomID_, !room.value(field).toBool()});
    }
}

void MainWindow::markRoomAnswered(const QString &roomID) {
    if (roomID.isEmpty()) {
        return;
    }
    backend_->call(QStringLiteral("SetRoomUnanswered"), {roomID, false},
                   [this, roomID](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            showError(error);
            return;
        }
        undoAnsweredRoomID_ = roomID;
        undoAnsweredTimer_->start();
        statusBar()->showMessage(
            QStringLiteral("Marked answered · %1 to undo")
                .arg(QKeySequence(QKeySequence::Undo).toString(QKeySequence::NativeText)),
            10000);
        loadSnapshot();
    });
}

void MainWindow::undoMarkAnswered() {
    const QString roomID = undoAnsweredRoomID_;
    if (roomID.isEmpty()) {
        return;
    }
    undoAnsweredRoomID_.clear();
    undoAnsweredTimer_->stop();
    backend_->call(QStringLiteral("SetRoomUnanswered"), {roomID, true},
                   [this, roomID](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            undoAnsweredRoomID_ = roomID;
            undoAnsweredTimer_->start();
            showError(error);
            return;
        }
        statusBar()->showMessage(QStringLiteral("Needs reply restored."), 5000);
        loadSnapshot();
    });
}

void MainWindow::showQuickSwitcher() {
    auto *dialog = new QDialog(this);
    dialog->setWindowTitle(QStringLiteral("Quick switch"));
    dialog->setModal(true);
    dialog->resize(480, 520);
    auto *layout = new QVBoxLayout(dialog);
    auto *query = new QLineEdit(dialog);
    query->setPlaceholderText(QStringLiteral("Search rooms…"));
    auto *list = new QListWidget(dialog);
    auto *roomDelegate = new RoomListDelegate(list);
    roomDelegate->setContentBlur(contentBlurEnabled_);
    list->setItemDelegate(roomDelegate);
    layout->addWidget(query);
    layout->addWidget(list, 1);
    for (int index = 0; index < rooms_->count(); ++index) {
        const auto *source = rooms_->item(index);
        auto *item = new QListWidgetItem(source->text(), list);
        item->setData(Qt::UserRole, source->data(Qt::UserRole));
        item->setData(Qt::UserRole + 1, source->data(Qt::UserRole + 1));
    }
    configureListViews(dialog);
    auto filter = [query, list] {
        const QString text = query->text().trimmed();
        int firstVisible = -1;
        for (int index = 0; index < list->count(); ++index) {
            auto *item = list->item(index);
            const auto room = QJsonObject::fromVariantMap(item->data(Qt::UserRole + 1).toMap());
            const bool match = text.isEmpty()
                || room.value(QStringLiteral("name")).toString().contains(text, Qt::CaseInsensitive)
                || room.value(QStringLiteral("id")).toString().contains(text, Qt::CaseInsensitive)
                || room.value(QStringLiteral("preview")).toString().contains(text, Qt::CaseInsensitive);
            item->setHidden(!match);
            if (match && firstVisible < 0) {
                firstVisible = index;
            }
        }
        if (firstVisible >= 0) {
            list->setCurrentRow(firstVisible);
        }
    };
    connect(query, &QLineEdit::textChanged, dialog, filter);
    auto selectCurrent = [this, dialog, list] {
        if (!list->currentItem()) {
            return;
        }
        const QString roomID = list->currentItem()->data(Qt::UserRole).toString();
        const auto room = roomByID(roomID);
        roomScope_->setCurrentIndex(roomScope_->findData(
            roomIsArchived(room) ? QStringLiteral("archived") : QStringLiteral("all")));
        roomFilter_->clear();
        for (int row = 0; row < rooms_->count(); ++row) {
            if (rooms_->item(row)->data(Qt::UserRole).toString() == roomID) {
                rooms_->setCurrentRow(row);
                break;
            }
        }
        dialog->accept();
    };
    connect(list, &QListWidget::itemActivated, dialog,
            [selectCurrent](QListWidgetItem *) { selectCurrent(); });
    connect(query, &QLineEdit::returnPressed, dialog, selectCurrent);
    if (list->count() > 0) {
        list->setCurrentRow(0);
    }
    query->setFocus();
    dialog->exec();
}

void MainWindow::buildLoginPage() {
    loginPage_ = new QWidget(this);
    loginPage_->setObjectName(QStringLiteral("loginPage"));
    auto *outer = new QVBoxLayout(loginPage_);
    outer->addStretch();
    auto *card = new QFrame(loginPage_);
    card->setObjectName(QStringLiteral("loginCard"));
    card->setFixedWidth(400);
    auto *cardLayout = new QVBoxLayout(card);
    cardLayout->setContentsMargins(36, 36, 36, 32);
    cardLayout->setSpacing(6);

    auto *title = new QLabel(QStringLiteral("Pinger"), card);
    title->setObjectName(QStringLiteral("loginTitle"));
    auto *subtitle = new QLabel(QStringLiteral("Sign in to your Matrix account"), card);
    subtitle->setObjectName(QStringLiteral("loginSubtitle"));
    cardLayout->addWidget(title);
    cardLayout->addWidget(subtitle);
    cardLayout->addSpacing(18);

    homeserver_ = new QLineEdit(QStringLiteral("https://matrix.org"), card);
    homeserver_->setPlaceholderText(QStringLiteral("https://matrix.example.org"));
    username_ = new QLineEdit(card);
    username_->setPlaceholderText(QStringLiteral("@you:matrix.org or you"));
    password_ = new QLineEdit(card);
    password_->setEchoMode(QLineEdit::Password);
    password_->setPlaceholderText(QStringLiteral("Password"));
    const auto addField = [cardLayout, card](const QString &caption, QWidget *field) {
        auto *label = new QLabel(caption, card);
        label->setObjectName(QStringLiteral("fieldCaption"));
        cardLayout->addWidget(label);
        cardLayout->addWidget(field);
        cardLayout->addSpacing(8);
    };
    addField(QStringLiteral("Homeserver"), homeserver_);
    addField(QStringLiteral("Username"), username_);
    addField(QStringLiteral("Password"), password_);

    loginButton_ = new QPushButton(QStringLiteral("Sign in"), card);
    loginButton_->setObjectName(QStringLiteral("primaryButton"));
    loginButton_->setDefault(true);
    loginButton_->setCursor(Qt::PointingHandCursor);
    cardLayout->addSpacing(6);
    cardLayout->addWidget(loginButton_);

    auto *error = new QLabel(card);
    error->setObjectName(QStringLiteral("loginError"));
    error->setWordWrap(true);
    error->setAlignment(Qt::AlignCenter);
    cardLayout->addWidget(error);

    outer->addWidget(card, 0, Qt::AlignHCenter);
    outer->addStretch();
    pages_->addWidget(loginPage_);

    connect(username_, &QLineEdit::returnPressed, password_, qOverload<>(&QLineEdit::setFocus));
    connect(password_, &QLineEdit::returnPressed, loginButton_, &QPushButton::click);

    connect(loginButton_, &QPushButton::clicked, this, [this, error] {
        loginButton_->setEnabled(false);
        error->clear();
        backend_->call(QStringLiteral("Login"),
                       {homeserver_->text(), username_->text(), password_->text()},
                       [this, error](QJsonValue, const QString &message) {
                           loginButton_->setEnabled(true);
                           if (!message.isEmpty()) {
                               error->setText(message);
                               return;
                           }
                           password_->clear();
                           loadSnapshot();
                       });
    });
}

void MainWindow::buildChatPage() {
    chatPage_ = new QWidget(this);
    chatPage_->setObjectName(QStringLiteral("chatPage"));
    auto *layout = new QHBoxLayout(chatPage_);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);
    auto *sidebar = new QWidget(chatPage_);
    sidebar->setObjectName(QStringLiteral("sidebar"));
    sidebar->setMinimumWidth(250);
    sidebar->setMaximumWidth(340);
    auto *sidebarLayout = new QVBoxLayout(sidebar);
    sidebarLayout->setContentsMargins(10, 12, 10, 12);
    sidebarLayout->setSpacing(10);
    accountSwitcher_ = new QComboBox(sidebar);
    addAccountButton_ = new QPushButton(QStringLiteral("Add account"), sidebar);
    devicesButton_ = new QPushButton(QStringLiteral("Manage devices"), sidebar);
    searchMessagesButton_ = new QPushButton(QStringLiteral("Search messages"), sidebar);
    joinRoomButton_ = new QPushButton(QStringLiteral("Join a room"), sidebar);
    directChatButton_ = new QPushButton(QStringLiteral("New direct chat"), sidebar);
    createGroupButton_ = new QPushButton(QStringLiteral("Create group"), sidebar);
    scheduledJobsButton_ = new QPushButton(QStringLiteral("Scheduled messages"), sidebar);
    preferencesButton_ = new QPushButton(QStringLiteral("Settings"), sidebar);
    aiButton_ = new QPushButton(QStringLiteral("AI features"), sidebar);
    localAIButton_ = new QPushButton(QStringLiteral("Local AI chats"), sidebar);
    exportButton_ = new QPushButton(QStringLiteral("Export chats"), sidebar);
    logoutButton_ = new QPushButton(QStringLiteral("Log out"), sidebar);
    roomScope_ = new QComboBox(sidebar);
    roomScope_->addItem(QStringLiteral("All rooms"), QStringLiteral("all"));
    roomScope_->addItem(QStringLiteral("Unread"), QStringLiteral("unread"));
    roomScope_->addItem(QStringLiteral("Mentions"), QStringLiteral("mentions"));
    roomScope_->addItem(QStringLiteral("Unanswered"), QStringLiteral("unanswered"));
    roomScope_->addItem(QStringLiteral("Needs reply"), QStringLiteral("needs-reply"));
    roomScope_->addItem(QStringLiteral("Favorites"), QStringLiteral("favorites"));
    roomScope_->addItem(QStringLiteral("Archived"), QStringLiteral("archived"));
    roomScope_->hide();
    roomFilter_ = new QLineEdit(sidebar);
    roomFilter_->setObjectName(QStringLiteral("roomSearchField"));
    roomFilter_->setPlaceholderText(QStringLiteral("Search rooms"));
    roomFilter_->setClearButtonEnabled(true);
    roomFilter_->addAction(uiIcon(QStringLiteral("search")), QLineEdit::LeadingPosition);
    accountScope_ = new QComboBox(sidebar);
    accountScope_->setObjectName(QStringLiteral("accountScope"));
    accountScope_->setMinimumWidth(94);
    accountScope_->setMaximumWidth(140);
    accountScope_->setToolTip(QStringLiteral("Filter rooms by account"));
    rooms_ = new QListWidget(sidebar);
    rooms_->setObjectName(QStringLiteral("roomsList"));
    roomDelegate_ = new RoomListDelegate(rooms_);
    roomDelegate_->setContentBlur(contentBlurEnabled_);
    rooms_->setItemDelegate(roomDelegate_);
    rooms_->setSpacing(0);
    rooms_->setContextMenuPolicy(Qt::CustomContextMenu);
    rooms_->setMouseTracking(true);
    rooms_->viewport()->setMouseTracking(true);
    rooms_->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    inviteLabel_ = new QLabel(QStringLiteral("Invitations"), sidebar);
    invites_ = new QListWidget(sidebar);
    installPrivacyBlurDelegate(invites_);
    invites_->setMaximumHeight(120);
    auto *inviteActions = new QHBoxLayout;
    acceptInviteButton_ = new QPushButton(QStringLiteral("Accept"), sidebar);
    declineInviteButton_ = new QPushButton(QStringLiteral("Decline"), sidebar);
    inviteActions->addWidget(acceptInviteButton_);
    inviteActions->addWidget(declineInviteButton_);
    inviteLabel_->hide();
    invites_->hide();
    acceptInviteButton_->hide();
    declineInviteButton_->hide();
    const QList<QPushButton *> secondaryActions = {
        addAccountButton_, devicesButton_, searchMessagesButton_, joinRoomButton_,
        directChatButton_, createGroupButton_, scheduledJobsButton_, preferencesButton_,
        aiButton_, localAIButton_, exportButton_, logoutButton_,
    };
    for (QPushButton *button : secondaryActions) {
        button->hide();
    }

    auto makeIconButton = [](QWidget *parent, const QString &icon,
                             const QString &toolTip) {
        auto *button = new QToolButton(parent);
        button->setObjectName(QStringLiteral("iconButton"));
        button->setIcon(uiIcon(icon));
        button->setIconSize(QSize(18, 18));
        button->setToolTip(toolTip);
        button->setCursor(Qt::PointingHandCursor);
        button->setFixedSize(34, 34);
        return button;
    };

    auto *navigationRow = new QHBoxLayout;
    navigationRow->setContentsMargins(0, 0, 0, 0);
    navigationRow->setSpacing(4);
    allRoomsFilterButton_ = makeIconButton(sidebar, QStringLiteral("all"),
                                           QStringLiteral("All rooms"));
    allRoomsFilterButton_->setCheckable(true);
    archivedRoomsFilterButton_ = makeIconButton(sidebar, QStringLiteral("archive"),
                                                QStringLiteral("Archived rooms"));
    archivedRoomsFilterButton_->setCheckable(true);
    auto *localAIQuickButton = makeIconButton(sidebar, QStringLiteral("sparkle"),
                                              QStringLiteral("Local AI chats"));
    navigationRow->addWidget(allRoomsFilterButton_);
    navigationRow->addWidget(archivedRoomsFilterButton_);
    navigationRow->addWidget(localAIQuickButton);

    auto *moreButton = new QToolButton(sidebar);
    moreButton->setObjectName(QStringLiteral("sidebarMoreButton"));
    moreButton->setIcon(uiIcon(QStringLiteral("more")));
    moreButton->setIconSize(QSize(18, 18));
    moreButton->setToolTip(QStringLiteral("More actions"));
    moreButton->setCursor(Qt::PointingHandCursor);
    moreButton->setPopupMode(QToolButton::InstantPopup);
    moreButton->setFixedSize(34, 34);
    auto *moreMenu = new QMenu(moreButton);
    preparePopupMenu(moreMenu);
    QList<QAction *> secondaryMenuActions;
    for (QPushButton *button : secondaryActions) {
        auto *action = moreMenu->addAction(button->text());
        connect(action, &QAction::triggered, button, &QPushButton::click);
        secondaryMenuActions.append(action);
    }
    moreMenu->addSeparator();
    QMenu *filtersMenu = moreMenu->addMenu(QStringLiteral("Room filters"));
    preparePopupMenu(filtersMenu);
    auto *filterActionGroup = new QActionGroup(filtersMenu);
    filterActionGroup->setExclusive(true);
    QList<QAction *> filterMenuActions;
    for (int index = 0; index < roomScope_->count(); ++index) {
        auto *action = filtersMenu->addAction(roomScope_->itemText(index));
        action->setCheckable(true);
        action->setData(index);
        filterActionGroup->addAction(action);
        filterMenuActions.append(action);
        connect(action, &QAction::triggered, this, [this, index] {
            roomScope_->setCurrentIndex(index);
        });
    }
    connect(moreMenu, &QMenu::aboutToShow, moreMenu, [secondaryActions, secondaryMenuActions] {
        for (qsizetype i = 0; i < secondaryActions.size(); ++i) {
            secondaryMenuActions[i]->setEnabled(secondaryActions[i]->isEnabled());
        }
    });
    connect(moreMenu, &QMenu::aboutToShow, this, [this, filterMenuActions] {
        for (QAction *action : filterMenuActions) {
            action->setChecked(action->data().toInt() == roomScope_->currentIndex());
        }
    });
    moreButton->setMenu(moreMenu);
    navigationRow->addWidget(moreButton);

    auto *refinementRow = new QHBoxLayout;
    refinementRow->setContentsMargins(0, 0, 0, 0);
    refinementRow->setSpacing(4);
    unansweredFilterButton_ = makeIconButton(sidebar, QStringLiteral("unanswered"),
                                             QStringLiteral("Unanswered rooms"));
    unansweredFilterButton_->setCheckable(true);
    needsReplyFilterButton_ = makeIconButton(sidebar, QStringLiteral("needs-reply"),
                                             QStringLiteral("Needs reply"));
    needsReplyFilterButton_->setCheckable(true);
    needsReplyCountLabel_ = new QLabel(needsReplyFilterButton_);
    needsReplyCountLabel_->setObjectName(QStringLiteral("filterCountBadge"));
    needsReplyCountLabel_->setAlignment(Qt::AlignCenter);
    needsReplyCountLabel_->setFixedSize(20, 14);
    needsReplyCountLabel_->move(13, 1);
    needsReplyCountLabel_->setAttribute(Qt::WA_TransparentForMouseEvents);
    needsReplyCountLabel_->hide();
    favoriteFilterButton_ = makeIconButton(sidebar, QStringLiteral("star"),
                                           QStringLiteral("Favorite rooms"));
    favoriteFilterButton_->setCheckable(true);
    refinementRow->addWidget(unansweredFilterButton_);
    refinementRow->addWidget(needsReplyFilterButton_);
    refinementRow->addWidget(favoriteFilterButton_);

    auto *roomSearchRow = new QHBoxLayout;
    roomSearchRow->setContentsMargins(0, 0, 0, 0);
    roomSearchRow->setSpacing(6);
    roomSearchRow->addWidget(roomFilter_, 1);
    roomSearchRow->addWidget(accountScope_);
    sidebarLayout->addLayout(roomSearchRow);
    sidebarLayout->addLayout(navigationRow);
    sidebarLayout->addLayout(refinementRow);

    auto *roomsSection = new QHBoxLayout;
    roomsSection->setContentsMargins(2, 4, 2, 0);
    roomsSection->setSpacing(6);
    roomsSectionLabel_ = new QLabel(QStringLiteral("ROOMS"), sidebar);
    roomsSectionLabel_->setObjectName(QStringLiteral("roomsSectionLabel"));
    roomsCount_ = new QLabel(QStringLiteral("0"), sidebar);
    roomsCount_->setObjectName(QStringLiteral("roomsCount"));
    joinRoomQuickButton_ = makeIconButton(sidebar, QStringLiteral("add"),
                                          QStringLiteral("Join a room"));
    joinRoomQuickButton_->setFixedSize(30, 30);
    archiveAllReadButton_ = makeIconButton(sidebar, QStringLiteral("archive"),
                                           QStringLiteral("Archive all read rooms"));
    archiveAllReadButton_->setFixedSize(30, 30);
    roomsSection->addWidget(roomsSectionLabel_);
    roomsSection->addWidget(roomsCount_);
    roomsSection->addStretch(1);
    roomsSection->addWidget(joinRoomQuickButton_);
    roomsSection->addWidget(archiveAllReadButton_);
    sidebarLayout->addLayout(roomsSection);

    sidebarLayout->addWidget(inviteLabel_);
    sidebarLayout->addWidget(invites_);
    sidebarLayout->addLayout(inviteActions);
    sidebarLayout->addWidget(rooms_, 1);
    sidebarLayout->addWidget(accountSwitcher_);

    auto *profileFooter = new QFrame(sidebar);
    profileFooter->setObjectName(QStringLiteral("profileFooter"));
    auto *profileLayout = new QHBoxLayout(profileFooter);
    profileLayout->setContentsMargins(9, 8, 8, 8);
    profileLayout->setSpacing(10);
    profileAvatar_ = new QLabel(profileFooter);
    profileAvatar_->setObjectName(QStringLiteral("profileAvatar"));
    profileAvatar_->setAlignment(Qt::AlignCenter);
    profileAvatar_->setFixedSize(36, 36);
    auto *profileCopy = new QVBoxLayout;
    profileCopy->setContentsMargins(0, 0, 0, 0);
    profileCopy->setSpacing(1);
    profileName_ = new QLabel(QStringLiteral("Pinger account"), profileFooter);
    profileName_->setObjectName(QStringLiteral("profileName"));
    profileID_ = new QLabel(QString(), profileFooter);
    profileID_->setObjectName(QStringLiteral("profileID"));
    profileCopy->addWidget(profileName_);
    profileCopy->addWidget(profileID_);
    auto *profileSettings = makeIconButton(profileFooter, QStringLiteral("settings"),
                                           QStringLiteral("Settings"));
    profileSettings->setFixedSize(32, 32);
    profileLayout->addWidget(profileAvatar_);
    profileLayout->addLayout(profileCopy, 1);
    profileLayout->addWidget(profileSettings);
    sidebarLayout->addWidget(profileFooter);
    layout->addWidget(sidebar);

    auto *conversation = new QWidget(chatPage_);
    conversation->setObjectName(QStringLiteral("conversation"));
    auto *conversationLayout = new QVBoxLayout(conversation);
    conversationLayout->setContentsMargins(0, 0, 0, 0);
    conversationLayout->setSpacing(0);

    auto *roomHeader = new QFrame(conversation);
    roomHeader->setObjectName(QStringLiteral("conversationHeader"));
    auto *roomHeaderLayout = new QHBoxLayout(roomHeader);
    roomHeaderLayout->setContentsMargins(20, 10, 18, 10);
    roomHeaderLayout->setSpacing(12);
    roomAvatar_ = new QLabel(roomHeader);
    roomAvatar_->setObjectName(QStringLiteral("roomAvatar"));
    roomAvatar_->setAlignment(Qt::AlignCenter);
    roomAvatar_->setFixedSize(40, 40);
    auto *roomCopy = new QVBoxLayout;
    roomCopy->setContentsMargins(0, 0, 0, 0);
    roomCopy->setSpacing(2);
    roomTitle_ = new QLabel(QStringLiteral("Select a room"), roomHeader);
    roomTitle_->setObjectName(QStringLiteral("roomTitle"));
    roomSubtitle_ = new QLabel(QString(), roomHeader);
    roomSubtitle_->setObjectName(QStringLiteral("roomSubtitle"));
    roomCopy->addWidget(roomTitle_);
    roomCopy->addWidget(roomSubtitle_);
    roomHeaderLayout->addWidget(roomAvatar_);
    roomHeaderLayout->addLayout(roomCopy, 1);
    contentBlurIndicator_ = makeIconButton(roomHeader, QStringLiteral("eye-off"),
                                           QStringLiteral("Content blur is on · click to turn off"));
    contentBlurIndicator_->setObjectName(QStringLiteral("contentBlurIndicator"));
    contentBlurIndicator_->setFixedSize(30, 30);
    contentBlurIndicator_->hide();
    roomHeaderLayout->addWidget(contentBlurIndicator_);
    auto *roomSearch = makeIconButton(roomHeader, QStringLiteral("search"),
                                      QStringLiteral("Search messages"));
    auto *roomMedia = makeIconButton(roomHeader, QStringLiteral("images"),
                                     QStringLiteral("Room media"));
    auto *roomInfo = makeIconButton(roomHeader, QStringLiteral("info"),
                                    QStringLiteral("Room details"));
    roomHeaderLayout->addWidget(roomSearch);
    roomHeaderLayout->addWidget(roomMedia);
    roomHeaderLayout->addWidget(roomInfo);

    messages_ = new QListWidget(conversation);
    messages_->setObjectName(QStringLiteral("messagesList"));
    messageDelegate_ = new MessageBubbleDelegate(messages_);
    messageDelegate_->setContentBlur(contentBlurEnabled_);
    messages_->setItemDelegate(messageDelegate_);
    messages_->setSpacing(2);
    messages_->setWordWrap(true);
    messages_->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    messages_->setMouseTracking(true);
    messages_->setContextMenuPolicy(Qt::CustomContextMenu);

    composer_ = new QPlainTextEdit(conversation);
    composer_->setPlaceholderText(QStringLiteral("Message"));
    composer_->setObjectName(QStringLiteral("composerInput"));
    composer_->setMinimumHeight(42);
    composer_->setMaximumHeight(100);
    composer_->installEventFilter(this);
    composerSuggestions_ = new QFrame(chatPage_);
    composerSuggestions_->setObjectName(QStringLiteral("composerSuggestions"));
    composerSuggestions_->setFrameShape(QFrame::StyledPanel);
    composerSuggestions_->setAttribute(Qt::WA_StyledBackground, true);
    auto *suggestionsLayout = new QVBoxLayout(composerSuggestions_);
    suggestionsLayout->setContentsMargins(4, 4, 4, 4);
    suggestionsLayout->setSpacing(0);
    composerSuggestionList_ = new QListWidget(composerSuggestions_);
    composerSuggestionList_->setObjectName(QStringLiteral("composerSuggestionList"));
    composerSuggestionList_->setFrameShape(QFrame::NoFrame);
    composerSuggestionList_->setFocusPolicy(Qt::NoFocus);
    composerSuggestionList_->setSelectionMode(QAbstractItemView::SingleSelection);
    composerSuggestionList_->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    composerSuggestionList_->setVerticalScrollMode(QAbstractItemView::ScrollPerPixel);
    composerSuggestionList_->setUniformItemSizes(true);
    suggestionsLayout->addWidget(composerSuggestionList_);
    installPrivacyBlurDelegate(composerSuggestionList_);
    composerSuggestions_->hide();
    connect(composerSuggestionList_, &QListWidget::itemClicked, this,
            &MainWindow::chooseComposerSuggestion);
    auto *composeContextRow = new QHBoxLayout;
    composeContext_ = new QLabel(conversation);
    composeContext_->setWordWrap(true);
    cancelComposeContextButton_ = new QPushButton(QStringLiteral("Cancel"), conversation);
    composeContextRow->addWidget(composeContext_, 1);
    composeContextRow->addWidget(cancelComposeContextButton_);
    composeContext_->hide();
    cancelComposeContextButton_->hide();
    auto *composerPanel = new QFrame(conversation);
    composerPanel->setObjectName(QStringLiteral("composerPanel"));
    auto *composerPanelLayout = new QVBoxLayout(composerPanel);
    composerPanelLayout->setContentsMargins(12, 8, 12, 9);
    composerPanelLayout->setSpacing(5);
    composerPanelLayout->addWidget(composer_);
    formattingToolbar_ = new QWidget(composerPanel);
    formattingToolbar_->setObjectName(QStringLiteral("formattingToolbar"));
    auto *formattingLayout = new QHBoxLayout(formattingToolbar_);
    formattingLayout->setContentsMargins(0, 0, 0, 0);
    formattingLayout->setSpacing(2);
    const QStringList formatKeys{
        QStringLiteral("bold"), QStringLiteral("italic"), QStringLiteral("strikethrough"),
        QStringLiteral("inlineCode"), QStringLiteral("link"), QStringLiteral("heading"),
        QStringLiteral("bulletList"), QStringLiteral("numberedList"), QStringLiteral("quote"),
        QStringLiteral("codeBlock"),
    };
    const QStringList formatLabels{
        QStringLiteral("Bold"), QStringLiteral("Italic"), QStringLiteral("Strikethrough"),
        QStringLiteral("Inline code"), QStringLiteral("Insert link"), QStringLiteral("Heading"),
        QStringLiteral("Bulleted list"), QStringLiteral("Numbered list"), QStringLiteral("Quote"),
        QStringLiteral("Code block"),
    };
    const QStringList formatIcons{
        QStringLiteral("bold"), QStringLiteral("italic"), QStringLiteral("strikethrough"),
        QStringLiteral("code"), QStringLiteral("link"), QStringLiteral("heading"),
        QStringLiteral("list"), QStringLiteral("list-ordered"), QStringLiteral("quote"),
        QStringLiteral("code-block"),
    };
    for (qsizetype index = 0; index < formatKeys.size(); ++index) {
        auto *button = new QToolButton(formattingToolbar_);
        button->setObjectName(QStringLiteral("composerToolButton"));
        button->setIcon(uiIcon(formatIcons[index]));
        button->setIconSize(QSize(16, 16));
        button->setFixedSize(30, 30);
        button->setToolTip(formatLabels[index]);
        button->setAccessibleName(formatLabels[index]);
        button->setAutoRaise(true);
        button->setFocusPolicy(Qt::NoFocus);
        formattingLayout->addWidget(button);
        connect(button, &QToolButton::clicked, this, [this, format = formatKeys[index]] {
            applyComposerFormatting(format);
        });
    }
    formattingLayout->addStretch(1);
    formattingToolbar_->hide();
    composerPanelLayout->addWidget(formattingToolbar_);
    auto *composerDivider = new QFrame(composerPanel);
    composerDivider->setObjectName(QStringLiteral("composerDivider"));
    composerDivider->setFixedHeight(1);
    composerPanelLayout->addWidget(composerDivider);
    auto *composerBar = new QFrame(composerPanel);
    composerBar->setObjectName(QStringLiteral("composerTools"));
    auto *composerBarLayout = new QHBoxLayout(composerBar);
    composerBarLayout->setContentsMargins(0, 0, 0, 0);
    composerBarLayout->setSpacing(4);
    attachButton_ = new QPushButton(QStringLiteral("Attach"), composerBar);
    recordButton_ = new QPushButton(QStringLiteral("Record"), composerBar);
    attachButton_->setText(QString());
    recordButton_->setText(QString());
    attachButton_->setIcon(uiIcon(QStringLiteral("attach")));
    recordButton_->setIcon(uiIcon(QStringLiteral("mic")));
    attachButton_->setToolTip(QStringLiteral("Attach a file"));
    recordButton_->setToolTip(QStringLiteral("Record a voice or video message"));
    attachButton_->setIconSize(QSize(18, 18));
    recordButton_->setIconSize(QSize(18, 18));
    auto *recordMenu = new QMenu(recordButton_);
    preparePopupMenu(recordMenu);
    recordMenu->addAction(QStringLiteral("Voice note…"), this, [this] { recordMedia(false); });
    recordMenu->addAction(QStringLiteral("Video message…"), this, [this] { recordMedia(true); });
    recordButton_->setMenu(recordMenu);
    scheduleMessageButton_ = new QPushButton(QStringLiteral("Schedule"), composerBar);
    scheduleMessageButton_->setText(QString());
    scheduleMessageButton_->setIcon(uiIcon(QStringLiteral("schedule")));
    scheduleMessageButton_->setIconSize(QSize(18, 18));
    scheduleMessageButton_->setToolTip(QStringLiteral("Schedule message"));
    auto *formatMenuButton = new QToolButton(composerBar);
    formatMenuButton->setObjectName(QStringLiteral("composerToolButton"));
    formatMenuButton->setFixedSize(32, 32);
    formatMenuButton->setIcon(uiIcon(QStringLiteral("bold")));
    formatMenuButton->setIconSize(QSize(18, 18));
    formatMenuButton->setToolTip(QStringLiteral("Format message"));
    formatMenuButton->setPopupMode(QToolButton::InstantPopup);
    auto *formatMenu = new QMenu(formatMenuButton);
    preparePopupMenu(formatMenu);
    for (qsizetype index = 0; index < formatKeys.size(); ++index) {
        QAction *action = formatMenu->addAction(formatLabels[index]);
        connect(action, &QAction::triggered, this, [this, format = formatKeys[index]] {
            applyComposerFormatting(format);
        });
    }
    formatMenuButton->setMenu(formatMenu);
    sendButton_ = new QPushButton(QStringLiteral("Send"), composerBar);
    sendButton_->setText(QString());
    sendButton_->setIcon(uiIcon(QStringLiteral("send")));
    sendButton_->setIconSize(QSize(18, 18));
    sendButton_->setToolTip(QStringLiteral("Send message"));
    for (QPushButton *button : {attachButton_, recordButton_, scheduleMessageButton_}) {
        button->setObjectName(QStringLiteral("composerToolButton"));
        button->setCursor(Qt::PointingHandCursor);
        button->setFixedSize(32, 32);
    }
    sendButton_->setObjectName(QStringLiteral("sendButton"));
    sendButton_->setCursor(Qt::PointingHandCursor);
    sendButton_->setFixedSize(38, 38);
    auto *emojiButton = makeIconButton(composerBar, QStringLiteral("smile"),
                                       QStringLiteral("Insert emoji"));
    auto *emojiMenu = new QMenu(emojiButton);
    preparePopupMenu(emojiMenu);
    const QStringList emojiList = {
        QStringLiteral("😀"), QStringLiteral("😂"), QStringLiteral("😍"),
        QStringLiteral("👍"), QStringLiteral("❤️"), QStringLiteral("🎉"),
        QStringLiteral("🙏"), QStringLiteral("✨"),
    };
    for (const QString &emoji : emojiList) {
        QAction *action = emojiMenu->addAction(emoji);
        connect(action, &QAction::triggered, this, [this, emoji] {
            composer_->insertPlainText(emoji);
            composer_->setFocus();
        });
    }
    emojiButton->setMenu(emojiMenu);
    emojiButton->setPopupMode(QToolButton::InstantPopup);
    auto *aiComposerButton = makeIconButton(composerBar, QStringLiteral("sparkle"),
                                            QStringLiteral("AI tools"));
    composerBarLayout->addWidget(formatMenuButton);
    composerBarLayout->addWidget(attachButton_);
    composerBarLayout->addWidget(emojiButton);
    composerBarLayout->addWidget(aiComposerButton);
    composerBarLayout->addWidget(recordButton_);
    composerBarLayout->addWidget(scheduleMessageButton_);
    composerBarLayout->addStretch(1);
    composerBarLayout->addWidget(sendButton_);
    composerPanelLayout->addWidget(composerBar);

    conversationLayout->addWidget(roomHeader);
    conversationLayout->addWidget(messages_, 1);
    conversationLayout->addLayout(composeContextRow);
    conversationLayout->addWidget(composerPanel);
    layout->addWidget(conversation, 1);
    pages_->addWidget(chatPage_);

    connect(roomFilter_, &QLineEdit::textChanged, this, &MainWindow::updateRoomFilter);
    connect(accountScope_, qOverload<int>(&QComboBox::currentIndexChanged),
            this, [this](int) { filterRooms(); });
    connect(roomScope_, qOverload<int>(&QComboBox::currentIndexChanged),
            this, [this](int) { filterRooms(); });
    connect(allRoomsFilterButton_, &QToolButton::clicked, this, [this] {
        roomScope_->setCurrentIndex(roomScope_->findData(QStringLiteral("all")));
        filterRooms();
    });
    connect(archivedRoomsFilterButton_, &QToolButton::clicked, this, [this] {
        roomScope_->setCurrentIndex(roomScope_->findData(QStringLiteral("archived")));
        filterRooms();
    });
    connect(localAIQuickButton, &QToolButton::clicked, localAIButton_, &QPushButton::click);
    connect(unansweredFilterButton_, &QToolButton::clicked, this, [this] {
        unansweredOnly_ = unansweredFilterButton_->isChecked();
        if (roomScope_->currentData().toString() == QStringLiteral("unanswered")) {
            const QSignalBlocker blocker(roomScope_);
            roomScope_->setCurrentIndex(roomScope_->findData(QStringLiteral("all")));
        }
        filterRooms();
    });
    connect(needsReplyFilterButton_, &QToolButton::clicked, this, [this] {
        needsReplyOnly_ = needsReplyFilterButton_->isChecked();
        if (roomScope_->currentData().toString() == QStringLiteral("needs-reply")) {
            const QSignalBlocker blocker(roomScope_);
            roomScope_->setCurrentIndex(roomScope_->findData(QStringLiteral("all")));
        }
        filterRooms();
    });
    connect(favoriteFilterButton_, &QToolButton::clicked, this, [this] {
        favoritesOnly_ = favoriteFilterButton_->isChecked();
        if (roomScope_->currentData().toString() == QStringLiteral("favorites")) {
            const QSignalBlocker blocker(roomScope_);
            roomScope_->setCurrentIndex(roomScope_->findData(QStringLiteral("all")));
        }
        filterRooms();
    });
    connect(joinRoomQuickButton_, &QToolButton::clicked, joinRoomButton_, &QPushButton::click);
    connect(archiveAllReadButton_, &QToolButton::clicked,
            this, &MainWindow::archiveAllReadRooms);
    connect(profileSettings, &QToolButton::clicked, this, [this] { showSettings(); });
    connect(aiComposerButton, &QToolButton::clicked, this, [this] { showAITools(); });
    connect(roomSearch, &QToolButton::clicked, searchMessagesButton_, &QPushButton::click);
    connect(roomMedia, &QToolButton::clicked, this, [this] {
        if (!currentRoomID_.isEmpty()) {
            showMediaGallery(currentRoomID_);
        }
    });
    connect(roomInfo, &QToolButton::clicked, this, [this] {
        if (!currentRoomID_.isEmpty()) {
            showRoomDetails(currentRoomID_);
        }
    });
    connect(joinRoomButton_, &QPushButton::clicked, this, &MainWindow::joinRoom);
    connect(directChatButton_, &QPushButton::clicked, this, &MainWindow::startDirectChat);
    connect(createGroupButton_, &QPushButton::clicked, this, &MainWindow::createGroupRoom);
    connect(scheduledJobsButton_, &QPushButton::clicked, this, &MainWindow::openScheduledJobs);
    connect(preferencesButton_, &QPushButton::clicked, this, [this] { showSettings(); });
    connect(aiButton_, &QPushButton::clicked, this, [this] { showAITools(); });
    connect(localAIButton_, &QPushButton::clicked, this, &MainWindow::showLocalAIChatDialog);
    connect(exportButton_, &QPushButton::clicked, this, &MainWindow::showExportDialog);
    connect(addAccountButton_, &QPushButton::clicked, this, &MainWindow::addAccount);
    connect(devicesButton_, &QPushButton::clicked, this, &MainWindow::showDevices);
    connect(searchMessagesButton_, &QPushButton::clicked, this, &MainWindow::searchMessages);
    avatarLoadTimer_ = new QTimer(this);
    avatarLoadTimer_->setSingleShot(true);
    avatarLoadTimer_->setInterval(80);
    connect(avatarLoadTimer_, &QTimer::timeout, this, &MainWindow::requestVisibleRoomAvatars);
    connect(rooms_->verticalScrollBar(), &QScrollBar::valueChanged, this,
            [this] { avatarLoadTimer_->start(); });
    connect(accountSwitcher_, qOverload<int>(&QComboBox::currentIndexChanged),
            this, [this](int index) {
                if (index >= 0) {
                    switchAccount(accountSwitcher_->itemData(index).toString());
                }
            });
    connect(invites_, &QListWidget::currentRowChanged, this, [this](int row) {
        const bool selected = row >= 0;
        acceptInviteButton_->setEnabled(selected);
        declineInviteButton_->setEnabled(selected);
    });
    connect(acceptInviteButton_, &QPushButton::clicked, this, [this] {
        auto *item = invites_->currentItem();
        if (!item) {
            return;
        }
        const QString roomID = item->data(Qt::UserRole).toString();
        acceptInviteButton_->setEnabled(false);
        backend_->call(QStringLiteral("AcceptInvite"), {roomID},
                       [this](QJsonValue result, const QString &error) {
                           acceptInviteButton_->setEnabled(true);
                           if (!error.isEmpty()) {
                               showError(error);
                               return;
                           }
                           pendingRoomID_ = result.toString();
                           loadSnapshot();
                       });
    });
    connect(declineInviteButton_, &QPushButton::clicked, this, [this] {
        auto *item = invites_->currentItem();
        if (!item) {
            return;
        }
        const QString roomID = item->data(Qt::UserRole).toString();
        declineInviteButton_->setEnabled(false);
        backend_->call(QStringLiteral("DeclineInvite"), {roomID},
                       [this](QJsonValue, const QString &error) {
                           declineInviteButton_->setEnabled(true);
                           if (!error.isEmpty()) {
                               showError(error);
                               return;
                           }
                           loadSnapshot();
                       });
    });
    connect(rooms_, &QListWidget::customContextMenuRequested,
            this, &MainWindow::showRoomContextMenu);
    connect(messages_, &QListWidget::customContextMenuRequested,
            this, &MainWindow::showMessageContextMenu);
    connect(messages_, &QListWidget::itemDoubleClicked, this,
            [this](QListWidgetItem *item) {
                if (item) {
                    openMediaPreview(item->data(Qt::UserRole).toString());
                }
            });
    connect(cancelComposeContextButton_, &QPushButton::clicked,
            this, &MainWindow::clearComposeContext);
    connect(attachButton_, &QPushButton::clicked, this, &MainWindow::attachFile);
    connect(logoutButton_, &QPushButton::clicked, this, [this] {
        logoutButton_->setEnabled(false);
        backend_->call(QStringLiteral("Logout"), {}, [this](QJsonValue, const QString &error) {
            logoutButton_->setEnabled(true);
            if (!error.isEmpty()) {
                showError(error);
                return;
            }
            loadSnapshot();
        });
    });
    connect(rooms_, &QListWidget::currentItemChanged, this,
            [this](QListWidgetItem *item, QListWidgetItem *) {
                if (item) {
                    const QJsonObject room =
                        QJsonObject::fromVariantMap(item->data(Qt::UserRole + 1).toMap());
                    const QString roomAccountID =
                        room.value(QStringLiteral("accountId")).toString();
                    const QString activeAccountID =
                        snapshot_.value(QStringLiteral("activeAccountId")).toString();
                    if (!roomAccountID.isEmpty() && roomAccountID != activeAccountID) {
                        pendingRoomID_ = item->data(Qt::UserRole).toString();
                        switchAccount(roomAccountID);
                        return;
                    }
                }
                switchRoom(item ? item->data(Qt::UserRole).toString() : QString());
                updateRoomHeader(item
                    ? QJsonObject::fromVariantMap(item->data(Qt::UserRole + 1).toMap())
                    : QJsonObject());
                messages_->clear();
                fadeIn(messages_, 150);
                updateActiveRoom(currentRoomID_);
                if (!currentRoomID_.isEmpty()) {
                    loadHistory(currentRoomID_);
                }
            });
    connect(sendButton_, &QPushButton::clicked, this, &MainWindow::sendMessage);
    connect(scheduleMessageButton_, &QPushButton::clicked, this, &MainWindow::scheduleMessage);
    connect(composer_, &QPlainTextEdit::textChanged, this, [this] {
        const bool ready = !currentRoomID_.isEmpty() && !composer_->toPlainText().trimmed().isEmpty();
        sendButton_->setEnabled(ready);
        scheduleMessageButton_->setEnabled(ready && editEventID_.isEmpty());
        const QString text = composer_->toPlainText();
        for (auto it = composerMentionBindings_.begin(); it != composerMentionBindings_.end();) {
            if (!text.contains(it.key())) {
                it = composerMentionBindings_.erase(it);
            } else {
                ++it;
            }
        }
        refreshComposerSuggestions();
    });
    connect(composer_, &QPlainTextEdit::cursorPositionChanged, this,
            &MainWindow::refreshComposerSuggestions);
    sendButton_->setEnabled(false);
}

void MainWindow::buildVerificationPage() {
    verificationPage_ = new QWidget(this);
    auto *outer = new QVBoxLayout(verificationPage_);
    outer->addStretch();
    auto *panel = new QWidget(verificationPage_);
    panel->setMaximumWidth(420);
    auto *form = new QFormLayout(panel);
    recoveryKey_ = new QLineEdit(panel);
    recoveryKey_->setEchoMode(QLineEdit::Password);
    recoveryKey_->setPlaceholderText(QStringLiteral("Recovery key or security passphrase"));
    form->addRow(QStringLiteral("Verify this device"), recoveryKey_);
    outer->addWidget(panel, 0, Qt::AlignHCenter);
    verifyButton_ = new QPushButton(QStringLiteral("Verify device"), verificationPage_);
    outer->addWidget(verifyButton_, 0, Qt::AlignHCenter);
    auto *error = new QLabel(verificationPage_);
    error->setWordWrap(true);
    error->setAlignment(Qt::AlignCenter);
    outer->addWidget(error, 0, Qt::AlignHCenter);
    outer->addStretch();
    pages_->addWidget(verificationPage_);

    connect(verifyButton_, &QPushButton::clicked, this, [this, error] {
        verifyButton_->setEnabled(false);
        error->clear();
        backend_->call(QStringLiteral("Verify"), {recoveryKey_->text()},
                       [this, error](QJsonValue, const QString &message) {
                           verifyButton_->setEnabled(true);
                           if (!message.isEmpty()) {
                               error->setText(message);
                               return;
                           }
                           recoveryKey_->clear();
                           loadSnapshot();
                       });
    });
}

void MainWindow::loadSnapshot() {
    backend_->call(QStringLiteral("Snapshot"), {}, [this](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            showError(error);
            return;
        }
        if (value.isObject()) {
            applySnapshot(value.toObject());
        }
    });
}

void MainWindow::applySnapshot(const QJsonObject &snapshot) {
    snapshot_ = snapshot;
    preferences_ = snapshot.value(QStringLiteral("preferences")).toObject();
    updateSessionVerification(snapshot.value(QStringLiteral("verification")).toObject());
    updateContentBlur();
    formattingToolbar_->setVisible(
        preferences_.value(QStringLiteral("composer.formatting_toolbar")).toBool());
    refreshComposerSuggestions();
    bool zoomOk = false;
    const int zoom = preferences_.value(QStringLiteral("appearance.zoom"))
                         .toString(QStringLiteral("100")).toInt(&zoomOk);
    QFont applicationFont = QApplication::font();
    applicationFont.setPointSizeF(10.0 * (zoomOk ? qBound(75, zoom, 125) : 100) / 100.0);
    QApplication::setFont(applicationFont);
    updateTrayIcon();
    if (!initialWindowStateApplied_) {
        initialWindowStateApplied_ = true;
        if (preferences_.value(QStringLiteral("window.start_minimized")).toBool()) {
            QTimer::singleShot(0, this, &QWidget::showMinimized);
        }
    }
    if (snapshot.value(QStringLiteral("needsVerification")).toBool()) {
        accountRoomsTimer_->stop();
        otherAccountRooms_ = {};
        if (pages_->currentWidget() != verificationPage_) {
            pages_->setCurrentWidget(verificationPage_);
            fadeIn(verificationPage_);
        }
        updateMenuState();
        return;
    }
    if (!snapshot.value(QStringLiteral("loggedIn")).toBool()) {
        accountRoomsTimer_->stop();
        otherAccountRooms_ = {};
        if (pages_->currentWidget() != loginPage_) {
            pages_->setCurrentWidget(loginPage_);
            fadeIn(loginPage_);
        }
        updateMenuState();
        return;
    }
    if (pages_->currentWidget() != chatPage_) {
        pages_->setCurrentWidget(chatPage_);
        fadeIn(chatPage_);
    }
    const QJsonArray accounts = snapshot.value(QStringLiteral("accounts")).toArray();
    {
        const QSignalBlocker accountBlocker(accountSwitcher_);
        accountSwitcher_->clear();
        for (const auto &value : accounts) {
            const auto account = value.toObject();
            const auto profile = account.value(QStringLiteral("profile")).toObject();
            const QString accountID = account.value(QStringLiteral("id")).toString();
            QString label = profile.value(QStringLiteral("displayName")).toString();
            if (label.isEmpty()) {
                label = profile.value(QStringLiteral("userId")).toString();
            }
            accountSwitcher_->addItem(label, accountID);
            if (accountID == snapshot.value(QStringLiteral("activeAccountId")).toString()) {
                accountSwitcher_->setCurrentIndex(accountSwitcher_->count() - 1);
            }
        }
        accountSwitcher_->setVisible(accounts.size() > 1);
    }
    {
        const QString previousScope = accountScope_->currentData().toString();
        const QSignalBlocker scopeBlocker(accountScope_);
        accountScope_->clear();
        accountScope_->addItem(QStringLiteral("All accounts"), QStringLiteral("all"));
        for (const auto &value : accounts) {
            const auto account = value.toObject();
            const auto accountProfile = account.value(QStringLiteral("profile")).toObject();
            const QString accountID = account.value(QStringLiteral("id")).toString();
            QString label = accountProfile.value(QStringLiteral("displayName")).toString();
            if (label.isEmpty()) {
                label = accountProfile.value(QStringLiteral("userId")).toString();
            }
            accountScope_->addItem(label, accountID);
        }
        int scopeIndex = accountScope_->findData(previousScope);
        if (scopeIndex < 0) {
            scopeIndex = accountScope_->findData(QStringLiteral("all"));
        }
        accountScope_->setCurrentIndex(scopeIndex);
        accountScope_->setVisible(accounts.size() > 1);
    }
    if (accounts.size() > 1) {
        if (!accountRoomsTimer_->isActive()) {
            refreshAccountRooms();
            accountRoomsTimer_->start();
        }
    } else {
        accountRoomsTimer_->stop();
        otherAccountRooms_ = {};
    }
    const auto profile = snapshot.value(QStringLiteral("profile")).toObject();
    const QString profileDisplayName = profile.value(QStringLiteral("displayName")).toString();
    const QString profileUserID = profile.value(QStringLiteral("userId")).toString();
    profileName_->setText(profileDisplayName.isEmpty()
                              ? (profileUserID.isEmpty() ? QStringLiteral("Pinger account")
                                                         : profileUserID)
                              : profileDisplayName);
    profileID_->setText(profileUserID);
    profileID_->setToolTip(profileUserID);
    profileAvatarUri_ = profile.value(QStringLiteral("avatarUri")).toString();
    setAvatarLabel(profileAvatar_, profileAvatarUri_, profileName_->text());
    const auto inviteArray = snapshot.value(QStringLiteral("invites")).toArray();
    const bool hasInvites = !inviteArray.isEmpty();
    inviteLabel_->setVisible(hasInvites);
    invites_->setVisible(hasInvites);
    acceptInviteButton_->setVisible(hasInvites);
    declineInviteButton_->setVisible(hasInvites);
    const QSignalBlocker inviteBlocker(invites_);
    invites_->clear();
    for (const auto &value : inviteArray) {
        const auto invite = value.toObject();
        const QString name = invite.value(QStringLiteral("name")).toString(
            invite.value(QStringLiteral("roomId")).toString());
        auto *item = new QListWidgetItem(name, invites_);
        item->setData(Qt::UserRole, invite.value(QStringLiteral("roomId")).toString());
        item->setToolTip(invite.value(QStringLiteral("topic")).toString());
    }
    acceptInviteButton_->setEnabled(invites_->currentItem() != nullptr);
    declineInviteButton_->setEnabled(invites_->currentItem() != nullptr);
    filterRooms();
}

void MainWindow::refreshAccountRooms() {
    if (accountRoomsRequestInFlight_
        || snapshot_.value(QStringLiteral("accounts")).toArray().size() < 2
        || !snapshot_.value(QStringLiteral("loggedIn")).toBool()) {
        return;
    }
    accountRoomsRequestInFlight_ = true;
    backend_->call(QStringLiteral("AccountRooms"), {},
                   [this](QJsonValue value, const QString &error) {
        accountRoomsRequestInFlight_ = false;
        if (!error.isEmpty()) {
            showError(QStringLiteral("Could not refresh rooms for other accounts: %1").arg(error));
            return;
        }
        otherAccountRooms_ = value.toArray();
        filterRooms();
    });
}

void MainWindow::updateSessionVerification(const QJsonObject &verification) {
    if (verification.isEmpty()) {
        if (sessionVerificationDialog_) {
            sessionVerificationDialog_->accept();
        }
        return;
    }

    if (!sessionVerificationDialog_) {
        auto *dialog = new QDialog(this);
        sessionVerificationDialog_ = dialog;
        dialog->setAttribute(Qt::WA_DeleteOnClose);
        dialog->setModal(true);
        dialog->setWindowTitle(QStringLiteral("Verify another session"));
        dialog->setMinimumWidth(440);
        auto *layout = new QVBoxLayout(dialog);
        auto *title = new QLabel(QStringLiteral("Verify another session"), dialog);
        QFont titleFont = title->font();
        titleFont.setBold(true);
        titleFont.setPointSize(titleFont.pointSize() + 2);
        title->setFont(titleFont);
        sessionVerificationMessage_ = new QLabel(dialog);
        sessionVerificationMessage_->setWordWrap(true);
        sessionVerificationMessage_->setObjectName(QStringLiteral("verificationMessage"));
        sessionVerificationSAS_ = new QLabel(dialog);
        sessionVerificationSAS_->setWordWrap(true);
        sessionVerificationSAS_->setAlignment(Qt::AlignCenter);
        sessionVerificationSAS_->setObjectName(QStringLiteral("verificationSAS"));
        sessionVerificationError_ = new QLabel(dialog);
        sessionVerificationError_->setWordWrap(true);
        sessionVerificationError_->setObjectName(QStringLiteral("verificationError"));
        sessionVerificationActions_ = new QHBoxLayout;
        sessionVerificationActions_->addStretch(1);
        layout->addWidget(title);
        layout->addWidget(sessionVerificationMessage_);
        layout->addWidget(sessionVerificationSAS_);
        layout->addWidget(sessionVerificationError_);
        layout->addLayout(sessionVerificationActions_);
        connect(dialog, &QDialog::rejected, this, [this] {
            if (!sessionVerificationActionInFlight_) {
                runSessionVerificationAction(QStringLiteral("CancelSessionVerification"), {false});
            }
        });
        connect(dialog, &QObject::destroyed, this, [this] {
            sessionVerificationDialog_ = nullptr;
            sessionVerificationMessage_ = nullptr;
            sessionVerificationSAS_ = nullptr;
            sessionVerificationError_ = nullptr;
            sessionVerificationActions_ = nullptr;
            sessionVerificationActionInFlight_ = false;
        });
        dialog->resize(520, 360);
    }

    const QString phase = verification.value(QStringLiteral("phase")).toString();
    const QString userID = verification.value(QStringLiteral("userId")).toString();
    const QString deviceID = verification.value(QStringLiteral("deviceId")).toString();
    QString message;
    if (phase == QStringLiteral("requested")) {
        message = verification.value(QStringLiteral("incoming")).toBool()
            ? QStringLiteral("%1 wants to verify this session.").arg(userID)
            : QStringLiteral("Waiting for %1 to accept this verification request.").arg(userID);
    } else if (phase == QStringLiteral("ready")) {
        message = QStringLiteral("The other session is ready to compare. Confirm that the security codes match on both devices.");
    } else if (phase == QStringLiteral("comparing")) {
        message = QStringLiteral("Compare these security codes with the other device. Confirm only if they match exactly.");
    } else if (phase == QStringLiteral("confirmed")) {
        message = QStringLiteral("The codes matched. Waiting for the other session to finish verification.");
    } else if (phase == QStringLiteral("done")) {
        message = QStringLiteral("Session verification is complete.");
    } else if (phase == QStringLiteral("cancelled")) {
        message = verification.value(QStringLiteral("reason")).toString(
            QStringLiteral("Session verification was cancelled."));
    } else {
        message = QStringLiteral("Session verification is in progress.");
    }
    if (!deviceID.isEmpty()) {
        message += QStringLiteral("\nDevice: %1").arg(deviceID);
    }
    sessionVerificationMessage_->setText(message);
    sessionVerificationError_->clear();

    QStringList sasLines;
    const QJsonArray emojis = verification.value(QStringLiteral("emojis")).toArray();
    for (const auto &entry : emojis) {
        const QJsonObject emoji = entry.toObject();
        const QString symbol = emoji.value(QStringLiteral("emoji")).toString();
        const QString description = emoji.value(QStringLiteral("description")).toString();
        if (!symbol.isEmpty()) {
            sasLines.append(description.isEmpty()
                ? symbol : QStringLiteral("%1  %2").arg(symbol, description));
        }
    }
    if (sasLines.isEmpty()) {
        QStringList numbers;
        for (const auto &entry : verification.value(QStringLiteral("decimals")).toArray()) {
            numbers.append(QStringLiteral("%1").arg(entry.toInt(), 3, 10, QLatin1Char('0')));
        }
        if (!numbers.isEmpty()) {
            sasLines.append(numbers.join(QStringLiteral("    ")));
        }
    }
    sessionVerificationSAS_->setText(sasLines.join(QLatin1Char('\n')));
    QFont sasFont = sessionVerificationSAS_->font();
    sasFont.setPointSize(sasLines.isEmpty() ? QApplication::font().pointSize()
                                            : QApplication::font().pointSize() + 3);
    sessionVerificationSAS_->setFont(sasFont);
    sessionVerificationSAS_->setVisible(!sasLines.isEmpty());

    while (QLayoutItem *item = sessionVerificationActions_->takeAt(0)) {
        if (QWidget *widget = item->widget()) {
            widget->deleteLater();
        }
        delete item;
    }
    const auto addAction = [this](const QString &label, const QString &method,
                                  const QJsonArray &params, bool primary = false) {
        auto *button = new QPushButton(label, sessionVerificationDialog_);
        if (primary) {
            button->setObjectName(QStringLiteral("primaryButton"));
            button->setDefault(true);
        }
        button->setEnabled(!sessionVerificationActionInFlight_);
        sessionVerificationActions_->addWidget(button);
        connect(button, &QPushButton::clicked, this, [this, method, params] {
            runSessionVerificationAction(method, params);
        });
    };
    if (phase == QStringLiteral("requested")
        && verification.value(QStringLiteral("incoming")).toBool()) {
        addAction(QStringLiteral("Decline"), QStringLiteral("CancelSessionVerification"), {false});
        addAction(QStringLiteral("Accept"), QStringLiteral("AcceptSessionVerification"), {}, true);
    } else if (phase == QStringLiteral("comparing")) {
        addAction(QStringLiteral("They do not match"),
                  QStringLiteral("CancelSessionVerification"), {true});
        addAction(QStringLiteral("They match"), QStringLiteral("ConfirmSessionVerification"), {},
                  true);
    } else if (phase == QStringLiteral("done") || phase == QStringLiteral("cancelled")) {
        addAction(QStringLiteral("Close"), QStringLiteral("CancelSessionVerification"), {false},
                  true);
    } else {
        addAction(QStringLiteral("Cancel"), QStringLiteral("CancelSessionVerification"), {false});
    }
    sessionVerificationActions_->addStretch(1);
    if (!sessionVerificationDialog_->isVisible()) {
        sessionVerificationDialog_->show();
        sessionVerificationDialog_->raise();
        sessionVerificationDialog_->activateWindow();
    }
}

void MainWindow::runSessionVerificationAction(const QString &method, const QJsonArray &params) {
    if (sessionVerificationActionInFlight_) {
        return;
    }
    sessionVerificationActionInFlight_ = true;
    if (sessionVerificationError_) {
        sessionVerificationError_->clear();
    }
    if (sessionVerificationActions_) {
        for (QPushButton *button :
             sessionVerificationDialog_->findChildren<QPushButton *>()) {
            button->setEnabled(false);
        }
    }
    backend_->call(method, params, [this](QJsonValue, const QString &error) {
        sessionVerificationActionInFlight_ = false;
        if (!error.isEmpty()) {
            if (sessionVerificationError_) {
                sessionVerificationError_->setText(error);
            } else {
                showError(error);
            }
            if (sessionVerificationDialog_) {
                for (QPushButton *button :
                     sessionVerificationDialog_->findChildren<QPushButton *>()) {
                    button->setEnabled(true);
                }
            }
            return;
        }
        loadSnapshot();
    });
}

void MainWindow::filterRooms() {
    if (snapshot_.isEmpty()) {
        return;
    }
    const QJsonArray activeRooms = snapshot_.value(QStringLiteral("rooms")).toArray();
    const QJsonArray otherRooms = otherAccountRooms_;
    const QString activeAccountID =
        snapshot_.value(QStringLiteral("activeAccountId")).toString();
    const QString accountScope = accountScope_->currentData().toString();
    const bool onlyInactiveAccount =
        accountScope != QStringLiteral("all") && accountScope != activeAccountID;
    QJsonArray roomArray;
    if (accountScope == QStringLiteral("all") || accountScope == activeAccountID) {
        for (const auto &room : activeRooms) {
            roomArray.append(room);
        }
    }
    if (accountScope == QStringLiteral("all") || onlyInactiveAccount) {
        for (const auto &value : otherRooms) {
            const QJsonObject room = value.toObject();
            const QString accountID = room.value(QStringLiteral("accountId")).toString();
            if (accountID == activeAccountID) {
                continue;
            }
            if (accountScope == QStringLiteral("all") || accountID == accountScope) {
                roomArray.append(room);
            }
        }
    }
    const QString scope = roomScope_->currentData().toString();
    const QString query = roomFilter_->text().trimmed();
    const QString selected = currentRoomID_;
    int needsReplyCount = 0;
    int readRoomCount = 0;
    for (const auto &value : activeRooms) {
        const auto room = value.toObject();
        if (!roomIsArchived(room) && room.value(QStringLiteral("unread")).toInt() == 0
            && !room.value(QStringLiteral("markedUnread")).toBool()) {
            ++readRoomCount;
        }
    }
    for (const auto &value : roomArray) {
        const auto room = value.toObject();
        if (roomIsArchived(room)) {
            continue;
        }
        if (room.value(QStringLiteral("needsReply")).toBool()) {
            ++needsReplyCount;
        }
    }
    if (needsReplyCountLabel_) {
        needsReplyCountLabel_->setText(needsReplyCount > 99
            ? QStringLiteral("99+") : QString::number(needsReplyCount));
        needsReplyCountLabel_->setVisible(needsReplyCount > 0);
    }
    if (needsReplyFilterButton_) {
        needsReplyFilterButton_->setToolTip(
            QStringLiteral("Needs reply (%1)").arg(needsReplyCount));
    }
    if (allRoomsFilterButton_) {
        const QSignalBlocker blocker(allRoomsFilterButton_);
        allRoomsFilterButton_->setChecked(scope == QStringLiteral("all"));
    }
    if (archivedRoomsFilterButton_) {
        const QSignalBlocker blocker(archivedRoomsFilterButton_);
        archivedRoomsFilterButton_->setChecked(scope == QStringLiteral("archived"));
    }
    if (unansweredFilterButton_) {
        const QSignalBlocker blocker(unansweredFilterButton_);
        unansweredFilterButton_->setChecked(
            unansweredOnly_ || scope == QStringLiteral("unanswered"));
    }
    if (needsReplyFilterButton_) {
        const QSignalBlocker blocker(needsReplyFilterButton_);
        needsReplyFilterButton_->setChecked(
            needsReplyOnly_ || scope == QStringLiteral("needs-reply"));
    }
    if (favoriteFilterButton_) {
        const QSignalBlocker blocker(favoriteFilterButton_);
        favoriteFilterButton_->setChecked(
            favoritesOnly_ || scope == QStringLiteral("favorites"));
    }
    roomsSectionLabel_->setText(scope == QStringLiteral("archived")
        ? QStringLiteral("ARCHIVED") : QStringLiteral("ROOMS"));
    const bool showAllRoomActions = scope == QStringLiteral("all");
    joinRoomQuickButton_->setVisible(showAllRoomActions);
    archiveAllReadButton_->setVisible(showAllRoomActions);
    archiveAllReadButton_->setEnabled(readRoomCount > 0 && !archivingReadRooms_);
    const QSignalBlocker blocker(rooms_);
    rooms_->clear();
    for (const auto &value : roomArray) {
        const auto room = value.toObject();
        const auto name = room.value(QStringLiteral("name")).toString();
        const auto roomID = room.value(QStringLiteral("id")).toString();
        const auto preview = room.value(QStringLiteral("preview")).toString();
        const int unread = room.value(QStringLiteral("unread")).toInt();
        const bool archived = roomIsArchived(room);
        const bool favorite = room.value(QStringLiteral("favorite")).toBool();
        const bool needsReply = room.value(QStringLiteral("needsReply")).toBool();
        const bool hasUnread = unread > 0 || room.value(QStringLiteral("markedUnread")).toBool();
        const bool hasMentions = room.value(QStringLiteral("mentions")).toInt() > 0;
        const bool pending = roomID == pendingRoomID_;
        if (!query.isEmpty()
            && !name.contains(query, Qt::CaseInsensitive)
            && !roomID.contains(query, Qt::CaseInsensitive)
            && !preview.contains(query, Qt::CaseInsensitive)) {
            continue;
        }
        if (!pending && ((scope == QStringLiteral("archived") && !archived)
            || (scope != QStringLiteral("archived") && archived)
            || (scope == QStringLiteral("unread") && !hasUnread)
            || (scope == QStringLiteral("mentions") && !hasMentions)
            || ((scope == QStringLiteral("unanswered") || unansweredOnly_)
                && !room.value(QStringLiteral("unanswered")).toBool())
            || ((scope == QStringLiteral("needs-reply") || needsReplyOnly_) && !needsReply)
            || ((scope == QStringLiteral("favorites") || favoritesOnly_) && !favorite))) {
            continue;
        }
        auto *item = new QListWidgetItem(unread > 0
                                             ? QStringLiteral("%1  (%2)").arg(name).arg(unread)
                                             : name,
                                         rooms_);
        item->setData(Qt::UserRole, roomID);
        item->setData(Qt::UserRole + 1, room.toVariantMap());
        const QString avatarUri = room.value(QStringLiteral("avatar")).toString();
        if (avatarIcons_.contains(avatarUri)) {
            item->setIcon(avatarIcons_.value(avatarUri));
        }
        item->setToolTip(room.value(QStringLiteral("topic")).toString());
        if (roomID == pendingRoomID_ || roomID == selected) {
            rooms_->setCurrentItem(item);
            if (roomID == pendingRoomID_) {
                pendingRoomID_.clear();
            }
        }
    }
    // A room that leaves the filter stays open, so the conversation does not jump to another chat.
    const bool keepSelectedOpen = !selected.isEmpty() && !roomByID(selected).isEmpty();
    if (rooms_->currentItem() == nullptr && !onlyInactiveAccount && !keepSelectedOpen) {
        for (int index = 0; index < rooms_->count(); ++index) {
            const QJsonObject room =
                QJsonObject::fromVariantMap(rooms_->item(index)->data(Qt::UserRole + 1).toMap());
            if (room.value(QStringLiteral("accountId")).toString() == activeAccountID) {
                rooms_->setCurrentRow(index);
                break;
            }
        }
    }
    roomsCount_->setText(QString::number(rooms_->count()));
    const auto *selectedItem = rooms_->currentItem();
    const QString nextRoomID = selectedItem
        ? selectedItem->data(Qt::UserRole).toString()
        : ((onlyInactiveAccount || keepSelectedOpen) ? selected : QString());
    const bool roomChanged = nextRoomID != selected;
    if (roomChanged) {
        switchRoom(nextRoomID);
    }
    updateRoomHeader(selectedItem
        ? QJsonObject::fromVariantMap(selectedItem->data(Qt::UserRole + 1).toMap())
        : ((onlyInactiveAccount || keepSelectedOpen) ? roomByID(selected) : QJsonObject()));
    if (roomChanged) {
        messages_->clear();
        if (!currentRoomID_.isEmpty()) {
            loadHistory(currentRoomID_);
        }
    }
    updateActiveRoom(currentRoomID_);
    updateMenuState();
    avatarLoadTimer_->start(0);
}

void MainWindow::archiveAllReadRooms() {
    if (archivingReadRooms_) {
        return;
    }

    archiveReadRoomQueue_.clear();
    for (const auto &value : snapshot_.value(QStringLiteral("rooms")).toArray()) {
        const auto room = value.toObject();
        if (roomIsArchived(room)
            || room.value(QStringLiteral("unread")).toInt() > 0
            || room.value(QStringLiteral("markedUnread")).toBool()) {
            continue;
        }
        archiveReadRoomQueue_.append(archivePreferenceKey(room));
    }
    if (archiveReadRoomQueue_.isEmpty()) {
        return;
    }

    archivingReadRooms_ = true;
    archiveReadRoomTotal_ = archiveReadRoomQueue_.size();
    filterRooms();
    statusBar()->showMessage(
        QStringLiteral("Archiving %1 read rooms…").arg(archiveReadRoomTotal_));
    archiveNextReadRoom();
}

void MainWindow::archiveNextReadRoom() {
    if (archiveReadRoomQueue_.isEmpty()) {
        archivingReadRooms_ = false;
        statusBar()->showMessage(
            QStringLiteral("Archived %1 read rooms").arg(archiveReadRoomTotal_), 5000);
        loadSnapshot();
        return;
    }

    const QString key = archiveReadRoomQueue_.takeFirst();
    backend_->call(QStringLiteral("SetBooleanPreference"), {key, true},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           archiveReadRoomQueue_.clear();
                           archivingReadRooms_ = false;
                           showError(error);
                           loadSnapshot();
                           return;
                       }
                       archiveNextReadRoom();
                   });
}

void MainWindow::updateRoomHeader(const QJsonObject &room) {
    const bool hasRoom = !room.isEmpty();
    const QString name = room.value(QStringLiteral("name")).toString(
        hasRoom ? currentRoomID_ : QStringLiteral("Select a room"));
    roomTitle_->setText(name);
    activeRoomAvatarUri_ = room.value(QStringLiteral("avatar")).toString();
    roomAvatar_->setVisible(hasRoom);
    setAvatarLabel(roomAvatar_, activeRoomAvatarUri_, name);

    QString subtitle = room.value(QStringLiteral("topic")).toString().trimmed();
    if (room.value(QStringLiteral("direct")).toBool()) {
        subtitle = QStringLiteral("Direct message");
    }
    roomSubtitle_->setText(QFontMetrics(roomSubtitle_->font())
                               .elidedText(subtitle, Qt::ElideRight, 360));
    roomSubtitle_->setVisible(!subtitle.isEmpty());
    messageDelegate_->setShowSenderNames(!room.value(QStringLiteral("direct")).toBool());
    messages_->doItemsLayout();
    messages_->viewport()->update();
}

void MainWindow::updateContentBlur() {
    const bool enabled = preferences_.value(QStringLiteral("privacy.incognito")).toBool();
    if (enabled == contentBlurEnabled_) {
        return;
    }
    contentBlurEnabled_ = enabled;
    if (roomDelegate_) {
        roomDelegate_->setContentBlur(enabled);
    }
    if (messageDelegate_) {
        messageDelegate_->setContentBlur(enabled);
    }
    for (PrivacyBlurDelegate *delegate : privacyBlurDelegates_) {
        if (delegate) {
            delegate->setContentBlur(enabled);
        }
    }
    if (contentBlurIndicator_) {
        contentBlurIndicator_->setVisible(enabled);
    }

    const QList<QWidget *> widgets = {
        roomTitle_, roomSubtitle_, roomAvatar_, profileAvatar_, profileName_, profileID_,
        accountSwitcher_
    };
    for (QWidget *widget : widgets) {
        if (!widget) {
            continue;
        }
        if (enabled) {
            auto *effect = qobject_cast<QGraphicsBlurEffect *>(widget->graphicsEffect());
            if (!effect) {
                effect = new QGraphicsBlurEffect;
                effect->setBlurRadius(8);
                widget->setGraphicsEffect(effect);
            }
            widget->setAttribute(Qt::WA_Hover, true);
            widget->setMouseTracking(true);
            widget->installEventFilter(this);
            contentBlurWidgets_.insert(widget);
            effect->setEnabled(!widget->underMouse() && !widget->hasFocus());
        } else {
            widget->removeEventFilter(this);
            widget->setGraphicsEffect(nullptr);
            contentBlurWidgets_.remove(widget);
        }
    }
    if (rooms_) {
        rooms_->viewport()->update();
    }
    if (messages_) {
        messages_->viewport()->update();
    }
}

void MainWindow::installPrivacyBlurDelegate(QListWidget *list) {
    if (!list) {
        return;
    }
    auto *delegate = new PrivacyBlurDelegate(list);
    delegate->setContentBlur(contentBlurEnabled_);
    list->setItemDelegate(delegate);
    list->setMouseTracking(true);
    list->viewport()->setMouseTracking(true);
    privacyBlurDelegates_.insert(delegate);
    connect(delegate, &QObject::destroyed, this, [this, delegate] {
        privacyBlurDelegates_.remove(delegate);
    });
}

void MainWindow::setAvatarLabel(QLabel *label, const QString &uri, const QString &name) {
    if (!label) {
        return;
    }
    label->setPixmap(QPixmap());
    label->setText(avatarInitials(name));
    if (!uri.isEmpty() && avatarIcons_.contains(uri)) {
        label->setText(QString());
        label->setPixmap(avatarIcons_.value(uri).pixmap(label->size(), label->devicePixelRatioF()));
        return;
    }
    if (!uri.isEmpty()) {
        requestAvatar(uri);
    }
}

void MainWindow::requestAvatar(const QString &uri) {
    if (uri.isEmpty() || avatarIcons_.contains(uri) || avatarFailures_.contains(uri)
        || avatarRequests_.contains(uri)) {
        return;
    }
    const QString url = media_->mxcUrl(uri);
    if (url.isEmpty()) {
        return;
    }
    avatarRequests_.insert(uri);
    QPointer<MainWindow> guardedWindow(this);
    media_->fetch(url, [guardedWindow, uri](bool ok, const QByteArray &data,
                                           const QString &) {
        if (!guardedWindow) {
            return;
        }
        guardedWindow->avatarRequests_.remove(uri);
        if (!ok) {
            guardedWindow->avatarFailures_.insert(uri);
            return;
        }
        QPixmap original = QPixmap::fromImage(QImage::fromData(data));
        if (original.isNull()) {
            guardedWindow->avatarFailures_.insert(uri);
            return;
        }
        const QIcon icon = qtutil::roundedAvatarIcon(original, 64);
        guardedWindow->avatarIcons_.insert(uri, icon);
        for (int index = 0; index < guardedWindow->rooms_->count(); ++index) {
            auto *item = guardedWindow->rooms_->item(index);
            const auto room = QJsonObject::fromVariantMap(item->data(Qt::UserRole + 1).toMap());
            if (room.value(QStringLiteral("avatar")).toString() == uri) {
                item->setIcon(icon);
            }
        }
        for (int index = 0; index < guardedWindow->messages_->count(); ++index) {
            auto *item = guardedWindow->messages_->item(index);
            const auto message = QJsonObject::fromVariantMap(item->data(Qt::UserRole + 1).toMap());
            if (message.value(QStringLiteral("avatar")).toString() == uri) {
                item->setData(Qt::UserRole + 2, icon);
            }
        }
        if (guardedWindow->activeRoomAvatarUri_ == uri) {
            guardedWindow->setAvatarLabel(guardedWindow->roomAvatar_, uri,
                                          guardedWindow->roomTitle_->text());
        }
        if (guardedWindow->profileAvatarUri_ == uri) {
            guardedWindow->setAvatarLabel(guardedWindow->profileAvatar_, uri,
                                          guardedWindow->profileName_->text());
        }
        guardedWindow->rooms_->viewport()->update();
        guardedWindow->messages_->viewport()->update();
    });
}

void MainWindow::requestVisibleRoomAvatars() {
    if (!rooms_ || rooms_->count() == 0) {
        return;
    }
    const int first = rooms_->indexAt(QPoint(4, 4)).row();
    if (first < 0) {
        return;
    }
    int last = rooms_->indexAt(QPoint(4, qMax(4, rooms_->viewport()->height() - 4))).row();
    if (last < first) {
        last = qMin(rooms_->count() - 1, first + 12);
    }
    for (int index = first; index <= last; ++index) {
        const auto room = QJsonObject::fromVariantMap(
            rooms_->item(index)->data(Qt::UserRole + 1).toMap());
        requestAvatar(room.value(QStringLiteral("avatar")).toString());
    }
}

void MainWindow::switchRoom(const QString &roomID) {
    if (currentRoomID_ == roomID) {
        return;
    }
    const QString accountID = snapshot_.value(QStringLiteral("activeAccountId")).toString();
    if (!currentRoomID_.isEmpty()) {
        roomDrafts_.insert(roomDraftKey(accountID, currentRoomID_), composer_->toPlainText());
    }
    clearComposeContext();
    ++composerMembersRequestID_;
    composerMembers_ = {};
    composerMentionBindings_.clear();
    hideComposerSuggestions();
    currentRoomID_ = roomID;
    composer_->setPlainText(roomDrafts_.take(roomDraftKey(accountID, roomID)));
    sendButton_->setEnabled(!roomID.isEmpty() && !composer_->toPlainText().trimmed().isEmpty());
    if (!roomID.isEmpty()) {
        loadComposerMembers(roomID);
    }
    updateMenuState();
}

void MainWindow::updateActiveRoom(const QString &roomID) {
    if (activeRoomSubscription_ == roomID) {
        return;
    }
    activeRoomSubscription_ = roomID;
    backend_->call(QStringLiteral("SetActiveRoom"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::loadHistory(const QString &roomID, qint64 before) {
    const quint64 requestID = ++historyRequestID_;
    historyBefore_ = before;
    backend_->call(QStringLiteral("History"), {roomID, before},
                   [this, roomID, before, requestID](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            if (requestID == historyRequestID_) {
                showError(error);
            }
            return;
        }
        if (requestID != historyRequestID_ || roomID != currentRoomID_ || !value.isObject()) {
            return;
        }
        messages_->clear();
        messagesByID_.clear();
        const auto messageArray = value.toObject().value(QStringLiteral("messages")).toArray();
        QSet<QString> loadedEventIDs;
        QHash<QString, int> threadReplyCounts;
        QHash<QString, QJsonObject> latestThreadReplies;
        for (const auto &entry : messageArray) {
            const auto message = entry.toObject();
            const auto eventID = message.value(QStringLiteral("id")).toString();
            if (!eventID.isEmpty()) {
                loadedEventIDs.insert(eventID);
            }
            const auto rootID = message.value(QStringLiteral("threadRootId")).toString();
            if (!rootID.isEmpty()) {
                threadReplyCounts[rootID] += 1;
                latestThreadReplies.insert(rootID, message);
            }
        }
        for (const auto &entry : messageArray) {
            const auto message = entry.toObject();
            const auto eventID = message.value(QStringLiteral("id")).toString();
            const auto rootID = message.value(QStringLiteral("threadRootId")).toString();
            if (!rootID.isEmpty() && loadedEventIDs.contains(rootID)) {
                continue;
            }
            const auto sender = message.value(QStringLiteral("senderName")).toString(
                message.value(QStringLiteral("sender")).toString());
            const auto body = message.value(QStringLiteral("body")).toString();
            const auto timestamp = QDateTime::fromMSecsSinceEpoch(
                static_cast<qint64>(message.value(QStringLiteral("timestamp")).toDouble()));
            QString display = QStringLiteral("%1  %2\n%3")
                                  .arg(timestamp.toLocalTime().toString(QStringLiteral("HH:mm")),
                                       sender, body);
            const auto reactions = message.value(QStringLiteral("reactions")).toObject();
            if (!reactions.isEmpty()) {
                QStringList reactionLabels;
                for (auto it = reactions.constBegin(); it != reactions.constEnd(); ++it) {
                    reactionLabels.append(QStringLiteral("%1 %2").arg(it.key()).arg(it.value().toInt()));
                }
                display += QStringLiteral("\n") + reactionLabels.join(QStringLiteral("  "));
            }
            const int replyCount = threadReplyCounts.value(eventID);
            if (replyCount > 0) {
                const auto latest = latestThreadReplies.value(eventID);
                const QString latestSender = latest.value(QStringLiteral("senderName")).toString(
                    latest.value(QStringLiteral("sender")).toString());
                display += QStringLiteral("\n\n%1 thread replies · latest: %2: %3")
                               .arg(replyCount)
                               .arg(latestSender, latest.value(QStringLiteral("body")).toString());
            }
            auto *item = new QListWidgetItem(display, messages_);
            item->setData(Qt::UserRole, eventID);
            item->setData(Qt::UserRole + 1, message.toVariantMap());
            messagesByID_.insert(eventID, message);
            requestAvatar(message.value(QStringLiteral("avatar")).toString());
            const QString mime = message.value(QStringLiteral("mediaMime")).toString();
            if (!eventID.isEmpty() && mime.startsWith(QStringLiteral("image/"))
                && message.value(QStringLiteral("decryptionError")).toString().isEmpty()
                && !message.value(QStringLiteral("redacted")).toBool()) {
                const QString url = media_->mediaUrl(QStringLiteral("matrix"), roomID, eventID);
                QPointer<QListWidget> guardedMessages(messages_);
                media_->fetch(url, [guardedMessages, eventID](bool ok, const QByteArray &data,
                                                               const QString &) {
                    if (!ok || !guardedMessages) {
                        return;
                    }
                    const QPixmap preview = QPixmap::fromImage(QImage::fromData(data));
                    if (preview.isNull()) {
                        return;
                    }
                    for (int index = 0; index < guardedMessages->count(); ++index) {
                        auto *current = guardedMessages->item(index);
                        if (current->data(Qt::UserRole).toString() == eventID) {
                            QScrollBar *scrollBar = guardedMessages->verticalScrollBar();
                            const bool wasAtBottom = scrollBar->value() >= scrollBar->maximum() - 2;
                            QPixmap thumbnail = preview.scaled(480, 264, Qt::KeepAspectRatio,
                                                               Qt::SmoothTransformation);
                            thumbnail.setDevicePixelRatio(3.0);
                            current->setIcon(QIcon(thumbnail));
                            guardedMessages->doItemsLayout();
                            if (wasAtBottom) {
                                scrollBar->setValue(scrollBar->maximum());
                            }
                            break;
                        }
                    }
                });
            }
        }
        smoothScrollToBottom(messages_, 0);
        const auto room = roomByID(roomID);
        const auto eventID = room.value(QStringLiteral("lastEventId")).toString();
        const bool unread = room.value(QStringLiteral("unread")).toInt() > 0
                            || room.value(QStringLiteral("markedUnread")).toBool();
        if (before == 0 && unread && !eventID.isEmpty() && readRequests_.value(roomID) != eventID) {
            readRequests_.insert(roomID, eventID);
            backend_->call(QStringLiteral("MarkRead"), {roomID, eventID},
                           [this, roomID, eventID](QJsonValue, const QString &error) {
                               if (!error.isEmpty()) {
                                   if (readRequests_.value(roomID) == eventID) {
                                       readRequests_.remove(roomID);
                                   }
                                   showError(error);
                               }
                           });
        }
    });
}

void MainWindow::sendMessage() {
    const QString text = composer_->toPlainText().trimmed();
    if (currentRoomID_.isEmpty() || text.isEmpty()) {
        return;
    }
    sendButton_->setEnabled(false);
    QString method = editEventID_.isEmpty()
                         ? (replyToEventID_.isEmpty() ? QStringLiteral("SendMessage")
                                                      : QStringLiteral("SendReply"))
                         : QStringLiteral("EditMessage");
    QJsonArray params{currentRoomID_, text};
    if (!editEventID_.isEmpty()) {
        params.append(editEventID_);
    } else if (!replyToEventID_.isEmpty()) {
        params.append(replyToEventID_);
    } else {
        QJsonArray mentionIDs;
        QSet<QString> seenMentionIDs;
        for (auto it = composerMentionBindings_.cbegin(); it != composerMentionBindings_.cend(); ++it) {
            if (text.contains(it.key()) && !seenMentionIDs.contains(it.value())) {
                mentionIDs.append(it.value());
                seenMentionIDs.insert(it.value());
            }
        }
        if (!mentionIDs.isEmpty()) {
            method = QStringLiteral("SendMessageWithMentions");
            params.append(mentionIDs);
        }
    }
    backend_->call(method, params,
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       } else {
                           composer_->clear();
                           composerMentionBindings_.clear();
                           clearComposeContext();
                           loadHistory(currentRoomID_);
                           composer_->setFocus();
                       }
                       sendButton_->setEnabled(!currentRoomID_.isEmpty() &&
                                               !composer_->toPlainText().trimmed().isEmpty());
                   });
}

void MainWindow::loadComposerMembers(const QString &roomID) {
    const quint64 requestID = ++composerMembersRequestID_;
    backend_->call(QStringLiteral("RoomMembers"), {roomID},
                   [this, roomID, requestID](QJsonValue value, const QString &error) {
                       if (requestID != composerMembersRequestID_ || roomID != currentRoomID_) {
                           return;
                       }
                       if (!error.isEmpty()) {
                           showError(QStringLiteral("Could not load room members: %1").arg(error));
                           return;
                       }
                       composerMembers_ = value.toArray();
                       refreshComposerSuggestions();
                   });
}

void MainWindow::hideComposerSuggestions() {
    if (composerSuggestions_) {
        composerSuggestions_->hide();
    }
    if (composerSuggestionList_) {
        composerSuggestionList_->clear();
    }
    composerSuggestionKind_.clear();
    composerSuggestionStart_ = -1;
    composerSuggestionEnd_ = -1;
}

void MainWindow::refreshComposerSuggestions() {
    if (!composer_ || !composerSuggestions_ || !composerSuggestionList_
        || currentRoomID_.isEmpty()) {
        hideComposerSuggestions();
        return;
    }

    const QString text = composer_->toPlainText();
    const int cursor = composer_->textCursor().position();
    if (cursor < 0 || cursor > text.size()) {
        hideComposerSuggestions();
        return;
    }
    const QString beforeCursor = text.left(cursor);
    composerSuggestionList_->clear();
    composerSuggestionKind_.clear();
    composerSuggestionStart_ = -1;
    composerSuggestionEnd_ = -1;

    static const QRegularExpression mentionPattern(QStringLiteral("(^|\\s)@([^\\s@]*)$"));
    const auto mentionMatch = mentionPattern.match(beforeCursor);
    if (mentionMatch.hasMatch()) {
        const QString query = mentionMatch.captured(2);
        const QString normalizedQuery = query.toCaseFolded();
        composerSuggestionKind_ = QStringLiteral("mention");
        composerSuggestionStart_ = cursor - mentionMatch.capturedLength()
                                   + mentionMatch.captured(1).size();
        composerSuggestionEnd_ = cursor;
        for (const QJsonValue &value : composerMembers_) {
            const QJsonObject member = value.toObject();
            const QString userID = member.value(QStringLiteral("id")).toString();
            const QString displayName = member.value(QStringLiteral("displayName")).toString();
            const QString label = displayName.isEmpty() ? userID : displayName;
            if (userID.isEmpty()
                || (!label.toCaseFolded().contains(normalizedQuery)
                    && !userID.toCaseFolded().contains(normalizedQuery))) {
                continue;
            }
            auto *item = new QListWidgetItem(
                displayName.isEmpty() ? userID : QStringLiteral("%1   %2").arg(displayName, userID),
                composerSuggestionList_);
            item->setData(Qt::UserRole, QStringLiteral("mention"));
            item->setData(Qt::UserRole + 1, userID);
            item->setData(Qt::UserRole + 2, displayName);
            item->setToolTip(userID);
            item->setSizeHint(QSize(0, 34));
            if (composerSuggestionList_->count() == 8) {
                break;
            }
        }
    } else {
        static const QRegularExpression emojiPattern(QStringLiteral("(^|\\s):([a-z0-9_]{2,})$"),
                                                      QRegularExpression::CaseInsensitiveOption);
        const auto emojiMatch = emojiPattern.match(beforeCursor);
        const bool emojiAutocomplete = preferences_.value(QStringLiteral("emoji.autocomplete")).toBool();
        if (emojiMatch.hasMatch() && emojiAutocomplete) {
            static const QList<QPair<QString, QString>> emojiShortcodes = {
                {QStringLiteral("smile"), QStringLiteral("😄")},
                {QStringLiteral("grinning"), QStringLiteral("😀")},
                {QStringLiteral("joy"), QStringLiteral("😂")},
                {QStringLiteral("sweat_smile"), QStringLiteral("😅")},
                {QStringLiteral("laughing"), QStringLiteral("😆")},
                {QStringLiteral("wink"), QStringLiteral("😉")},
                {QStringLiteral("sunglasses"), QStringLiteral("😎")},
                {QStringLiteral("thinking"), QStringLiteral("🤔")},
                {QStringLiteral("pensive"), QStringLiteral("😔")},
                {QStringLiteral("sob"), QStringLiteral("😭")},
                {QStringLiteral("heart"), QStringLiteral("❤️")},
                {QStringLiteral("thumbsup"), QStringLiteral("👍")},
                {QStringLiteral("thumbsdown"), QStringLiteral("👎")},
                {QStringLiteral("clap"), QStringLiteral("👏")},
                {QStringLiteral("raised_hands"), QStringLiteral("🙌")},
                {QStringLiteral("ok_hand"), QStringLiteral("👌")},
                {QStringLiteral("wave"), QStringLiteral("👋")},
                {QStringLiteral("pray"), QStringLiteral("🙏")},
                {QStringLiteral("eyes"), QStringLiteral("👀")},
                {QStringLiteral("fire"), QStringLiteral("🔥")},
                {QStringLiteral("tada"), QStringLiteral("🎉")},
                {QStringLiteral("rocket"), QStringLiteral("🚀")},
                {QStringLiteral("star"), QStringLiteral("⭐")},
                {QStringLiteral("100"), QStringLiteral("💯")},
                {QStringLiteral("white_check_mark"), QStringLiteral("✅")},
                {QStringLiteral("x"), QStringLiteral("❌")},
                {QStringLiteral("warning"), QStringLiteral("⚠️")},
                {QStringLiteral("coffee"), QStringLiteral("☕")},
            };
            const QString query = emojiMatch.captured(2).toLower();
            composerSuggestionKind_ = QStringLiteral("emoji");
            composerSuggestionStart_ = cursor - emojiMatch.capturedLength()
                                       + emojiMatch.captured(1).size();
            composerSuggestionEnd_ = cursor;
            for (const auto &entry : emojiShortcodes) {
                if (!entry.first.startsWith(query)) {
                    continue;
                }
                auto *item = new QListWidgetItem(
                    QStringLiteral("%1   :%2:").arg(entry.second, entry.first),
                    composerSuggestionList_);
                item->setData(Qt::UserRole, QStringLiteral("emoji"));
                item->setData(Qt::UserRole + 1, entry.second);
                item->setSizeHint(QSize(0, 34));
                if (composerSuggestionList_->count() == 6) {
                    break;
                }
            }
        }
    }

    if (composerSuggestionList_->count() == 0) {
        hideComposerSuggestions();
        return;
    }
    composerSuggestionList_->setCurrentRow(0);
    const int width = qMin(420, composer_->width());
    const int height = qMin(220, composerSuggestionList_->count() * 34 + 8);
    const QPoint composerPosition = composer_->mapTo(chatPage_, QPoint(0, 0));
    int y = composerPosition.y() - height - 6;
    if (y < 0) {
        y = composerPosition.y() + composer_->height() + 6;
    }
    y = qMin(y, qMax(0, chatPage_->height() - height));
    composerSuggestions_->setGeometry(composerPosition.x(), y, width, height);
    composerSuggestions_->show();
    composerSuggestions_->raise();
}

void MainWindow::chooseComposerSuggestion(QListWidgetItem *item) {
    if (!item || composerSuggestionStart_ < 0 || composerSuggestionEnd_ < composerSuggestionStart_) {
        hideComposerSuggestions();
        return;
    }
    const QString kind = composerSuggestionKind_;
    const int start = composerSuggestionStart_;
    const int end = composerSuggestionEnd_;
    const QString currentText = composer_->toPlainText();
    if (end > currentText.size()) {
        hideComposerSuggestions();
        return;
    }

    QString insertion;
    if (kind == QStringLiteral("mention")) {
        const QString userID = item->data(Qt::UserRole + 1).toString();
        const QString displayName = item->data(Qt::UserRole + 2).toString();
        const QString token = QStringLiteral("@%1").arg(displayName.isEmpty() ? userID : displayName);
        composerMentionBindings_.insert(token, userID);
        const QString suffix = currentText.mid(end);
        insertion = token + (suffix.startsWith(QLatin1Char(' ')) ? QString() : QStringLiteral(" "));
    } else if (kind == QStringLiteral("emoji")) {
        insertion = item->data(Qt::UserRole + 1).toString();
        const QString suffix = currentText.mid(end);
        if (!suffix.startsWith(QLatin1Char(' ')) && !suffix.isEmpty()) {
            insertion += QLatin1Char(' ');
        }
    } else {
        hideComposerSuggestions();
        return;
    }

    hideComposerSuggestions();
    QTextCursor cursor = composer_->textCursor();
    cursor.setPosition(start);
    cursor.setPosition(end, QTextCursor::KeepAnchor);
    cursor.insertText(insertion);
    composer_->setTextCursor(cursor);
    composer_->setFocus();
}

void MainWindow::applyComposerFormatting(const QString &format) {
    if (!composer_) {
        return;
    }
    const QString value = composer_->toPlainText();
    const QTextCursor current = composer_->textCursor();
    const int start = current.selectionStart();
    const int end = current.selectionEnd();
    const QString selected = value.mid(start, end - start);
    int replaceStart = start;
    int replaceEnd = end;
    int selectionStart = start;
    int selectionEnd = end;
    QString replacement;

    QString marker;
    if (format == QStringLiteral("bold")) {
        marker = QStringLiteral("**");
    } else if (format == QStringLiteral("italic")) {
        marker = QStringLiteral("_");
    } else if (format == QStringLiteral("strikethrough")) {
        marker = QStringLiteral("~~");
    } else if (format == QStringLiteral("inlineCode") && !selected.contains(QLatin1Char('\n'))) {
        marker = QStringLiteral("`");
    }
    if (!marker.isEmpty()) {
        replacement = marker + selected + marker;
        selectionStart = start + marker.size();
        selectionEnd = end + marker.size();
    } else if (format == QStringLiteral("link")) {
        const QString label = selected.isEmpty() ? QStringLiteral("link text") : selected;
        replacement = QStringLiteral("[%1](url)").arg(label);
        selectionStart = start + 1;
        selectionEnd = selectionStart + label.size();
    } else {
        const int previousBreak = start == 0
            ? -1 : value.lastIndexOf(QLatin1Char('\n'), start - 1);
        const int lineStart = previousBreak + 1;
        const int contentEnd = end > start && value.at(end - 1) == QLatin1Char('\n')
            ? end - 1 : end;
        const int nextBreak = value.indexOf(QLatin1Char('\n'), contentEnd);
        const int lineEnd = nextBreak < 0 ? value.size() : nextBreak;
        const QString lines = value.mid(lineStart, lineEnd - lineStart);
        replaceStart = lineStart;
        replaceEnd = lineEnd;

        if (format == QStringLiteral("codeBlock")
            || (format == QStringLiteral("inlineCode") && selected.contains(QLatin1Char('\n')))) {
            replacement = QStringLiteral("```\n%1\n```").arg(lines);
            selectionStart = lineStart + 4;
            selectionEnd = selectionStart + lines.size();
        } else {
            QStringList formattedLines;
            const QStringList inputLines = lines.split(QLatin1Char('\n'));
            for (qsizetype index = 0; index < inputLines.size(); ++index) {
                QString prefix;
                if (format == QStringLiteral("heading")) {
                   prefix = index == 0 ? QStringLiteral("## ") : QString();
                } else if (format == QStringLiteral("bulletList")) {
                   prefix = QStringLiteral("- ");
                } else if (format == QStringLiteral("numberedList")) {
                   prefix = QStringLiteral("%1. ").arg(index + 1);
                } else if (format == QStringLiteral("quote")) {
                   prefix = QStringLiteral("> ");
                } else {
                   return;
                }
                formattedLines.append(prefix + inputLines[index]);
            }
            replacement = formattedLines.join(QLatin1Char('\n'));
            selectionStart = lineStart;
            selectionEnd = lineStart + replacement.size();
        }
    }

    QTextCursor target = composer_->textCursor();
    target.setPosition(replaceStart);
    target.setPosition(replaceEnd, QTextCursor::KeepAnchor);
    target.insertText(replacement);
    target.setPosition(selectionStart);
    target.setPosition(selectionEnd, QTextCursor::KeepAnchor);
    composer_->setTextCursor(target);
    composer_->setFocus();
}

void MainWindow::attachFile() {
    if (currentRoomID_.isEmpty()) {
        return;
    }
    attachPath(QFileDialog::getOpenFileName(this, QStringLiteral("Attach file")));
}

bool MainWindow::canAcceptFileDrop(const QMimeData *mime) const {
    if (!mime || !mime->hasUrls() || currentRoomID_.isEmpty() || pages_->currentWidget() != chatPage_) {
        return false;
    }
    for (const QUrl &url : mime->urls()) {
        if (url.isLocalFile()) {
            return true;
        }
    }
    return false;
}

void MainWindow::dragEnterEvent(QDragEnterEvent *event) {
    if (canAcceptFileDrop(event->mimeData())) {
        event->acceptProposedAction();
        return;
    }
    QMainWindow::dragEnterEvent(event);
}

void MainWindow::dropEvent(QDropEvent *event) {
    if (!canAcceptFileDrop(event->mimeData())) {
        QMainWindow::dropEvent(event);
        return;
    }
    const QList<QUrl> urls = event->mimeData()->urls();
    for (const QUrl &url : urls) {
        if (url.isLocalFile()) {
            attachPath(url.toLocalFile());
            break;
        }
    }
    event->acceptProposedAction();
}

bool MainWindow::eventFilter(QObject *watched, QEvent *event) {
    if (event->type() == QEvent::KeyPress) {
        auto *widget = qobject_cast<QWidget *>(watched);
        if (widget && widget->window() == this) {
            auto *keyEvent = static_cast<QKeyEvent *>(event);
            if (watched == composer_ && composerSuggestionList_
                && composerSuggestionList_->isVisible()) {
                const int count = composerSuggestionList_->count();
                if (count > 0 && (keyEvent->key() == Qt::Key_Up
                                  || keyEvent->key() == Qt::Key_Down)) {
                    const int current = composerSuggestionList_->currentRow();
                    const int delta = keyEvent->key() == Qt::Key_Down ? 1 : -1;
                    composerSuggestionList_->setCurrentRow((current + delta + count) % count);
                    keyEvent->accept();
                    return true;
                }
                if (keyEvent->key() == Qt::Key_Escape) {
                    hideComposerSuggestions();
                    keyEvent->accept();
                    return true;
                }
                const bool selectSuggestion =
                    keyEvent->key() == Qt::Key_Tab
                    || ((keyEvent->key() == Qt::Key_Return || keyEvent->key() == Qt::Key_Enter)
                        && !keyEvent->modifiers().testFlag(Qt::ShiftModifier));
                if (count > 0 && selectSuggestion) {
                    chooseComposerSuggestion(composerSuggestionList_->currentItem());
                    keyEvent->accept();
                    return true;
                }
            }
            if (handleApplicationKey(keyEvent)) {
                keyEvent->accept();
                return true;
            }
            if (watched == composer_
                && !keyEvent->isAutoRepeat()
                && (keyEvent->key() == Qt::Key_Return || keyEvent->key() == Qt::Key_Enter)
                && !keyEvent->modifiers().testFlag(Qt::ShiftModifier)) {
                const bool ctrlEnter = preferences_.value(QStringLiteral("composer.ctrl_enter")).toBool();
                if (!ctrlEnter || keyEvent->modifiers().testFlag(Qt::ControlModifier)) {
                    sendMessage();
                    keyEvent->accept();
                    return true;
                }
            }
        }
    }

    auto *blurredWidget = qobject_cast<QWidget *>(watched);
    if (contentBlurWidgets_.contains(blurredWidget)
        && (event->type() == QEvent::Enter || event->type() == QEvent::Leave
            || event->type() == QEvent::HoverEnter || event->type() == QEvent::HoverLeave
            || event->type() == QEvent::FocusIn || event->type() == QEvent::FocusOut)) {
        if (auto *effect = qobject_cast<QGraphicsBlurEffect *>(blurredWidget->graphicsEffect())) {
            effect->setEnabled(!blurredWidget->underMouse() && !blurredWidget->hasFocus());
        }
    }

    // The composer consumes drops for text, so file drops are intercepted here before it does.
    if (watched == composer_ && (event->type() == QEvent::DragEnter || event->type() == QEvent::DragMove ||
                                 event->type() == QEvent::Drop)) {
        auto *dragEvent = static_cast<QDropEvent *>(event);
        if (event->type() == QEvent::Drop) {
            dropEvent(dragEvent);
            return event->isAccepted();
        }
        if (canAcceptFileDrop(dragEvent->mimeData())) {
            dragEvent->acceptProposedAction();
            return true;
        }
    }
    return QMainWindow::eventFilter(watched, event);
}

void MainWindow::recordMedia(bool videoMessage) {
    if (currentRoomID_.isEmpty()) {
        return;
    }
    const RecordingDialog::Kind kind =
        videoMessage ? RecordingDialog::Kind::VideoMessage : RecordingDialog::Kind::VoiceNote;
    RecordingDialog dialog(kind, preferences_.value(QStringLiteral("audio.input_device")).toString(), this);
    if (dialog.exec() != QDialog::Accepted || dialog.recordedPath().isEmpty()) {
        return;
    }
    attachPath(dialog.recordedPath(), !videoMessage, videoMessage, dialog.durationMs());
}

void MainWindow::attachPath(const QString &path, bool voiceNote, bool videoMessage, qint64 durationMs) {
    if (path.isEmpty() || currentRoomID_.isEmpty()) {
        return;
    }
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        showError(file.errorString());
        return;
    }
    constexpr qint64 maximumAttachmentBytes = 50LL * 1024 * 1024;
    if (file.size() <= 0 || file.size() > maximumAttachmentBytes) {
        showError(file.size() <= 0
                      ? QStringLiteral("The selected file is empty.")
                      : QStringLiteral("Attachments cannot exceed 50 MiB."));
        return;
    }
    const QByteArray data = file.readAll();
    if (data.size() != file.size()) {
        showError(file.errorString().isEmpty()
                      ? QStringLiteral("The selected file could not be read completely.")
                      : file.errorString());
        return;
    }
    const QString roomID = currentRoomID_;
    attachButton_->setEnabled(false);
    recordButton_->setEnabled(false);
    statusBar()->showMessage(QStringLiteral("Uploading %1…").arg(QFileInfo(path).fileName()));
    media_->uploadAttachment(roomID, QFileInfo(path).fileName(), data, voiceNote, videoMessage, durationMs,
                             [this, roomID](bool ok, const QString &error) {
        attachButton_->setEnabled(true);
        recordButton_->setEnabled(true);
        if (!ok) {
            showError(error);
            return;
        }
        statusBar()->showMessage(QStringLiteral("Attachment sent."), 5000);
        if (currentRoomID_ == roomID) {
            loadHistory(roomID);
        }
    });
}

void MainWindow::showMessageContextMenu(const QPoint &position) {
    auto *item = messages_->itemAt(position);
    if (!item) {
        return;
    }
    const QString eventID = item->data(Qt::UserRole).toString();
    const auto message = messagesByID_.value(eventID);
    const QString body = message.value(QStringLiteral("body")).toString();
    if (message.isEmpty()) {
        return;
    }
    const bool own = message.value(QStringLiteral("own")).toBool();
    const bool hasTransaction = !message.value(QStringLiteral("transactionId")).toString().isEmpty();
    QMenu menu(this);
    preparePopupMenu(&menu);
    QAction *const reply = menu.addAction(QStringLiteral("Reply"));
    QAction *const thread = menu.addAction(QStringLiteral("Reply in thread"));
    thread->setEnabled(eventID.startsWith(QLatin1Char('$'))
                       && !message.value(QStringLiteral("sending")).toBool());
    QAction *const reminder = menu.addAction(QStringLiteral("Set reminder…"));
    reminder->setEnabled(eventID.startsWith(QLatin1Char('$'))
                         && !message.value(QStringLiteral("redacted")).toBool());
    const QAction *const react = menu.addAction(QStringLiteral("Add reaction…"));
    QAction *const copy = menu.addAction(QStringLiteral("Copy text"));
    const QAction *const saveMediaAction =
        !message.value(QStringLiteral("mediaUri")).toString().isEmpty()
            && !message.value(QStringLiteral("redacted")).toBool()
            && message.value(QStringLiteral("decryptionError")).toString().isEmpty()
        ? menu.addAction(QStringLiteral("Save attachment…"))
        : nullptr;
    const QAction *const openMediaAction = saveMediaAction
        ? menu.addAction(QStringLiteral("Open with system app…"))
        : nullptr;
    const QString mediaURI = message.value(QStringLiteral("mediaUri")).toString();
    const QString mediaType = message.value(QStringLiteral("mediaType")).toString();
    const QString mediaMIME = message.value(QStringLiteral("mediaMime")).toString();
    const bool audioAttachment = !mediaURI.isEmpty()
        && (mediaType == QStringLiteral("m.audio") || mediaMIME.startsWith(QStringLiteral("audio/")));
    QAction *const transcribeAction = audioAttachment
        ? menu.addAction(QStringLiteral("Transcribe with AI…"))
        : nullptr;
    QAction *const analyzeMessageAction = menu.addAction(QStringLiteral("Analyze with Language Tutor"));
    QAction *const draftReplyAction = menu.addAction(QStringLiteral("Draft reply with AI"));
    QAction *const explainMessageAction = menu.addAction(QStringLiteral("Explain message with AI"));
    const bool playableAttachment = !mediaURI.isEmpty()
        && (mediaMIME.startsWith(QStringLiteral("audio/")) || mediaMIME.startsWith(QStringLiteral("video/")))
        && !message.value(QStringLiteral("redacted")).toBool()
        && message.value(QStringLiteral("decryptionError")).toString().isEmpty();
    const QAction *const playAction = playableAttachment ? menu.addAction(QStringLiteral("Play…")) : nullptr;
    const QAction *const edit = own ? menu.addAction(QStringLiteral("Edit")) : nullptr;
    const QAction *const redact = own ? menu.addAction(QStringLiteral("Delete")) : nullptr;
    const QAction *const retry = hasTransaction && !message.value(QStringLiteral("sendError")).toString().isEmpty()
                                    ? menu.addAction(QStringLiteral("Retry sending"))
                                    : nullptr;
    if (preferences_.value(QStringLiteral("shortcuts.single_keys")).toBool(true)) {
        setContextShortcut(reply, QKeySequence(QStringLiteral("R")));
    }
    setContextShortcut(copy, QKeySequence::Copy);
    if (transcribeAction) {
        setContextShortcut(transcribeAction, primaryShortcut(QStringLiteral("Shift+V")));
    }
    setContextShortcut(analyzeMessageAction, primaryShortcut(QStringLiteral("Shift+C")));
    setContextShortcut(draftReplyAction, primaryShortcut(QStringLiteral("Shift+D")));
    setContextShortcut(explainMessageAction, primaryShortcut(QStringLiteral("Shift+E")));
    analyzeMessageAction->setEnabled(!body.isEmpty());
    draftReplyAction->setEnabled(!body.isEmpty());
    explainMessageAction->setEnabled(!body.isEmpty());
    auto *chosen = menu.exec(messages_->viewport()->mapToGlobal(position));
    if (chosen == reply) {
        editEventID_.clear();
        replyToEventID_ = eventID;
        composer_->clear();
        setComposeContext(QStringLiteral("Replying to %1: %2")
                              .arg(message.value(QStringLiteral("senderName")).toString(), body));
        composer_->setFocus();
    } else if (chosen == thread) {
        const QString rootID = message.value(QStringLiteral("threadRootId")).toString();
        openThread(rootID.isEmpty() ? eventID : rootID);
    } else if (chosen == reminder) {
        scheduleReminder(eventID);
    } else if (chosen == react) {
        bool accepted = false;
        const QString emoji = QInputDialog::getText(
            this, QStringLiteral("Add reaction"), QStringLiteral("Emoji"),
            QLineEdit::Normal, QStringLiteral("👍"), &accepted).trimmed();
        if (accepted && !emoji.isEmpty()) {
            runMessageAction(QStringLiteral("React"), {currentRoomID_, eventID, emoji});
        }
    } else if (chosen == copy) {
        QGuiApplication::clipboard()->setText(body);
    } else if (chosen == saveMediaAction) {
        saveMedia(message);
    } else if (chosen == openMediaAction) {
        saveMedia(message, true);
    } else if (chosen == playAction) {
        openMediaPreview(eventID);
    } else if (chosen == transcribeAction) {
        transcribeMessage(message);
    } else if (chosen == analyzeMessageAction) {
        showAITools(QStringLiteral("Language Tutor"), QStringLiteral("C"), body);
    } else if (chosen == draftReplyAction) {
        showAITools(QStringLiteral("Suggestions"), QStringLiteral("D"), body);
    } else if (chosen == explainMessageAction) {
        showAITools(QStringLiteral("Language Tutor"), QStringLiteral("E"), body);
    } else if (chosen == edit) {
        replyToEventID_.clear();
        editEventID_ = eventID;
        composer_->setPlainText(body);
        setComposeContext(QStringLiteral("Editing your message"));
        composer_->setFocus();
    } else if (chosen == redact) {
        if (QMessageBox::question(this, QStringLiteral("Delete message"),
                                  QStringLiteral("Delete this message for everyone?"))
            == QMessageBox::Yes) {
            runMessageAction(QStringLiteral("RedactMessage"), {currentRoomID_, eventID});
        }
    } else if (chosen == retry) {
        runMessageAction(QStringLiteral("RetryMessage"),
                         {message.value(QStringLiteral("transactionId")).toString()});
    }
}

void MainWindow::transcribeMessage(const QJsonObject &message) {
    const QString mediaURI = message.value(QStringLiteral("mediaUri")).toString();
    if (mediaURI.isEmpty()) {
        return;
    }
    const QString roomID = currentRoomID_;
    QString filename = message.value(QStringLiteral("body")).toString().trimmed();
    if (filename.isEmpty()) {
        filename = QStringLiteral("audio-attachment");
    }
    const QString mediaMIME = message.value(QStringLiteral("mediaMime")).toString();
    const QString contentType = mediaMIME.isEmpty() ? QStringLiteral("audio/ogg") : mediaMIME;
    statusBar()->showMessage(QStringLiteral("Transcribing audio…"));
    backend_->call(QStringLiteral("AITranscribeMedia"), {mediaURI, filename, contentType},
                   [this, roomID](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            showError(error);
            return;
        }
        const QString transcript = value.toString().trimmed();
        if (transcript.isEmpty()) {
            statusBar()->showMessage(QStringLiteral("No speech was detected."), 8000);
            return;
        }
        if (currentRoomID_ != roomID) {
            statusBar()->showMessage(
                QStringLiteral("Transcription is ready, but the active room changed."), 8000);
            return;
        }
        composer_->setPlainText(transcript);
        composer_->setFocus();
        statusBar()->showMessage(
            QStringLiteral("Transcript added to the composer as a draft."), 8000);
    });
}

void MainWindow::runMessageAction(const QString &method, const QJsonArray &params) {
    backend_->call(method, params, [this](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            showError(error);
            return;
        }
        loadHistory(currentRoomID_);
        loadSnapshot();
    });
}

void MainWindow::setComposeContext(const QString &label) {
    composeContext_->setText(label);
    composeContext_->show();
    cancelComposeContextButton_->show();
    sendButton_->setToolTip(editEventID_.isEmpty() ? QStringLiteral("Send message")
                                                   : QStringLiteral("Save edit"));
    sendButton_->setEnabled(!composer_->toPlainText().trimmed().isEmpty());
    scheduleMessageButton_->setEnabled(!currentRoomID_.isEmpty() && editEventID_.isEmpty()
                                       && !composer_->toPlainText().trimmed().isEmpty());
}

void MainWindow::clearComposeContext() {
    replyToEventID_.clear();
    editEventID_.clear();
    composeContext_->clear();
    composeContext_->hide();
    cancelComposeContextButton_->hide();
    sendButton_->setToolTip(QStringLiteral("Send message"));
    sendButton_->setEnabled(!currentRoomID_.isEmpty() && !composer_->toPlainText().trimmed().isEmpty());
    scheduleMessageButton_->setEnabled(!currentRoomID_.isEmpty()
                                       && !composer_->toPlainText().trimmed().isEmpty());
}

void MainWindow::updateRoomFilter(const QString &filter) {
    Q_UNUSED(filter);
    filterRooms();
}

void MainWindow::showRoomContextMenu(const QPoint &position) {
    auto *item = rooms_->itemAt(position);
    if (!item) {
        return;
    }
    const QJsonObject selectedRoom =
        QJsonObject::fromVariantMap(item->data(Qt::UserRole + 1).toMap());
    if (selectedRoom.value(QStringLiteral("accountId")).toString()
        != snapshot_.value(QStringLiteral("activeAccountId")).toString()) {
        return;
    }
    rooms_->setCurrentItem(item);
    const auto room = roomByID(item->data(Qt::UserRole).toString());
    const bool archived = roomIsArchived(room);
    const bool favorite = room.value(QStringLiteral("favorite")).toBool();
    const bool muted = room.value(QStringLiteral("muted")).toBool();
    const bool needsReply = room.value(QStringLiteral("needsReply")).toBool();
    const bool unanswered = room.value(QStringLiteral("unanswered")).toBool();
    const bool unread = room.value(QStringLiteral("unread")).toInt() > 0
                        || room.value(QStringLiteral("markedUnread")).toBool();

    QMenu menu(this);
    preparePopupMenu(&menu);
    auto *markRead = menu.addAction(QStringLiteral("Mark read"));
    auto *markUnread = menu.addAction(QStringLiteral("Mark unread"));
    auto *markAnswered = menu.addAction(QStringLiteral("Mark answered"));
    auto *addNeedsReply = menu.addAction(QStringLiteral("Add to Needs Reply"));
    menu.addSeparator();
    auto *favoriteAction = menu.addAction(favorite ? QStringLiteral("Remove from Favorites")
                                                   : QStringLiteral("Add to Favorites"));
    auto *muteAction = menu.addAction(muted ? QStringLiteral("Unmute room")
                                            : QStringLiteral("Mute room"));
    auto *archiveAction = menu.addAction(archived ? QStringLiteral("Restore room")
                                                  : QStringLiteral("Archive room"));
    auto *detailsAction = menu.addAction(QStringLiteral("Room details…"));
    auto *galleryAction = menu.addAction(QStringLiteral("Media gallery…"));
    auto *exportAction = menu.addAction(QStringLiteral("Export chat…"));
    markRead->setEnabled(unread && !room.value(QStringLiteral("lastEventId")).toString().isEmpty());
    markUnread->setEnabled(!unread);
    markAnswered->setEnabled(needsReply);
    addNeedsReply->setEnabled(unanswered && !needsReply);
    if (preferences_.value(QStringLiteral("shortcuts.single_keys")).toBool(true)) {
        setContextShortcut(markRead, QKeySequence(QStringLiteral("U")));
        setContextShortcut(markUnread, QKeySequence(QStringLiteral("U")));
        const QString answeredShortcut = preferences_.value(QStringLiteral("shortcuts.mark_answered"))
                                             .toString(QStringLiteral("E")).trimmed();
        if (answeredShortcut.size() == 1) {
            setContextShortcut(markAnswered, QKeySequence(answeredShortcut.toUpper()));
        }
        setContextShortcut(addNeedsReply, QKeySequence(QStringLiteral("N")));
        setContextShortcut(favoriteAction, QKeySequence(QStringLiteral("F")));
        setContextShortcut(muteAction, QKeySequence(QStringLiteral("M")));
        setContextShortcut(archiveAction, QKeySequence(QStringLiteral("A")));
    }

    auto *chosen = menu.exec(rooms_->viewport()->mapToGlobal(position));
    const QString roomID = room.value(QStringLiteral("id")).toString();
    if (chosen == markRead) {
        runRoomAction(QStringLiteral("MarkRead"),
                      {roomID, room.value(QStringLiteral("lastEventId")).toString()});
    } else if (chosen == markUnread) {
        runRoomAction(QStringLiteral("MarkUnread"), {roomID});
    } else if (chosen == markAnswered) {
        markRoomAnswered(roomID);
    } else if (chosen == addNeedsReply) {
        runRoomAction(QStringLiteral("SetRoomUnanswered"), {roomID, true});
    } else if (chosen == favoriteAction) {
        runRoomAction(QStringLiteral("SetBooleanPreference"),
                      {QStringLiteral("room.favorite.") + roomID, !favorite});
    } else if (chosen == muteAction) {
        runRoomAction(QStringLiteral("SetBooleanPreference"),
                      {QStringLiteral("room.muted.") + roomID, !muted});
    } else if (chosen == archiveAction) {
        setRoomArchived(room, !archived);
    } else if (chosen == detailsAction) {
        showRoomDetails(roomID);
    } else if (chosen == galleryAction) {
        showMediaGallery(roomID);
    } else if (chosen == exportAction) {
        exportRoomChat(roomID);
    }
}

void MainWindow::saveMedia(const QJsonObject &message, bool openAfterSave) {
    const QString mediaURI = message.value(QStringLiteral("mediaUri")).toString();
    if (mediaURI.isEmpty()) {
        return;
    }
    QString filename = message.value(QStringLiteral("body")).toString().trimmed();
    if (filename.isEmpty()) {
        filename = QStringLiteral("matrix-attachment");
    }
    backend_->call(QStringLiteral("SaveMedia"), {mediaURI, filename},
                   [this, openAfterSave](QJsonValue value, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       const QString path = value.toString();
                       if (path.isEmpty()) {
                           statusBar()->showMessage(QStringLiteral("Saving attachment was cancelled."), 5000);
                           return;
                       }
                       if (openAfterSave) {
                           if (!QDesktopServices::openUrl(QUrl::fromLocalFile(path))) {
                               showError(QStringLiteral("The saved attachment could not be opened."));
                           }
                           return;
                       }
                       QMessageBox saved(QMessageBox::Information, QStringLiteral("Attachment saved"),
                                         QStringLiteral("Saved to %1").arg(path),
                                         QMessageBox::Ok | QMessageBox::Open, this);
                       saved.button(QMessageBox::Open)->setText(QStringLiteral("Show in folder"));
                       if (saved.exec() == QMessageBox::Open) {
                           backend_->call(QStringLiteral("RevealFile"), {path},
                                          [this](QJsonValue, const QString &revealError) {
                                              if (!revealError.isEmpty()) {
                                                  showError(revealError);
                                              }
                                          });
                       }
                   });
}

void MainWindow::openMediaPreview(const QString &eventID) {
    const QJsonObject message = messagesByID_.value(eventID);
    const QString mime = message.value(QStringLiteral("mediaMime")).toString();
    const bool image = mime.startsWith(QStringLiteral("image/"));
    const bool playable = mime.startsWith(QStringLiteral("audio/")) || mime.startsWith(QStringLiteral("video/"));
    if (mime.isEmpty() || (!image && !playable)
        || message.value(QStringLiteral("redacted")).toBool()
        || !message.value(QStringLiteral("decryptionError")).toString().isEmpty()) {
        return;
    }
    const QString url = media_->mediaUrl(QStringLiteral("matrix"), currentRoomID_, eventID);
    const QPointer<MainWindow> guardedWindow(this);
    const QString title = message.value(QStringLiteral("body")).toString().trimmed();
    media_->fetch(url, [guardedWindow, mime, playable, title](bool ok, const QByteArray &data, const QString &error) {
        if (!guardedWindow) {
            return;
        }
        if (!ok) {
            guardedWindow->showError(error);
            return;
        }
        if (playable) {
            MediaPlayerDialog player(title.isEmpty() ? QStringLiteral("Media") : title, mime, data, guardedWindow.data());
            player.exec();
            return;
        }
        const QPixmap image = QPixmap::fromImage(QImage::fromData(data));
        if (image.isNull()) {
            guardedWindow->showError(QStringLiteral("The image could not be decoded."));
            return;
        }
        QDialog dialog(guardedWindow);
        dialog.setWindowTitle(QStringLiteral("Image preview"));
        dialog.resize(900, 680);
        auto *layout = new QVBoxLayout(&dialog);
        auto *preview = new QLabel(&dialog);
        preview->setAlignment(Qt::AlignCenter);
        preview->setPixmap(image.scaled(dialog.size(), Qt::KeepAspectRatio,
                                        Qt::SmoothTransformation));
        layout->addWidget(preview);
        dialog.exec();
    });
}

void MainWindow::showMediaGallery(const QString &roomID) {
    if (roomID.isEmpty()) {
        return;
    }
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle(QStringLiteral("Media gallery"));
    dialog->resize(680, 520);
    auto *layout = new QVBoxLayout(dialog);
    auto *status = new QLabel(QStringLiteral("Loading room media…"), dialog);
    auto *items = new QListWidget(dialog);
    auto *actions = new QHBoxLayout;
    auto *saveButton = new QPushButton(QStringLiteral("Save attachment…"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    saveButton->setEnabled(false);
    actions->addStretch();
    actions->addWidget(saveButton);
    actions->addWidget(closeButton);
    layout->addWidget(status);
    layout->addWidget(items, 1);
    layout->addLayout(actions);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedItems(items);
    QPointer<QPushButton> guardedSave(saveButton);
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::close);
    connect(items, &QListWidget::currentItemChanged, dialog,
            [guardedSave](QListWidgetItem *item, QListWidgetItem *) {
                if (guardedSave) {
                    guardedSave->setEnabled(item != nullptr);
                }
            });
    const auto saveSelected = [this, guardedItems] {
        if (!guardedItems || !guardedItems->currentItem()) {
            return;
        }
        const auto json = guardedItems->currentItem()->data(Qt::UserRole).toString().toUtf8();
        const auto document = QJsonDocument::fromJson(json);
        if (!document.isObject()) {
            showError(QStringLiteral("The selected media item is invalid."));
            return;
        }
        saveMedia(document.object());
    };
    connect(saveButton, &QPushButton::clicked, dialog, saveSelected);
    connect(items, &QListWidget::itemDoubleClicked, dialog,
            [saveSelected](QListWidgetItem *) { saveSelected(); });

    auto seen = std::make_shared<QSet<QString>>();
    auto loader = std::make_shared<std::function<void(qint64, qint64)>>();
    const std::weak_ptr<std::function<void(qint64, qint64)>> weakLoader = loader;
    *loader = [this, roomID, guardedDialog, guardedStatus, guardedItems, seen, weakLoader]
              (qint64 before, qint64 previousCursor) {
        if (!guardedDialog || !guardedStatus || !guardedItems) {
            return;
        }
        const auto keepAlive = weakLoader.lock();
        backend_->call(QStringLiteral("History"), {roomID, before},
                       [this, roomID, guardedDialog, guardedStatus, guardedItems, seen,
                        keepAlive, before, previousCursor](QJsonValue value, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedItems) {
                               return;
                           }
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                               return;
                           }
                           if (!value.isObject()) {
                               guardedStatus->setText(QStringLiteral("The backend returned an invalid history page."));
                               return;
                           }
                           const auto page = value.toObject();
                           for (const auto &entry : page.value(QStringLiteral("messages")).toArray()) {
                               const auto message = entry.toObject();
                               const QString mediaURI = message.value(QStringLiteral("mediaUri")).toString();
                               const QString eventID = message.value(QStringLiteral("id")).toString();
                               if (mediaURI.isEmpty() || message.value(QStringLiteral("redacted")).toBool()
                                   || !message.value(QStringLiteral("decryptionError")).toString().isEmpty()
                                   || (!eventID.isEmpty() && seen->contains(eventID))) {
                                   continue;
                               }
                               if (!eventID.isEmpty()) {
                                   seen->insert(eventID);
                               }
                               const QString filename = message.value(QStringLiteral("body")).toString().trimmed();
                               const QString sender = message.value(QStringLiteral("senderName")).toString(
                                   message.value(QStringLiteral("sender")).toString());
                               const qint64 timestamp = static_cast<qint64>(
                                   message.value(QStringLiteral("timestamp")).toDouble());
                               const QString label = QStringLiteral("%1 · %2\n%3")
                                   .arg(filename.isEmpty() ? QStringLiteral("Attachment") : filename,
                                        sender,
                                        timestamp > 0
                                            ? QDateTime::fromMSecsSinceEpoch(timestamp).toLocalTime()
                                                  .toString(QStringLiteral("yyyy-MM-dd HH:mm"))
                                            : QString());
                               auto *item = new QListWidgetItem(label, guardedItems);
                               item->setData(Qt::UserRole,
                                             QString::fromUtf8(QJsonDocument(message).toJson(
                                                 QJsonDocument::Compact)));
                               item->setToolTip(message.value(QStringLiteral("mediaMime")).toString());
                           }
                           const qint64 cursor = static_cast<qint64>(
                               page.value(QStringLiteral("before")).toDouble());
                           const bool more = page.value(QStringLiteral("hasMore")).toBool()
                               && cursor > 0 && (before == 0 || cursor < before)
                               && cursor != previousCursor;
                           if (more) {
                               guardedStatus->setText(
                                   QStringLiteral("Loading room media… %1 items found")
                                       .arg(guardedItems->count()));
                               if (keepAlive) {
                                   (*keepAlive)(cursor, cursor);
                               }
                               return;
                           }
                           guardedStatus->setText(guardedItems->count() == 0
                               ? QStringLiteral("No media attachments in this room.")
                               : QStringLiteral("%1 media attachments").arg(guardedItems->count()));
                       });
    };
    dialog->show();
    (*loader)(0, -1);
}

void MainWindow::exportRoomChat(const QString &roomID) {
    if (roomID.isEmpty()) {
        return;
    }
    const QString directory = QFileDialog::getExistingDirectory(
        this, QStringLiteral("Choose chat export folder"));
    if (directory.isEmpty()) {
        return;
    }
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle(QStringLiteral("Export chat"));
    dialog->setModal(true);
    auto *layout = new QVBoxLayout(dialog);
    auto *status = new QLabel(QStringLiteral("Preparing chat export…"), dialog);
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel export"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    closeButton->setEnabled(false);
    auto *buttons = new QHBoxLayout;
    buttons->addStretch();
    buttons->addWidget(cancelButton);
    buttons->addWidget(closeButton);
    layout->addWidget(status);
    layout->addLayout(buttons);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QPushButton> guardedCancel(cancelButton);
    QPointer<QPushButton> guardedClose(closeButton);
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::close);
    connect(cancelButton, &QPushButton::clicked, dialog, [this, guardedStatus, guardedCancel] {
        if (!guardedStatus || !guardedCancel) {
            return;
        }
        guardedCancel->setEnabled(false);
        guardedStatus->setText(QStringLiteral("Cancelling export…"));
        backend_->call(QStringLiteral("CancelChatExport"), {},
                       [this, guardedStatus](QJsonValue result, const QString &error) {
                           if (!guardedStatus) {
                               return;
                           }
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                           } else if (!result.toBool()) {
                               guardedStatus->setText(QStringLiteral("No export is currently running."));
                           }
                       });
    });
    dialog->show();
    backend_->call(QStringLiteral("ExportRoomChat"), {roomID, directory},
                   [this, guardedDialog, guardedStatus, guardedCancel, guardedClose]
                   (QJsonValue result, const QString &error) {
                       if (!guardedDialog || !guardedStatus || !guardedCancel || !guardedClose) {
                           return;
                       }
                       guardedCancel->setEnabled(false);
                       guardedClose->setEnabled(true);
                       if (!error.isEmpty()) {
                           guardedStatus->setText(error);
                           return;
                       }
                       const auto exportResult = result.toObject();
                       const QString path = exportResult.value(QStringLiteral("path")).toString();
                       guardedStatus->setText(QStringLiteral("Exported %1 messages to %2")
                           .arg(exportResult.value(QStringLiteral("messages")).toInt())
                           .arg(path));
                       statusBar()->showMessage(QStringLiteral("Chat export saved to %1").arg(path), 10000);
                   });
}

void MainWindow::joinRoom() {
    bool accepted = false;
    const QString target = QInputDialog::getText(
        this, QStringLiteral("Join a room"), QStringLiteral("Room alias, ID, or matrix.to link"),
        QLineEdit::Normal, {}, &accepted).trimmed();
    if (!accepted || target.isEmpty()) {
        return;
    }
    joinRoomButton_->setEnabled(false);
    backend_->call(QStringLiteral("JoinRoom"), {target},
                   [this](QJsonValue result, const QString &error) {
                       joinRoomButton_->setEnabled(true);
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       pendingRoomID_ = result.toString();
                       loadSnapshot();
                   });
}

void MainWindow::scheduleMessage() {
    const QString text = composer_->toPlainText().trimmed();
    if (currentRoomID_.isEmpty() || text.isEmpty() || !editEventID_.isEmpty()) {
        return;
    }
    const QString roomID = currentRoomID_;
    const QString replyTo = replyToEventID_;
    const auto room = roomByID(roomID);
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(replyTo.isEmpty() ? QStringLiteral("Schedule message")
                                            : QStringLiteral("Schedule reply"));
    auto *layout = new QVBoxLayout(dialog);
    auto *target = new QLabel(QStringLiteral("To %1").arg(
        room.value(QStringLiteral("name")).toString(roomID)), dialog);
    auto *preview = new QLabel(text, dialog);
    preview->setWordWrap(true);
    auto *dueAt = new QDateTimeEdit(QDateTime::currentDateTime().addSecs(300), dialog);
    dueAt->setCalendarPopup(true);
    dueAt->setDisplayFormat(QStringLiteral("yyyy-MM-dd HH:mm"));
    dueAt->setMinimumDateTime(QDateTime::currentDateTime().addSecs(1));
    auto *status = new QLabel(dialog);
    auto *buttons = new QHBoxLayout;
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel"), dialog);
    auto *scheduleButton = new QPushButton(QStringLiteral("Schedule"), dialog);
    buttons->addStretch();
    buttons->addWidget(cancelButton);
    buttons->addWidget(scheduleButton);
    layout->addWidget(target);
    layout->addWidget(preview);
    layout->addWidget(new QLabel(QStringLiteral("Send at"), dialog));
    layout->addWidget(dueAt);
    layout->addWidget(status);
    layout->addLayout(buttons);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QDateTimeEdit> guardedDueAt(dueAt);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QPushButton> guardedSchedule(scheduleButton);
    connect(cancelButton, &QPushButton::clicked, dialog, &QDialog::reject);
    connect(scheduleButton, &QPushButton::clicked, dialog,
            [this, roomID, text, replyTo, guardedDialog, guardedDueAt, guardedStatus, guardedSchedule] {
                if (!guardedDialog || !guardedDueAt || !guardedStatus || !guardedSchedule) {
                    return;
                }
                const QDateTime when = guardedDueAt->dateTime();
                if (when <= QDateTime::currentDateTime()) {
                    guardedStatus->setText(QStringLiteral("Choose a time in the future."));
                    return;
                }
                guardedSchedule->setEnabled(false);
                guardedStatus->setText(QStringLiteral("Scheduling…"));
                const QJsonArray params = replyTo.isEmpty()
                    ? QJsonArray{roomID, text, when.toMSecsSinceEpoch()}
                    : QJsonArray{roomID, text, replyTo, when.toMSecsSinceEpoch()};
                backend_->call(replyTo.isEmpty() ? QStringLiteral("ScheduleMessage")
                                                 : QStringLiteral("ScheduleReply"),
                               params, [this, roomID, guardedDialog, guardedStatus, guardedSchedule]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedStatus || !guardedSchedule) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       guardedSchedule->setEnabled(true);
                                       return;
                                   }
                                   roomDrafts_.remove(roomDraftKey(
                                       snapshot_.value(QStringLiteral("activeAccountId")).toString(),
                                       roomID));
                                   if (currentRoomID_ == roomID) {
                                       composer_->clear();
                                       clearComposeContext();
                                   }
                                   guardedDialog->accept();
                                   statusBar()->showMessage(QStringLiteral("Message scheduled."), 8000);
                               });
            });
    dialog->show();
}

void MainWindow::scheduleReminder(const QString &eventID) {
    if (currentRoomID_.isEmpty() || eventID.isEmpty()) {
        return;
    }
    const QString roomID = currentRoomID_;
    const auto room = roomByID(roomID);
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Set reminder"));
    auto *layout = new QVBoxLayout(dialog);
    auto *target = new QLabel(QStringLiteral("Reminder for %1").arg(
        room.value(QStringLiteral("name")).toString(roomID)), dialog);
    auto *note = new QLineEdit(dialog);
    note->setPlaceholderText(QStringLiteral("Optional note"));
    auto *dueAt = new QDateTimeEdit(QDateTime::currentDateTime().addSecs(3600), dialog);
    dueAt->setCalendarPopup(true);
    dueAt->setDisplayFormat(QStringLiteral("yyyy-MM-dd HH:mm"));
    dueAt->setMinimumDateTime(QDateTime::currentDateTime().addSecs(1));
    auto *archive = new QCheckBox(QStringLiteral("Archive this room after setting the reminder"), dialog);
    auto *status = new QLabel(dialog);
    auto *buttons = new QHBoxLayout;
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel"), dialog);
    auto *scheduleButton = new QPushButton(QStringLiteral("Set reminder"), dialog);
    buttons->addStretch();
    buttons->addWidget(cancelButton);
    buttons->addWidget(scheduleButton);
    layout->addWidget(target);
    layout->addWidget(note);
    layout->addWidget(new QLabel(QStringLiteral("Remind me at"), dialog));
    layout->addWidget(dueAt);
    layout->addWidget(archive);
    layout->addWidget(status);
    layout->addLayout(buttons);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLineEdit> guardedNote(note);
    QPointer<QDateTimeEdit> guardedDueAt(dueAt);
    QPointer<QCheckBox> guardedArchive(archive);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QPushButton> guardedSchedule(scheduleButton);
    connect(cancelButton, &QPushButton::clicked, dialog, &QDialog::reject);
    connect(scheduleButton, &QPushButton::clicked, dialog,
            [this, roomID, eventID, guardedDialog, guardedNote, guardedDueAt, guardedArchive,
             guardedStatus, guardedSchedule] {
                if (!guardedDialog || !guardedNote || !guardedDueAt || !guardedArchive
                    || !guardedStatus || !guardedSchedule) {
                    return;
                }
                const QDateTime when = guardedDueAt->dateTime();
                if (when <= QDateTime::currentDateTime()) {
                    guardedStatus->setText(QStringLiteral("Choose a time in the future."));
                    return;
                }
                guardedSchedule->setEnabled(false);
                guardedStatus->setText(QStringLiteral("Setting reminder…"));
                backend_->call(QStringLiteral("ScheduleReminder"),
                               {roomID, eventID, guardedNote->text().trimmed(), when.toMSecsSinceEpoch()},
                               [this, roomID, guardedDialog, guardedArchive, guardedStatus, guardedSchedule]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedArchive || !guardedStatus || !guardedSchedule) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       guardedSchedule->setEnabled(true);
                                       return;
                                   }
                                   const bool archiveRoom = guardedArchive->isChecked();
                                   guardedDialog->accept();
                                   statusBar()->showMessage(QStringLiteral("Reminder scheduled."), 8000);
                                   if (!archiveRoom) {
                                       return;
                                   }
                                   const QString key = archivePreferenceKey(roomByID(roomID));
                                   backend_->call(QStringLiteral("SetBooleanPreference"), {key, true},
                                                  [this](QJsonValue, const QString &archiveError) {
                                                      if (!archiveError.isEmpty()) {
                                                          showError(QStringLiteral("Reminder set, but the room could not be archived: %1")
                                                                        .arg(archiveError));
                                                          return;
                                                      }
                                                      loadSnapshot();
                                                  });
                               });
            });
    dialog->show();
}

void MainWindow::openScheduledJobs() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Scheduled messages and reminders"));
    dialog->resize(620, 520);
    auto *layout = new QVBoxLayout(dialog);
    auto *status = new QLabel(QStringLiteral("Loading scheduled jobs…"), dialog);
    auto *jobs = new QListWidget(dialog);
    auto *dueAt = new QDateTimeEdit(dialog);
    dueAt->setCalendarPopup(true);
    dueAt->setDisplayFormat(QStringLiteral("yyyy-MM-dd HH:mm"));
    auto *actionRow = new QHBoxLayout;
    auto *saveTimeButton = new QPushButton(QStringLiteral("Save time"), dialog);
    auto *retryButton = new QPushButton(QStringLiteral("Retry"), dialog);
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel job"), dialog);
    auto *dismissButton = new QPushButton(QStringLiteral("Dismiss"), dialog);
    auto *refreshButton = new QPushButton(QStringLiteral("Refresh"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    actionRow->addWidget(saveTimeButton);
    actionRow->addWidget(retryButton);
    actionRow->addWidget(cancelButton);
    actionRow->addWidget(dismissButton);
    auto *footer = new QHBoxLayout;
    footer->addWidget(refreshButton);
    footer->addStretch();
    footer->addWidget(closeButton);
    layout->addWidget(status);
    layout->addWidget(jobs, 1);
    layout->addWidget(new QLabel(QStringLiteral("Reschedule to"), dialog));
    layout->addWidget(dueAt);
    layout->addLayout(actionRow);
    layout->addLayout(footer);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedJobs(jobs);
    QPointer<QDateTimeEdit> guardedDueAt(dueAt);
    QPointer<QPushButton> guardedSaveTime(saveTimeButton);
    QPointer<QPushButton> guardedRetry(retryButton);
    QPointer<QPushButton> guardedCancel(cancelButton);
    QPointer<QPushButton> guardedDismiss(dismissButton);
    const auto updateActions = [guardedDueAt, guardedSaveTime, guardedRetry, guardedCancel, guardedDismiss]
                               (QListWidgetItem *item) {
        if (!guardedDueAt || !guardedSaveTime || !guardedRetry || !guardedCancel || !guardedDismiss) {
            return;
        }
        const QString jobStatus = item ? item->data(Qt::UserRole + 1).toString() : QString();
        const QString kind = item ? item->data(Qt::UserRole + 2).toString() : QString();
        const qint64 time = item ? item->data(Qt::UserRole + 3).toLongLong() : 0;
        const bool editable = jobStatus == QStringLiteral("pending") || jobStatus == QStringLiteral("failed");
        const bool dismissible = jobStatus == QStringLiteral("fired")
                                 || jobStatus == QStringLiteral("sent-late");
        guardedDueAt->setEnabled(editable);
        guardedSaveTime->setEnabled(editable);
        guardedRetry->setEnabled(editable && jobStatus == QStringLiteral("failed")
                                 && kind == QStringLiteral("message"));
        guardedCancel->setEnabled(editable);
        guardedDismiss->setEnabled(dismissible);
        if (time > 0) {
            guardedDueAt->setDateTime(QDateTime::fromMSecsSinceEpoch(time).toLocalTime());
        }
    };
    const auto loadJobs = [this, guardedDialog, guardedStatus, guardedJobs, updateActions] {
        if (!guardedDialog || !guardedStatus || !guardedJobs) {
            return;
        }
        guardedStatus->setText(QStringLiteral("Loading scheduled jobs…"));
        guardedJobs->clear();
        updateActions(nullptr);
        backend_->call(QStringLiteral("ScheduledJobs"), {},
                       [guardedDialog, guardedStatus, guardedJobs, updateActions]
                       (QJsonValue value, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedJobs) {
                               return;
                           }
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                               return;
                           }
                           const auto entries = value.toArray();
                           for (const auto &entry : entries) {
                               const auto job = entry.toObject();
                               const QString id = job.value(QStringLiteral("id")).toString();
                               const QString kind = job.value(QStringLiteral("kind")).toString();
                               const QString jobStatus = job.value(QStringLiteral("status")).toString();
                               const qint64 time = static_cast<qint64>(
                                   job.value(QStringLiteral("dueAt")).toDouble());
                               const QString roomID = job.value(QStringLiteral("roomId")).toString();
                               const QString label = QStringLiteral("%1 · %2\n%3\n%4\n%5")
                                   .arg(kind == QStringLiteral("reminder")
                                            ? QStringLiteral("Reminder")
                                            : QStringLiteral("Scheduled message"),
                                        jobStatus,
                                        QDateTime::fromMSecsSinceEpoch(time).toLocalTime()
                                            .toString(QStringLiteral("yyyy-MM-dd HH:mm")),
                                        roomID,
                                        job.value(QStringLiteral("text")).toString());
                               auto *item = new QListWidgetItem(label, guardedJobs);
                               item->setData(Qt::UserRole, id);
                               item->setData(Qt::UserRole + 1, jobStatus);
                               item->setData(Qt::UserRole + 2, kind);
                               item->setData(Qt::UserRole + 3, time);
                               if (!job.value(QStringLiteral("error")).toString().isEmpty()) {
                                   item->setToolTip(job.value(QStringLiteral("error")).toString());
                               }
                           }
                           guardedStatus->setText(entries.isEmpty()
                               ? QStringLiteral("No scheduled messages or reminders.")
                               : QStringLiteral("%1 scheduled items").arg(entries.size()));
                           updateActions(guardedJobs->currentItem());
                       });
    };
    const auto runJobAction = [this, guardedDialog, guardedStatus, guardedJobs, guardedSaveTime,
                               guardedRetry, guardedCancel, guardedDismiss, loadJobs, updateActions]
                              (const QString &method, const QJsonArray &params) {
        if (!guardedDialog || !guardedStatus || !guardedJobs) {
            return;
        }
        for (const auto &button : {guardedSaveTime, guardedRetry, guardedCancel, guardedDismiss}) {
            if (button) {
                button->setEnabled(false);
            }
        }
        guardedStatus->setText(QStringLiteral("Updating scheduled job…"));
        backend_->call(method, params, [guardedDialog, guardedStatus, guardedJobs, loadJobs, updateActions]
                       (QJsonValue, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedJobs) {
                               return;
                           }
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                               updateActions(guardedJobs->currentItem());
                               return;
                           }
                           loadJobs();
                       });
    };
    connect(jobs, &QListWidget::currentItemChanged, dialog,
            [updateActions](QListWidgetItem *item, QListWidgetItem *) { updateActions(item); });
    connect(refreshButton, &QPushButton::clicked, dialog, loadJobs);
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::close);
    connect(saveTimeButton, &QPushButton::clicked, dialog,
            [guardedJobs, guardedDueAt, guardedStatus, runJobAction] {
                if (!guardedJobs || !guardedDueAt || !guardedStatus) {
                    return;
                }
                auto *item = guardedJobs->currentItem();
                if (!item) {
                    return;
                }
                const QDateTime when = guardedDueAt->dateTime();
                if (when <= QDateTime::currentDateTime()) {
                    guardedStatus->setText(QStringLiteral("Choose a time in the future."));
                    return;
                }
                runJobAction(QStringLiteral("UpdateScheduledJob"),
                             {item->data(Qt::UserRole).toString(), when.toMSecsSinceEpoch()});
            });
    connect(retryButton, &QPushButton::clicked, dialog,
            [guardedJobs, runJobAction] {
                if (guardedJobs && guardedJobs->currentItem()) {
                    runJobAction(QStringLiteral("RetryScheduledMessage"),
                                 {guardedJobs->currentItem()->data(Qt::UserRole).toString()});
                }
            });
    connect(cancelButton, &QPushButton::clicked, dialog,
            [guardedJobs, runJobAction] {
                if (guardedJobs && guardedJobs->currentItem()) {
                    runJobAction(QStringLiteral("CancelScheduledJob"),
                                 {guardedJobs->currentItem()->data(Qt::UserRole).toString()});
                }
            });
    connect(dismissButton, &QPushButton::clicked, dialog,
            [guardedJobs, runJobAction] {
                if (guardedJobs && guardedJobs->currentItem()) {
                    runJobAction(QStringLiteral("DismissScheduledJob"),
                                 {guardedJobs->currentItem()->data(Qt::UserRole).toString()});
                }
            });
    dialog->show();
    loadJobs();
}

void MainWindow::startDirectChat() {
    bool accepted = false;
    const QString userID = QInputDialog::getText(
        this, QStringLiteral("New direct chat"), QStringLiteral("Matrix user ID"),
        QLineEdit::Normal, {}, &accepted).trimmed();
    if (!accepted || userID.isEmpty()) {
        return;
    }
    directChatButton_->setEnabled(false);
    backend_->call(QStringLiteral("StartDirectChat"), {userID},
                   [this](QJsonValue result, const QString &error) {
                       directChatButton_->setEnabled(true);
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       pendingRoomID_ = result.toString();
                       loadSnapshot();
                   });
}

void MainWindow::createGroupRoom() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Create a group"));
    auto *layout = new QVBoxLayout(dialog);
    auto *form = new QFormLayout;
    auto *name = new QLineEdit(dialog);
    name->setMaxLength(255);
    auto *topic = new QLineEdit(dialog);
    topic->setMaxLength(1000);
    auto *invitees = new QPlainTextEdit(dialog);
    invitees->setPlaceholderText(QStringLiteral("@name:example.org"));
    invitees->setMaximumHeight(80);
    auto *encrypted = new QCheckBox(QStringLiteral("End-to-end encryption"), dialog);
    encrypted->setChecked(true);
    auto *status = new QLabel(dialog);
    auto *buttons = new QHBoxLayout;
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel"), dialog);
    auto *createButton = new QPushButton(QStringLiteral("Create group"), dialog);
    createButton->setEnabled(false);
    form->addRow(QStringLiteral("Name"), name);
    form->addRow(QStringLiteral("Topic (optional)"), topic);
    form->addRow(QStringLiteral("Invite people (optional)"), invitees);
    layout->addLayout(form);
    layout->addWidget(encrypted);
    layout->addWidget(status);
    buttons->addStretch();
    buttons->addWidget(cancelButton);
    buttons->addWidget(createButton);
    layout->addLayout(buttons);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLineEdit> guardedName(name);
    QPointer<QLineEdit> guardedTopic(topic);
    QPointer<QPlainTextEdit> guardedInvitees(invitees);
    QPointer<QCheckBox> guardedEncrypted(encrypted);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QPushButton> guardedCreate(createButton);
    connect(name, &QLineEdit::textChanged, dialog, [guardedName, guardedCreate] {
        if (guardedName && guardedCreate) {
            guardedCreate->setEnabled(!guardedName->text().trimmed().isEmpty());
        }
    });
    connect(cancelButton, &QPushButton::clicked, dialog, &QDialog::reject);
    connect(createButton, &QPushButton::clicked, dialog,
            [this, guardedDialog, guardedName, guardedTopic, guardedInvitees,
             guardedEncrypted, guardedStatus, guardedCreate] {
                if (!guardedDialog || !guardedName || !guardedTopic || !guardedInvitees
                    || !guardedEncrypted || !guardedStatus || !guardedCreate) {
                    return;
                }
                const QString roomName = guardedName->text().trimmed();
                if (roomName.isEmpty()) {
                    guardedStatus->setText(QStringLiteral("Enter a group name."));
                    return;
                }
                QJsonArray userIDs;
                const auto parsedIDs = guardedInvitees->toPlainText().split(
                    QRegularExpression(QStringLiteral("[,;\\s]+")), Qt::SkipEmptyParts);
                for (const auto &userID : parsedIDs) {
                    userIDs.append(userID.trimmed());
                }
                const QJsonObject request{
                    {QStringLiteral("name"), roomName},
                    {QStringLiteral("topic"), guardedTopic->text().trimmed()},
                    {QStringLiteral("invitees"), userIDs},
                    {QStringLiteral("encrypted"), guardedEncrypted->isChecked()},
                };
                guardedCreate->setEnabled(false);
                guardedStatus->setText(QStringLiteral("Creating group…"));
                backend_->call(QStringLiteral("CreateGroupRoom"), {request},
                               [this, guardedDialog, guardedStatus, guardedCreate]
                               (QJsonValue result, const QString &error) {
                                   if (!guardedDialog || !guardedStatus || !guardedCreate) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       guardedCreate->setEnabled(true);
                                       return;
                                   }
                                   pendingRoomID_ = result.toString();
                                   guardedDialog->accept();
                                   loadSnapshot();
                               });
            });
    dialog->show();
    name->setFocus();
}

void MainWindow::showRoomDetails(const QString &roomID) {
    const auto room = roomByID(roomID);
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Room details"));
    dialog->resize(520, 460);
    auto *layout = new QVBoxLayout(dialog);
    const QString roomName = room.value(QStringLiteral("name")).toString(roomID);
    auto *heading = new QLabel(QStringLiteral("%1\n%2")
                                   .arg(roomName, room.value(QStringLiteral("topic")).toString()),
                               dialog);
    heading->setWordWrap(true);
    auto *status = new QLabel(QStringLiteral("Loading members…"), dialog);
    auto *members = new QListWidget(dialog);
    auto *inviteeIDs = new QLineEdit(dialog);
    inviteeIDs->setPlaceholderText(QStringLiteral("@name:example.org"));
    auto *actions = new QHBoxLayout;
    auto *inviteButton = new QPushButton(QStringLiteral("Invite"), dialog);
    auto *leaveButton = new QPushButton(QStringLiteral("Leave room"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    actions->addWidget(inviteButton);
    actions->addWidget(leaveButton);
    actions->addStretch();
    actions->addWidget(closeButton);
    layout->addWidget(heading);
    layout->addWidget(status);
    layout->addWidget(members, 1);
    layout->addWidget(inviteeIDs);
    layout->addLayout(actions);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedMembers(members);
    QPointer<QLineEdit> guardedInviteeIDs(inviteeIDs);
    const auto reloadMembers = [this, roomID, guardedDialog, guardedStatus, guardedMembers] {
        if (!guardedDialog || !guardedStatus || !guardedMembers) {
            return;
        }
        guardedStatus->setText(QStringLiteral("Loading members…"));
        backend_->call(QStringLiteral("RoomMembers"), {roomID},
                       [guardedDialog, guardedStatus, guardedMembers]
                       (QJsonValue value, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedMembers) {
                               return;
                           }
                           guardedMembers->clear();
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                               return;
                           }
                           const auto entries = value.toArray();
                           for (const auto &entry : entries) {
                               const auto member = entry.toObject();
                               const QString id = member.value(QStringLiteral("id")).toString();
                               const QString displayName = member.value(QStringLiteral("displayName")).toString();
                               const QString label = displayName.isEmpty()
                                   ? id : QStringLiteral("%1\n%2").arg(displayName, id);
                               new QListWidgetItem(label, guardedMembers);
                           }
                           guardedStatus->setText(QStringLiteral("%1 members").arg(entries.size()));
                       });
    };
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::close);
    connect(inviteButton, &QPushButton::clicked, dialog,
            [this, roomID, guardedDialog, guardedStatus, guardedInviteeIDs, reloadMembers] {
                if (!guardedDialog || !guardedStatus || !guardedInviteeIDs) {
                    return;
                }
                QJsonArray userIDs;
                const auto parsedIDs = guardedInviteeIDs->text().split(
                    QRegularExpression(QStringLiteral("[,;\\s]+")), Qt::SkipEmptyParts);
                for (const auto &userID : parsedIDs) {
                    userIDs.append(userID.trimmed());
                }
                if (userIDs.isEmpty()) {
                    guardedStatus->setText(QStringLiteral("Enter one or more Matrix user IDs."));
                    return;
                }
                guardedStatus->setText(QStringLiteral("Sending invitations…"));
                backend_->call(QStringLiteral("InviteToRoom"), {roomID, userIDs},
                               [guardedDialog, guardedStatus, guardedInviteeIDs, reloadMembers]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedStatus || !guardedInviteeIDs) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       return;
                                   }
                                   guardedInviteeIDs->clear();
                                   guardedStatus->setText(QStringLiteral("Invitations sent."));
                                   reloadMembers();
                               });
            });
    connect(leaveButton, &QPushButton::clicked, dialog,
            [this, roomID, guardedDialog, guardedStatus] {
                if (!guardedDialog || !guardedStatus) {
                    return;
                }
                if (QMessageBox::question(
                        guardedDialog, QStringLiteral("Leave room"),
                        QStringLiteral("Leave %1?").arg(roomID),
                        QMessageBox::Yes | QMessageBox::No, QMessageBox::No) != QMessageBox::Yes) {
                    return;
                }
                guardedStatus->setText(QStringLiteral("Leaving room…"));
                backend_->call(QStringLiteral("LeaveRoom"), {roomID},
                               [this, roomID, guardedDialog, guardedStatus]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedStatus) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       return;
                                   }
                                   guardedDialog->accept();
                                   if (currentRoomID_ == roomID) {
                                       currentRoomID_.clear();
                                       activeRoomSubscription_.clear();
                                   }
                                   loadSnapshot();
                               });
            });
    dialog->show();
    reloadMembers();
}

void MainWindow::addAccount() {
    bool accepted = false;
    const QString homeserver = QInputDialog::getText(
        this, QStringLiteral("Add Matrix account"), QStringLiteral("Homeserver"),
        QLineEdit::Normal, QStringLiteral("https://matrix.org"), &accepted).trimmed();
    if (!accepted || homeserver.isEmpty()) {
        return;
    }
    const QString username = QInputDialog::getText(
        this, QStringLiteral("Add Matrix account"), QStringLiteral("Username"),
        QLineEdit::Normal, {}, &accepted).trimmed();
    if (!accepted || username.isEmpty()) {
        return;
    }
    const QString password = QInputDialog::getText(
        this, QStringLiteral("Add Matrix account"), QStringLiteral("Password"),
        QLineEdit::Password, {}, &accepted);
    if (!accepted || password.isEmpty()) {
        return;
    }
    addAccountButton_->setEnabled(false);
    backend_->call(QStringLiteral("AddAccount"), {homeserver, username, password},
                   [this](QJsonValue value, const QString &error) {
                       addAccountButton_->setEnabled(true);
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (value.isObject()) {
                           applySnapshot(value.toObject());
                       } else {
                           loadSnapshot();
                       }
                   });
}

void MainWindow::switchAccount(const QString &accountID) {
    if (accountID.isEmpty()
        || accountID == snapshot_.value(QStringLiteral("activeAccountId")).toString()) {
        return;
    }
    backend_->call(QStringLiteral("SwitchAccount"), {accountID},
                   [this](QJsonValue value, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           loadSnapshot();
                           return;
                       }
                       if (value.isObject()) {
                           if (!currentRoomID_.isEmpty()) {
                               roomDrafts_.insert(
                                   roomDraftKey(snapshot_.value(QStringLiteral("activeAccountId"))
                                                    .toString(),
                                                currentRoomID_),
                                   composer_->toPlainText());
                           }
                           ++composerMembersRequestID_;
                           composerMembers_ = {};
                           composerMentionBindings_.clear();
                           hideComposerSuggestions();
                           currentRoomID_.clear();
                           activeRoomSubscription_.clear();
                           composer_->clear();
                           clearComposeContext();
                           applySnapshot(value.toObject());
                       }
                   });
}

void MainWindow::openThread(const QString &rootID) {
    if (currentRoomID_.isEmpty() || rootID.isEmpty()) {
        return;
    }
    const QString roomID = currentRoomID_;
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Thread"));
    dialog->resize(600, 520);
    auto *layout = new QVBoxLayout(dialog);
    auto *status = new QLabel(QStringLiteral("Loading thread…"), dialog);
    auto *threadMessages = new QListWidget(dialog);
    installPrivacyBlurDelegate(threadMessages);
    threadMessages->setWordWrap(true);
    auto *composer = new QPlainTextEdit(dialog);
    composer->setPlaceholderText(QStringLiteral("Reply in thread"));
    composer->setMaximumHeight(100);
    auto *buttonRow = new QHBoxLayout;
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    auto *sendButton = new QPushButton(QStringLiteral("Send reply"), dialog);
    sendButton->setEnabled(false);
    buttonRow->addStretch();
    buttonRow->addWidget(closeButton);
    buttonRow->addWidget(sendButton);
    layout->addWidget(status);
    layout->addWidget(threadMessages, 1);
    layout->addWidget(composer);
    layout->addLayout(buttonRow);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedMessages(threadMessages);
    QPointer<QPlainTextEdit> guardedComposer(composer);
    QPointer<QPushButton> guardedSendButton(sendButton);
    const auto reloadThread = [this, roomID, rootID, guardedDialog, guardedStatus, guardedMessages] {
        if (!guardedDialog || !guardedStatus || !guardedMessages) {
            return;
        }
        guardedStatus->setText(QStringLiteral("Loading thread…"));
        backend_->call(QStringLiteral("ThreadMessages"), {roomID, rootID},
                       [guardedDialog, guardedStatus, guardedMessages, rootID]
                       (QJsonValue value, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedMessages) {
                               return;
                           }
                           guardedMessages->clear();
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                               return;
                           }
                           const auto entries = value.toArray();
                           bool hasRoot = false;
                           for (const auto &entry : entries) {
                               const auto message = entry.toObject();
                               const QString eventID = message.value(QStringLiteral("id")).toString();
                               hasRoot = hasRoot || eventID == rootID;
                               const QString sender = message.value(QStringLiteral("senderName")).toString(
                                   message.value(QStringLiteral("sender")).toString());
                               const qint64 timestamp = static_cast<qint64>(
                                   message.value(QStringLiteral("timestamp")).toDouble());
                               QString display = QStringLiteral("%1  %2\n%3")
                                   .arg(timestamp > 0
                                            ? QDateTime::fromMSecsSinceEpoch(timestamp).toLocalTime()
                                                  .toString(QStringLiteral("yyyy-MM-dd HH:mm"))
                                            : QString(),
                                        sender, message.value(QStringLiteral("body")).toString());
                               const auto reactions = message.value(QStringLiteral("reactions")).toObject();
                               if (!reactions.isEmpty()) {
                                   QStringList labels;
                                   for (auto it = reactions.constBegin(); it != reactions.constEnd(); ++it) {
                                       labels.append(QStringLiteral("%1 %2").arg(it.key()).arg(it.value().toInt()));
                                   }
                                   display += QStringLiteral("\n") + labels.join(QStringLiteral("  "));
                               }
                               new QListWidgetItem(display, guardedMessages);
                           }
                           const qint64 count = qMax<qint64>(0, entries.size() - (hasRoot ? 1 : 0));
                           guardedStatus->setText(hasRoot
                               ? QStringLiteral("%1 replies").arg(count)
                               : QStringLiteral("Original message unavailable · %1 replies").arg(count));
                           guardedMessages->scrollToBottom();
                       });
    };
    connect(composer, &QPlainTextEdit::textChanged, dialog, [guardedComposer, guardedSendButton] {
        if (guardedComposer && guardedSendButton) {
            guardedSendButton->setEnabled(!guardedComposer->toPlainText().trimmed().isEmpty());
        }
    });
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::close);
    connect(sendButton, &QPushButton::clicked, dialog,
            [this, roomID, rootID, guardedDialog, guardedStatus, guardedComposer, guardedSendButton,
             reloadThread] {
                if (!guardedDialog || !guardedStatus || !guardedComposer || !guardedSendButton) {
                    return;
                }
                const QString text = guardedComposer->toPlainText().trimmed();
                if (text.isEmpty()) {
                    return;
                }
                guardedSendButton->setEnabled(false);
                guardedStatus->setText(QStringLiteral("Sending thread reply…"));
                backend_->call(QStringLiteral("SendThreadReply"), {roomID, text, rootID},
                               [guardedDialog, guardedStatus, guardedComposer, guardedSendButton,
                                reloadThread, roomID, this]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedStatus || !guardedComposer
                                       || !guardedSendButton) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       guardedSendButton->setEnabled(
                                           !guardedComposer->toPlainText().trimmed().isEmpty());
                                       return;
                                   }
                                   guardedComposer->clear();
                                   guardedStatus->setText(QStringLiteral("Reply sent."));
                                   reloadThread();
                                   if (currentRoomID_ == roomID) {
                                       loadHistory(roomID);
                                   }
                               });
            });
    dialog->show();
    composer->setFocus();
    reloadThread();
}

void MainWindow::showDevices() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Manage Matrix devices"));
    dialog->resize(520, 400);
    auto *layout = new QVBoxLayout(dialog);
    auto *status = new QLabel(QStringLiteral("Loading devices…"), dialog);
    auto *devices = new QListWidget(dialog);
    auto *revokeButton = new QPushButton(QStringLiteral("Revoke selected device"), dialog);
    revokeButton->setEnabled(false);
    layout->addWidget(status);
    layout->addWidget(devices, 1);
    layout->addWidget(revokeButton);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedDevices(devices);
    QPointer<QPushButton> guardedRevokeButton(revokeButton);
    connect(devices, &QListWidget::currentItemChanged, dialog,
            [guardedRevokeButton](QListWidgetItem *item, QListWidgetItem *) {
                if (guardedRevokeButton) {
                    guardedRevokeButton->setEnabled(
                        item && !item->data(Qt::UserRole + 1).toBool());
                }
            });
    connect(revokeButton, &QPushButton::clicked, dialog,
            [this, guardedDialog, guardedStatus, guardedDevices, guardedRevokeButton] {
                if (!guardedDialog || !guardedStatus || !guardedDevices || !guardedRevokeButton) {
                    return;
                }
                auto *selected = guardedDevices->currentItem();
                if (!selected || selected->data(Qt::UserRole + 1).toBool()) {
                    return;
                }
                const QString deviceID = selected->data(Qt::UserRole).toString();
                if (QMessageBox::question(
                        guardedDialog, QStringLiteral("Revoke Matrix device"),
                        QStringLiteral("Revoke device %1? It will be signed out.").arg(deviceID),
                        QMessageBox::Yes | QMessageBox::No, QMessageBox::No) != QMessageBox::Yes) {
                    return;
                }
                bool accepted = false;
                const QString password = QInputDialog::getText(
                    guardedDialog, QStringLiteral("Confirm device revocation"),
                    QStringLiteral("Matrix account password"), QLineEdit::Password, {}, &accepted);
                if (!accepted) {
                    return;
                }
                if (password.isEmpty()) {
                    guardedStatus->setText(QStringLiteral("A non-empty account password is required."));
                    return;
                }
                guardedRevokeButton->setEnabled(false);
                guardedStatus->setText(QStringLiteral("Revoking device…"));
                backend_->call(QStringLiteral("RevokeDevice"), {deviceID, password},
                               [guardedDialog, guardedStatus, guardedDevices, guardedRevokeButton, deviceID]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedStatus || !guardedDevices
                                       || !guardedRevokeButton) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       const auto *selectedItem = guardedDevices->currentItem();
                                       guardedRevokeButton->setEnabled(
                                           selectedItem && !selectedItem->data(Qt::UserRole + 1).toBool());
                                       return;
                                   }
                                   for (int index = 0; index < guardedDevices->count(); ++index) {
                                       auto *item = guardedDevices->item(index);
                                       if (item->data(Qt::UserRole).toString() == deviceID) {
                                           delete guardedDevices->takeItem(index);
                                           break;
                                       }
                                   }
                                   guardedStatus->setText(QStringLiteral("Device revoked."));
                                   const auto *selectedItem = guardedDevices->currentItem();
                                   guardedRevokeButton->setEnabled(
                                       selectedItem && !selectedItem->data(Qt::UserRole + 1).toBool());
                               });
            });
    backend_->call(QStringLiteral("Devices"), {},
                   [guardedDialog, guardedStatus, guardedDevices, guardedRevokeButton]
                   (QJsonValue value, const QString &error) {
                       if (!guardedDialog || !guardedStatus || !guardedDevices || !guardedRevokeButton) {
                           return;
                       }
                       if (!error.isEmpty()) {
                           guardedStatus->setText(error);
                           return;
                       }
                       const auto devicesArray = value.toArray();
                       for (const auto &entry : devicesArray) {
                           const auto device = entry.toObject();
                           const QString id = device.value(QStringLiteral("id")).toString();
                           const QString name = device.value(QStringLiteral("displayName")).toString();
                           QString label = name.isEmpty() ? QStringLiteral("Unnamed device") : name;
                           label += device.value(QStringLiteral("current")).toBool()
                               ? QStringLiteral(" (this device)") : QString();
                           QStringList details;
                           const qint64 lastSeen = static_cast<qint64>(
                               device.value(QStringLiteral("lastSeenAt")).toDouble());
                           if (lastSeen > 0) {
                               details.append(QStringLiteral("Last seen: %1").arg(
                                   QDateTime::fromMSecsSinceEpoch(lastSeen).toLocalTime()
                                       .toString(QStringLiteral("yyyy-MM-dd HH:mm"))));
                           } else {
                               details.append(QStringLiteral("Last seen: unknown"));
                           }
                           const QString ip = device.value(QStringLiteral("lastSeenIp")).toString();
                           if (!ip.isEmpty()) {
                               details.append(QStringLiteral("IP: %1").arg(ip));
                           }
                           auto *item = new QListWidgetItem(
                               QStringLiteral("%1\n%2\nDevice ID: %3")
                                   .arg(label, details.join(QStringLiteral(" · ")), id),
                               guardedDevices);
                           item->setData(Qt::UserRole, id);
                           item->setData(Qt::UserRole + 1, device.value(QStringLiteral("current")));
                       }
                       guardedStatus->setText(devicesArray.isEmpty()
                           ? QStringLiteral("No Matrix devices were returned.")
                           : QStringLiteral("%1 devices").arg(devicesArray.size()));
                       const auto *selected = guardedDevices->currentItem();
                       guardedRevokeButton->setEnabled(
                           selected && !selected->data(Qt::UserRole + 1).toBool());
                   });
    dialog->show();
}

void MainWindow::searchMessages() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle(QStringLiteral("Search messages"));
    dialog->resize(640, 480);
    auto *layout = new QVBoxLayout(dialog);
    auto *query = new QLineEdit(dialog);
    query->setPlaceholderText(QStringLiteral("Search current account's local history"));
    auto *sender = new QLineEdit(dialog);
    sender->setPlaceholderText(QStringLiteral("Filter by Matrix user ID (optional)"));
    auto *searchButton = new QPushButton(QStringLiteral("Search"), dialog);
    auto *loadMoreButton = new QPushButton(QStringLiteral("Load more"), dialog);
    loadMoreButton->setEnabled(false);
    auto *status = new QLabel(dialog);
    auto *results = new QListWidget(dialog);
    installPrivacyBlurDelegate(results);
    layout->addWidget(query);
    layout->addWidget(sender);
    layout->addWidget(searchButton);
    layout->addWidget(loadMoreButton);
    layout->addWidget(status);
    layout->addWidget(results, 1);
    connect(query, &QLineEdit::returnPressed, searchButton, &QPushButton::click);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLineEdit> guardedQuery(query);
    QPointer<QLineEdit> guardedSender(sender);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedResults(results);
    QPointer<QPushButton> guardedSearchButton(searchButton);
    QPointer<QPushButton> guardedLoadMoreButton(loadMoreButton);
    auto nextBatch = std::make_shared<QString>();
    auto lastQuery = std::make_shared<QString>();
    auto lastSender = std::make_shared<QString>();
    const auto requestSearch = [this, guardedDialog, guardedStatus, guardedResults,
                                guardedSearchButton, guardedLoadMoreButton, nextBatch]
                               (const QString &text, const QString &senderID,
                                const QString &batch, bool clearResults) {
        if (!guardedDialog || !guardedStatus || !guardedResults
            || !guardedSearchButton || !guardedLoadMoreButton) {
            return;
        }
        guardedSearchButton->setEnabled(false);
        guardedLoadMoreButton->setEnabled(false);
        if (clearResults) {
            guardedResults->clear();
            *nextBatch = QString();
        }
        guardedStatus->setText(QStringLiteral("Searching local history…"));
        const QJsonObject request{
            {QStringLiteral("query"), text},
            {QStringLiteral("roomID"), QString()},
            {QStringLiteral("sender"), senderID},
            {QStringLiteral("minTimestamp"), 0},
            {QStringLiteral("maxTimestamp"), 0},
            {QStringLiteral("limit"), 50},
            {QStringLiteral("nextBatch"), batch},
        };
        backend_->call(QStringLiteral("SearchMessages"), {request},
                       [this, guardedDialog, guardedStatus, guardedResults, guardedSearchButton,
                        guardedLoadMoreButton, nextBatch]
                       (QJsonValue value, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedResults
                               || !guardedSearchButton || !guardedLoadMoreButton) {
                               return;
                           }
                           guardedSearchButton->setEnabled(true);
                           if (!error.isEmpty()) {
                               guardedLoadMoreButton->setEnabled(!nextBatch->isEmpty());
                               guardedStatus->setText(error);
                               return;
                           }
                           const auto page = value.toObject();
                           const auto entries = page.value(QStringLiteral("results")).toArray();
                           for (const auto &entry : entries) {
                               const auto result = entry.toObject();
                               const auto message = result.value(QStringLiteral("message")).toObject();
                               const auto room = roomByID(result.value(QStringLiteral("roomID")).toString());
                               const QString roomName = room.value(QStringLiteral("name")).toString(
                                   result.value(QStringLiteral("roomID")).toString());
                               const QString senderName = message.value(QStringLiteral("senderName")).toString(
                                   message.value(QStringLiteral("sender")).toString());
                               auto *item = new QListWidgetItem(
                                   QStringLiteral("%1 — %2: %3").arg(roomName, senderName,
                                       message.value(QStringLiteral("body")).toString()),
                                   guardedResults);
                               item->setData(Qt::UserRole,
                                             QString::fromUtf8(QJsonDocument(result).toJson(QJsonDocument::Compact)));
                           }
                           *nextBatch = page.value(QStringLiteral("nextBatch")).toString();
                           guardedLoadMoreButton->setEnabled(!nextBatch->isEmpty());
                           guardedStatus->setText(guardedResults->count() == 0
                               ? QStringLiteral("No matching messages in local history.")
                               : QStringLiteral("%1 results").arg(guardedResults->count()));
                       });
    };
    connect(searchButton, &QPushButton::clicked, dialog,
            [guardedQuery, guardedSender, guardedStatus, lastQuery, lastSender, requestSearch] {
                if (!guardedQuery || !guardedSender || !guardedStatus) {
                    return;
                }
                *lastQuery = guardedQuery->text().trimmed();
                *lastSender = guardedSender->text().trimmed();
                if (lastQuery->isEmpty()) {
                    guardedStatus->setText(QStringLiteral("Enter a search term."));
                    return;
                }
                requestSearch(*lastQuery, *lastSender, QString(), true);
            });
    connect(loadMoreButton, &QPushButton::clicked, dialog,
            [nextBatch, lastQuery, lastSender, requestSearch] {
                if (!nextBatch->isEmpty()) {
                    requestSearch(*lastQuery, *lastSender, *nextBatch, false);
                }
            });
    connect(results, &QListWidget::itemDoubleClicked, dialog,
            [this, guardedDialog](QListWidgetItem *item) {
                if (!guardedDialog || !item) {
                    return;
                }
                const auto document = QJsonDocument::fromJson(item->data(Qt::UserRole).toString().toUtf8());
                if (!document.isObject()) {
                    showError(QStringLiteral("The selected search result is invalid."));
                    return;
                }
                const auto result = document.object();
                const QString roomID = result.value(QStringLiteral("roomID")).toString();
                const auto message = result.value(QStringLiteral("message")).toObject();
                const auto room = roomByID(roomID);
                roomFilter_->clear();
                roomScope_->setCurrentIndex(roomScope_->findData(
                    roomIsArchived(room) ? QStringLiteral("archived") : QStringLiteral("all")));
                bool roomFound = false;
                for (int index = 0; index < rooms_->count(); ++index) {
                    auto *roomItem = rooms_->item(index);
                    if (roomItem->data(Qt::UserRole).toString() == roomID) {
                        rooms_->setCurrentItem(roomItem);
                        roomFound = true;
                        break;
                    }
                }
                if (!roomFound) {
                    showError(QStringLiteral("The room for this search result is no longer available."));
                    guardedDialog->close();
                    return;
                }
                const qint64 cursor = static_cast<qint64>(
                    message.value(QStringLiteral("timelineCursor")).toDouble());
                loadHistory(roomID, cursor > 0 ? cursor + 1 : 0);
                guardedDialog->close();
            });
    dialog->show();
    query->setFocus();
}

void MainWindow::runRoomAction(const QString &method, const QJsonArray &params) {
    if (method == QStringLiteral("MarkUnread") && !params.isEmpty()) {
        readRequests_.remove(params.at(0).toString());
    }
    backend_->call(method, params, [this](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            showError(error);
            return;
        }
        loadSnapshot();
    });
}

QJsonObject MainWindow::roomByID(const QString &roomID) const {
    for (const auto &value : snapshot_.value(QStringLiteral("rooms")).toArray()) {
        const auto room = value.toObject();
        if (room.value(QStringLiteral("id")).toString() == roomID) {
            return room;
        }
    }
    for (const auto &value : otherAccountRooms_) {
        const auto room = value.toObject();
        if (room.value(QStringLiteral("id")).toString() == roomID) {
            return room;
        }
    }
    return {};
}

bool MainWindow::roomIsArchived(const QJsonObject &room) const {
    return preferences_.value(archivePreferenceKey(room)).toBool();
}

QString MainWindow::archivePreferenceKey(const QJsonObject &room) const {
    QString accountID = room.value(QStringLiteral("accountId")).toString();
    if (accountID.isEmpty()) {
        accountID = snapshot_.value(QStringLiteral("activeAccountId")).toString();
    }
    if (accountID.isEmpty()) {
        accountID = QStringLiteral("primary");
    }
    return QStringLiteral("room.archived.%1.%2")
        .arg(accountID, room.value(QStringLiteral("id")).toString());
}

void MainWindow::showError(const QString &message) {
    if (message.isEmpty()) {
        return;
    }
    statusBar()->showMessage(message, 10000);
}

// ---- Backend call wrappers ----

void MainWindow::callSnapshot() {
    backend_->call(QStringLiteral("Snapshot"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           applySnapshot(result.toObject());
                       }
                   });
}

void MainWindow::callLogin(const QString &homeserver, const QString &username, const QString &password) {
    backend_->call(QStringLiteral("Login"), {homeserver, username, password},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callVerify(const QString &recoveryKey) {
    backend_->call(QStringLiteral("Verify"), {recoveryKey},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callLogout() {
    backend_->call(QStringLiteral("Logout"), {},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callAcceptInvite(const QString &roomID) {
    backend_->call(QStringLiteral("AcceptInvite"), {roomID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callDeclineInvite(const QString &roomID) {
    backend_->call(QStringLiteral("DeclineInvite"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSwitchAccount(const QString &accountID) {
    backend_->call(QStringLiteral("SwitchAccount"), {accountID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           loadSnapshot();
                           return;
                       }
                       if (result.isObject()) {
                           if (!currentRoomID_.isEmpty()) {
                               roomDrafts_.insert(
                                   roomDraftKey(snapshot_.value(QStringLiteral("activeAccountId"))
                                                    .toString(),
                                                currentRoomID_),
                                   composer_->toPlainText());
                           }
                           currentRoomID_.clear();
                           activeRoomSubscription_.clear();
                           composer_->clear();
                           clearComposeContext();
                           applySnapshot(result.toObject());
                       }
                   });
}

void MainWindow::callAddAccount(const QString &homeserver, const QString &username, const QString &password) {
    backend_->call(QStringLiteral("AddAccount"), {homeserver, username, password},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           applySnapshot(result.toObject());
                       } else {
                           loadSnapshot();
                       }
                   });
}

void MainWindow::callJoinRoom(const QString &target) {
    backend_->call(QStringLiteral("JoinRoom"), {target},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString() && !result.toString().isEmpty()) {
                           pendingRoomID_ = result.toString();
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callStartDirectChat(const QString &userID) {
    backend_->call(QStringLiteral("StartDirectChat"), {userID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           pendingRoomID_ = result.toString();
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callCreateGroupRoom(const QJsonObject &request) {
    QJsonArray params;
    params.append(request);
    backend_->call(QStringLiteral("CreateGroupRoom"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           pendingRoomID_ = result.toString();
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callLeaveRoom(const QString &roomID) {
    backend_->call(QStringLiteral("LeaveRoom"), {roomID},
                   [this, roomID](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (currentRoomID_ == roomID) {
                           currentRoomID_.clear();
                           activeRoomSubscription_.clear();
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSetActiveRoom(const QString &roomID) {
    backend_->call(QStringLiteral("SetActiveRoom"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callHistory(const QString &roomID, qint64 before) {
    backend_->call(QStringLiteral("History"), {roomID, before},
                   [this, roomID, before](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto page = result.toObject();
                           const auto messages = page.value(QStringLiteral("messages")).toArray();
                           messages_->clear();
                           messagesByID_.clear();
                           for (const auto &entry : messages) {
                               const auto message = entry.toObject();
                               const auto eventID = message.value(QStringLiteral("id")).toString();
                               if (!eventID.isEmpty()) {
                                   messagesByID_.insert(eventID, message);
                               }
                               const auto sender = message.value(QStringLiteral("senderName")).toString(
                                   message.value(QStringLiteral("sender")).toString());
                               const auto body = message.value(QStringLiteral("body")).toString();
                               const auto timestamp = QDateTime::fromMSecsSinceEpoch(
                                   static_cast<qint64>(message.value(QStringLiteral("timestamp")).toDouble()));
                               QString display = QStringLiteral("%1  %2\n%3")
                                   .arg(timestamp.toLocalTime().toString(QStringLiteral("HH:mm")),
                                        sender, body);
                               auto *item = new QListWidgetItem(display, messages_);
                               item->setData(Qt::UserRole, eventID);
                               item->setData(Qt::UserRole + 1, message.toVariantMap());
                               requestAvatar(message.value(QStringLiteral("avatar")).toString());
                           }
                           smoothScrollToBottom(messages_, 0);
                       }
                   });
}

void MainWindow::callMarkRead(const QString &roomID, const QString &eventID) {
    backend_->call(QStringLiteral("MarkRead"), {roomID, eventID},
                   [this, roomID, eventID](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       readRequests_.insert(roomID, eventID);
                   });
}

void MainWindow::callMarkUnread(const QString &roomID) {
    backend_->call(QStringLiteral("MarkUnread"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSendMessage(const QString &roomID, const QString &text) {
    backend_->call(QStringLiteral("SendMessage"), {roomID, text},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callSendMessageWithMentions(const QString &roomID, const QString &text, const QStringList &userIDs) {
    QJsonArray params;
    params.append(roomID);
    params.append(text);
    QJsonArray userArray;
    for (const auto &uid : userIDs) {
        userArray.append(uid);
    }
    params.append(userArray);
    backend_->call(QStringLiteral("SendMessageWithMentions"), params,
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callSendReply(const QString &roomID, const QString &text, const QString &replyTo) {
    backend_->call(QStringLiteral("SendReply"), {roomID, text, replyTo},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callThreadMessages(const QString &roomID, const QString &rootID) {
    backend_->call(QStringLiteral("ThreadMessages"), {roomID, rootID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto entries = result.toArray();
                           for (const auto &entry : entries) {
                               const auto message = entry.toObject();
                               const auto eventID = message.value(QStringLiteral("id")).toString();
                               if (!eventID.isEmpty()) {
                                   messagesByID_.insert(eventID, message);
                               }
                           }
                       }
                   });
}

void MainWindow::callSendThreadReply(const QString &roomID, const QString &text, const QString &rootID) {
    backend_->call(QStringLiteral("SendThreadReply"), {roomID, text, rootID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callEditMessage(const QString &roomID, const QString &text, const QString &eventID) {
    backend_->call(QStringLiteral("EditMessage"), {roomID, text, eventID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       clearComposeContext();
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callReact(const QString &roomID, const QString &eventID, const QString &emoji) {
    backend_->call(QStringLiteral("React"), {roomID, eventID, emoji},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callRemoveReaction(const QString &roomID, const QString &eventID, const QString &emoji) {
    backend_->call(QStringLiteral("RemoveReaction"), {roomID, eventID, emoji},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callRedactMessage(const QString &roomID, const QString &eventID) {
    backend_->call(QStringLiteral("RedactMessage"), {roomID, eventID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callRetryMessage(const QString &transactionID) {
    backend_->call(QStringLiteral("RetryMessage"), {transactionID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callSetTyping(const QString &roomID, qint64 timeoutMilliseconds) {
    backend_->call(QStringLiteral("SetTyping"), {roomID, timeoutMilliseconds},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callSetBooleanPreference(const QString &key, bool value) {
    backend_->call(QStringLiteral("SetBooleanPreference"), {key, value},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSetStringPreference(const QString &key, const QString &value) {
    backend_->call(QStringLiteral("SetStringPreference"), {key, value},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSetStringPreferences(const QJsonObject &values) {
    QJsonArray params;
    params.append(values);
    backend_->call(QStringLiteral("SetStringPreferences"), params,
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callDevices() {
    backend_->call(QStringLiteral("Devices"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto devices = result.toArray();
                           for (const auto &entry : devices) {
                               const auto device = entry.toObject();
                               // Devices dialog handles its own Devices call
                           }
                       }
                   });
}

void MainWindow::callRevokeDevice(const QString &deviceID, const QString &password) {
    backend_->call(QStringLiteral("RevokeDevice"), {deviceID, password},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callRoomMembers(const QString &roomID) {
    backend_->call(QStringLiteral("RoomMembers"), {roomID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       // Room details dialog handles its own RoomMembers call
                   });
}

void MainWindow::callInviteToRoom(const QString &roomID, const QStringList &userIDs) {
    QJsonArray params;
    params.append(roomID);
    QJsonArray userArray;
    for (const auto &uid : userIDs) {
        userArray.append(uid);
    }
    params.append(userArray);
    backend_->call(QStringLiteral("InviteToRoom"), params,
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSearchMessages(const QString &query, const QString &roomID, const QString &sender,
                                    qint64 minTs, qint64 maxTs, int limit, const QString &nextBatch) {
    QJsonObject request;
    request[QStringLiteral("query")] = query;
    request[QStringLiteral("roomID")] = roomID;
    request[QStringLiteral("sender")] = sender;
    request[QStringLiteral("minTimestamp")] = minTs;
    request[QStringLiteral("maxTimestamp")] = maxTs;
    request[QStringLiteral("limit")] = limit;
    request[QStringLiteral("nextBatch")] = nextBatch;
    QJsonArray params;
    params.append(request);
    backend_->call(QStringLiteral("SearchMessages"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto page = result.toObject();
                           const auto results = page.value(QStringLiteral("results")).toArray();
                           for (const auto &entry : results) {
                               const auto item = entry.toObject();
                               const auto roomID = item.value(QStringLiteral("roomID")).toString();
                               const auto message = item.value(QStringLiteral("message")).toObject();
                               // Search dialog handles its own results display
                           }
                       }
                   });
}

void MainWindow::callURLPreview(const QString &link) {
    backend_->call(QStringLiteral("URLPreview"), {link},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto preview = result.toObject();
                           // URL preview result handled by caller
                       }
                   });
}

void MainWindow::callOpenExternalURL(const QString &url) {
    backend_->call(QStringLiteral("OpenExternalURL"), {url},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callRevealFile(const QString &path) {
    backend_->call(QStringLiteral("RevealFile"), {path},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callSaveMedia(const QString &mxc, const QString &filename) {
    backend_->call(QStringLiteral("SaveMedia"), {mxc, filename},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString() && !result.toString().isEmpty()) {
                           statusBar()->showMessage(QStringLiteral("Saved to %1").arg(result.toString()), 8000);
                       }
                   });
}

void MainWindow::callExportRoomChat(const QString &roomID, const QString &parentDirectory) {
    backend_->call(QStringLiteral("ExportRoomChat"), {roomID, parentDirectory},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto res = result.toObject();
                           const auto path = res.value(QStringLiteral("path")).toString();
                           const auto messages = res.value(QStringLiteral("messages")).toInt();
                           statusBar()->showMessage(
                               QStringLiteral("Exported %1 messages to %2").arg(messages).arg(path), 10000);
                       }
                   });
}

void MainWindow::callCancelChatExport() {
    backend_->call(QStringLiteral("CancelChatExport"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       const bool cancelled = result.isBool() && result.toBool();
                       statusBar()->showMessage(
                           cancelled ? QStringLiteral("Chat export cancelled.")
                                     : QStringLiteral("No chat export running."), 8000);
                   });
}

void MainWindow::callExportRecentMessagesForAllChats(const QString &parentDirectory, int limit,
                                                     const QJsonObject &options) {
    QJsonArray params;
    params.append(parentDirectory);
    params.append(limit);
    params.append(options);
    backend_->call(QStringLiteral("ExportRecentMessagesForAllChats"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto res = result.toObject();
                           const auto chats = res.value(QStringLiteral("chats")).toInt();
                           const auto messages = res.value(QStringLiteral("messages")).toInt();
                           const auto failed = res.value(QStringLiteral("failed")).toInt();
                           const auto cancelled = res.value(QStringLiteral("cancelled")).toBool();
                           statusBar()->showMessage(
                               QStringLiteral("Bulk export: %1 chats, %2 messages, %3 failed%4")
                                   .arg(chats).arg(messages).arg(failed)
                                   .arg(cancelled ? QStringLiteral(" (cancelled)") : QString()), 10000);
                       }
                   });
}

void MainWindow::callScheduledJobs() {
    backend_->call(QStringLiteral("ScheduledJobs"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto jobs = result.toArray();
                           // Scheduled jobs dialog handles its own display
                       }
                   });
}

void MainWindow::callScheduleMessage(const QString &roomID, const QString &text, qint64 dueAt) {
    backend_->call(QStringLiteral("ScheduleMessage"), {roomID, text, dueAt},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callScheduleReply(const QString &roomID, const QString &text, const QString &replyTo, qint64 dueAt) {
    backend_->call(QStringLiteral("ScheduleReply"), {roomID, text, replyTo, dueAt},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callScheduleReminder(const QString &roomID, const QString &eventID, const QString &text, qint64 dueAt) {
    backend_->call(QStringLiteral("ScheduleReminder"), {roomID, eventID, text, dueAt},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callUpdateScheduledJob(const QString &id, qint64 dueAt) {
    backend_->call(QStringLiteral("UpdateScheduledJob"), {id, dueAt},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callCancelScheduledJob(const QString &id) {
    backend_->call(QStringLiteral("CancelScheduledJob"), {id},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callRetryScheduledMessage(const QString &id) {
    backend_->call(QStringLiteral("RetryScheduledMessage"), {id},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callDismissScheduledJob(const QString &id) {
    backend_->call(QStringLiteral("DismissScheduledJob"), {id},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callAIComplete(const QJsonArray &messages, const QString &requestID, double temperature, int maxTokens) {
    QJsonArray params;
    params.append(messages);
    params.append(requestID);
    params.append(temperature);
    params.append(maxTokens);
    backend_->call(QStringLiteral("AIComplete"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           // AI result handled by caller
                       }
                   });
}

void MainWindow::callAICancel(const QString &requestID) {
    backend_->call(QStringLiteral("AICancel"), {requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       const bool cancelled = result.isBool() && result.toBool();
                       statusBar()->showMessage(
                           cancelled ? QStringLiteral("AI request cancelled.") : QStringLiteral("No AI request running."), 8000);
                   });
}

void MainWindow::callAISuggestReplies(const QString &roomID, const QString &requestID) {
    backend_->call(QStringLiteral("AISuggestReplies"), {roomID, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto replies = result.toObject();
                           // AI suggestions handled by caller
                       }
                   });
}

void MainWindow::callAIGenerateReplyDraft(const QString &roomID, const QString &requestID) {
    backend_->call(QStringLiteral("AIGenerateReplyDraft"), {roomID, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto draft = result.toString();
                           if (!draft.isEmpty() && !currentRoomID_.isEmpty()) {
                               composer_->setPlainText(draft);
                               setComposeContext(QStringLiteral("AI-generated reply draft"));
                           }
                       }
                   });
}

void MainWindow::callAIDetectChatLanguage(const QString &roomID, const QString &requestID) {
    backend_->call(QStringLiteral("AIDetectChatLanguage"), {roomID, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto lang = result.toString();
                           statusBar()->showMessage(QStringLiteral("Detected language: %1").arg(lang), 8000);
                       }
                   });
}

void MainWindow::callAITranscribeMedia(const QString &mxcURI, const QString &filename, const QString &contentType) {
    backend_->call(QStringLiteral("AITranscribeMedia"), {mxcURI, filename, contentType},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto transcription = result.toString();
                           statusBar()->showMessage(QStringLiteral("Transcription: %1").arg(transcription), 10000);
                       }
                   });
}

void MainWindow::callTestAIEndpoint() {
    backend_->call(QStringLiteral("TestAIEndpoint"), {},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(QStringLiteral("AI endpoint test failed: %1").arg(error));
                           return;
                       }
                       statusBar()->showMessage(QStringLiteral("AI endpoint is reachable."), 8000);
                   });
}

void MainWindow::callCheckMessageTone(const QJsonArray &messages) {
    QJsonArray params;
    params.append(messages);
    backend_->call(QStringLiteral("CheckMessageTone"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto tone = result.toString();
                           statusBar()->showMessage(QStringLiteral("Message tone: %1").arg(tone), 8000);
                       }
                   });
}

void MainWindow::callAIFeatureDefaults() {
    backend_->call(QStringLiteral("AIFeatureDefaults"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto features = result.toArray();
                           // AI feature defaults handled by caller
                       }
                   });
}

void MainWindow::callLanguageTutorAnalyze(const QString &text, const QString &mode, const QString &learning,
                                          const QString &explanation, const QString &requestID) {
    backend_->call(QStringLiteral("Analyze"), {text, mode, learning, explanation, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto analysis = result.toObject();
                           // Language tutor analysis handled by caller
                       }
                   });
}

void MainWindow::callListLocalAIChats() {
    backend_->call(QStringLiteral("ListLocalAIChats"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto chats = result.toArray();
                           // Local AI chat list handled by caller
                       }
                   });
}

void MainWindow::callCreateLocalAIChat(const QString &agentID, const QString &kind) {
    backend_->call(QStringLiteral("CreateLocalAIChat"), {agentID, kind},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           // New local AI chat created
                       }
                   });
}

void MainWindow::callDeleteLocalAIChat(const QString &chatID) {
    backend_->call(QStringLiteral("DeleteLocalAIChat"), {chatID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callLoadLocalAIChatMessages(const QString &chatID) {
    backend_->call(QStringLiteral("LoadLocalAIChatMessages"), {chatID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto messages = result.toArray();
                           // Local AI chat messages handled by caller
                       }
                   });
}

void MainWindow::callAppendLocalAIChatMessage(const QString &chatID, const QJsonObject &message) {
    QJsonArray params;
    params.append(chatID);
    params.append(message);
    backend_->call(QStringLiteral("AppendLocalAIChatMessage"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           // Message appended
                       }
                   });
}

void MainWindow::callTruncateLocalAIChat(const QString &chatID, int fromSeq) {
    backend_->call(QStringLiteral("TruncateLocalAIChat"), {chatID, fromSeq},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callRenameLocalAIChat(const QString &chatID, const QString &title) {
    backend_->call(QStringLiteral("RenameLocalAIChat"), {chatID, title},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callSetLocalAIChatAgent(const QString &chatID, const QString &agentID) {
    backend_->call(QStringLiteral("SetLocalAIChatAgent"), {chatID, agentID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callSetLocalAIChatFolder(const QString &chatID, const QString &folderID) {
    backend_->call(QStringLiteral("SetLocalAIChatFolder"), {chatID, folderID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callListLocalAIChatFolders() {
    backend_->call(QStringLiteral("ListLocalAIChatFolders"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto folders = result.toArray();
                           // Local AI chat folders handled by caller
                       }
                   });
}

void MainWindow::callCreateLocalAIChatFolder(const QString &name) {
    backend_->call(QStringLiteral("CreateLocalAIChatFolder"), {name},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           // Folder created
                       }
                   });
}

void MainWindow::callRenameLocalAIChatFolder(const QString &folderID, const QString &name) {
    backend_->call(QStringLiteral("RenameLocalAIChatFolder"), {folderID, name},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callDeleteLocalAIChatFolder(const QString &folderID) {
    backend_->call(QStringLiteral("DeleteLocalAIChatFolder"), {folderID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callExportLocalAIChat(const QString &filename, const QString &content) {
    backend_->call(QStringLiteral("ExportLocalAIChat"), {filename, content},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString() && !result.toString().isEmpty()) {
                           statusBar()->showMessage(QStringLiteral("Exported to %1").arg(result.toString()), 8000);
                       }
                   });
}

void MainWindow::callLocalAIChatGenerateImage(const QString &chatID, const QString &prompt, const QString &requestID) {
    backend_->call(QStringLiteral("LocalAIChatGenerateImage"), {chatID, prompt, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           // Image generated and added to chat
                       }
                   });
}

void MainWindow::callGenerateRoomImage(const QString &prompt, const QString &requestID) {
    backend_->call(QStringLiteral("GenerateRoomImage"), {prompt, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto imageData = result.toString();
                           // Generated image data handled by caller
                       }
                   });
}

void MainWindow::callDataLocation() {
    backend_->call(QStringLiteral("DataLocation"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto loc = result.toObject();
                           const auto dataDir = loc.value(QStringLiteral("dataDir")).toString();
                           const auto defaultDir = loc.value(QStringLiteral("defaultDir")).toString();
                           const auto mediaCacheDir = loc.value(QStringLiteral("mediaCacheDir")).toString();
                           statusBar()->showMessage(
                               QStringLiteral("Data: %1 | Media: %2").arg(dataDir).arg(mediaCacheDir), 10000);
                       }
                   });
}

void MainWindow::callChooseDataFolder() {
    backend_->call(QStringLiteral("ChooseDataFolder"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto folder = result.toString();
                           if (!folder.isEmpty()) {
                               callSetDataFolder(folder);
                           }
                       }
                   });
}

void MainWindow::callSetDataFolder(const QString &path) {
    backend_->call(QStringLiteral("SetDataFolder"), {path},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           statusBar()->showMessage(QStringLiteral("Data folder will move on restart."), 8000);
                       }
                   });
}

void MainWindow::callUseDefaultDataFolder() {
    backend_->call(QStringLiteral("UseDefaultDataFolder"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           statusBar()->showMessage(QStringLiteral("Using default data folder."), 8000);
                       }
                   });
}

void MainWindow::callRestartApp() {
    backend_->call(QStringLiteral("RestartApp"), {},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       close();
                   });
}

void MainWindow::callCheckForUpdates() {
    backend_->call(QStringLiteral("CheckForUpdates"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto status = result.toObject();
                           const auto available = status.value(QStringLiteral("updateAvailable")).toBool();
                           const auto latest = status.value(QStringLiteral("latestVersion")).toString();
                           const auto message = status.value(QStringLiteral("message")).toString();
                           if (available) {
                               statusBar()->showMessage(
                                   QStringLiteral("Update available: %1 - %2").arg(latest).arg(message), 10000);
                           } else {
                               statusBar()->showMessage(message, 8000);
                           }
                       }
                   });
}

void MainWindow::callAppVersion() {
    backend_->call(QStringLiteral("AppVersion"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           statusBar()->showMessage(QStringLiteral("Version: %1").arg(result.toString()), 8000);
                       }
                   });
}

void MainWindow::callAppBuildInfo() {
    backend_->call(QStringLiteral("AppBuildInfo"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto info = result.toObject();
                           const auto commit = info.value(QStringLiteral("commit")).toString();
                           const auto buildDate = info.value(QStringLiteral("buildDate")).toString();
                           statusBar()->showMessage(
                               QStringLiteral("Commit: %1 | Built: %2").arg(commit).arg(buildDate), 8000);
                       }
                   });
}

void MainWindow::callStorageUsage() {
    backend_->call(QStringLiteral("StorageUsage"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto usage = result.toObject();
                           const qint64 database = static_cast<qint64>(
                               usage.value(QStringLiteral("databaseBytes")).toDouble());
                           const qint64 wal = static_cast<qint64>(
                               usage.value(QStringLiteral("walBytes")).toDouble());
                           statusBar()->showMessage(
                               QStringLiteral("Database: %1 bytes · WAL: %2 bytes").arg(database).arg(wal), 8000);
                       }
                   });
}

void MainWindow::callRoomStorageUsage(const QString &roomID) {
    backend_->call(QStringLiteral("RoomStorageUsage"), {},
                   [this, roomID](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           qint64 textBytes = 0;
                           qint64 mediaBytes = 0;
                           int messages = 0;
                           for (const auto &entry : result.toArray()) {
                               const auto usage = entry.toObject();
                               if (!roomID.isEmpty()
                                   && usage.value(QStringLiteral("roomId")).toString() != roomID) {
                                   continue;
                               }
                               textBytes += static_cast<qint64>(
                                   usage.value(QStringLiteral("textBytes")).toDouble());
                               mediaBytes += static_cast<qint64>(
                                   usage.value(QStringLiteral("mediaBytes")).toDouble());
                               messages += usage.value(QStringLiteral("messages")).toInt();
                           }
                           statusBar()->showMessage(
                               QStringLiteral("Room storage: %1 messages · %2 text bytes · %3 media bytes")
                                   .arg(messages).arg(textBytes).arg(mediaBytes), 8000);
                       }
                   });
}

void MainWindow::callMediaCacheUsage() {
    backend_->call(QStringLiteral("MediaCacheUsage"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto usage = result.toObject();
                           const auto bytes = static_cast<qint64>(
                               usage.value(QStringLiteral("bytes")).toDouble());
                           const int files = usage.value(QStringLiteral("files")).toInt();
                           statusBar()->showMessage(
                               QStringLiteral("Media cache: %1 bytes across %2 files").arg(bytes).arg(files), 8000);
                       }
                   });
}

void MainWindow::callClearCachedMedia() {
    backend_->call(QStringLiteral("ClearCachedMedia"), {QJsonObject{}},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       statusBar()->showMessage(QStringLiteral("Cached media cleared."), 8000);
                   });
}

void MainWindow::callClearMediaCache() {
    backend_->call(QStringLiteral("ClearMediaCache"), {},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       statusBar()->showMessage(QStringLiteral("Media cache cleared."), 8000);
                   });
}

void MainWindow::callNativeNotificationsSupported() {
    backend_->call(QStringLiteral("NativeNotificationsSupported"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       const bool supported = result.isBool() && result.toBool();
                       statusBar()->showMessage(
                           supported ? QStringLiteral("Native notifications supported.")
                                     : QStringLiteral("Native notifications not supported."), 8000);
                   });
}

void MainWindow::callNotificationPermission() {
    backend_->call(QStringLiteral("NotificationPermission"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           statusBar()->showMessage(
                               QStringLiteral("Notification permission: %1").arg(result.toString()), 8000);
                       }
                   });
}

void MainWindow::callRequestNotificationPermission() {
    backend_->call(QStringLiteral("RequestNotificationPermission"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           statusBar()->showMessage(
                               QStringLiteral("Notification permission: %1").arg(result.toString()), 8000);
                       }
                   });
}

void MainWindow::callOpenNotificationSettings() {
    backend_->call(QStringLiteral("OpenNotificationSettings"), {},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callSendNotification(const QJsonObject &alert) {
    QJsonArray params;
    params.append(alert);
    backend_->call(QStringLiteral("SendNotification"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       const bool sent = result.isBool() && result.toBool();
                       statusBar()->showMessage(
                           sent ? QStringLiteral("Notification sent.") : QStringLiteral("Notification not sent."), 8000);
                   });
}

void MainWindow::callSubscribeToRoom(const QString &roomID) {
    backend_->call(QStringLiteral("SubscribeToRoom"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callUnsubscribeFromRoom(const QString &roomID) {
    backend_->call(QStringLiteral("UnsubscribeFromRoom"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callUpdateVisibleRange(const QString &listKey, int startIndex, int endIndex) {
    backend_->call(QStringLiteral("UpdateVisibleRange"), {listKey, startIndex, endIndex},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callSetMenuState(const QString &state) {
    backend_->call(QStringLiteral("SetMenuState"), {state},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

// ---- UI action helpers ----

void MainWindow::showPreferences() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Settings"));
    dialog->resize(700, 500);
    auto *layout = new QVBoxLayout(dialog);

    auto *tabs = new QTabWidget(dialog);

    // Appearance tab
    auto *appearance = new QWidget(tabs);
    auto *appLayout = new QFormLayout(appearance);
    auto *themeCombo = new QComboBox(appearance);
    themeCombo->addItems({QStringLiteral("System default"), QStringLiteral("Light"), QStringLiteral("Dark"),
                          QStringLiteral("VS Code"), QStringLiteral("OLED black"), QStringLiteral("Bosco"),
                          QStringLiteral("Rosa"), QStringLiteral("Dracula"), QStringLiteral("Midnight"),
                          QStringLiteral("Slate"), QStringLiteral("Solarized"), QStringLiteral("Sepia")});
    appLayout->addRow(QStringLiteral("Theme"), themeCombo);

    auto *fontSizeCombo = new QComboBox(appearance);
    fontSizeCombo->addItems({QStringLiteral("Small"), QStringLiteral("Medium"), QStringLiteral("Large")});
    appLayout->addRow(QStringLiteral("Font size"), fontSizeCombo);

    auto *zoomCombo = new QComboBox(appearance);
    zoomCombo->addItems({QStringLiteral("75"), QStringLiteral("80"), QStringLiteral("85"), QStringLiteral("90"),
                         QStringLiteral("95"), QStringLiteral("100"), QStringLiteral("105"), QStringLiteral("110"),
                         QStringLiteral("115"), QStringLiteral("120"), QStringLiteral("125")});
    appLayout->addRow(QStringLiteral("Zoom"), zoomCombo);

    auto *compactCheck = new QCheckBox(QStringLiteral("Compact chat list"), appearance);
    appLayout->addRow(compactCheck);

    auto *roomPreviewsCheck = new QCheckBox(QStringLiteral("Show room previews"), appearance);
    appLayout->addRow(roomPreviewsCheck);

    auto *showTimestampsCheck = new QCheckBox(QStringLiteral("Show timestamps"), appearance);
    appLayout->addRow(showTimestampsCheck);

    tabs->addTab(appearance, QStringLiteral("Appearance"));

    // Notifications tab
    auto *notifications = new QWidget(tabs);
    auto *notifLayout = new QFormLayout(notifications);
    auto *notifEnabled = new QCheckBox(QStringLiteral("Enable notifications"), notifications);
    notifLayout->addRow(notifEnabled);
    auto *notifDirect = new QCheckBox(QStringLiteral("Direct messages"), notifications);
    notifLayout->addRow(notifDirect);
    auto *notifMentions = new QCheckBox(QStringLiteral("Mentions"), notifications);
    notifLayout->addRow(notifMentions);
    auto *notifSound = new QCheckBox(QStringLiteral("Sound"), notifications);
    notifLayout->addRow(notifSound);
    auto *notificationSupport = new QLabel(QStringLiteral("Checking notification support…"), notifications);
    notificationSupport->setWordWrap(true);
    notifLayout->addRow(QStringLiteral("Desktop delivery"), notificationSupport);
    tabs->addTab(notifications, QStringLiteral("Notifications"));

    // AI tab
    auto *aiTab = new QWidget(tabs);
    auto *aiLayout = new QFormLayout(aiTab);
    auto *aiEndpoint = new QLineEdit(aiTab);
    aiEndpoint->setPlaceholderText(QStringLiteral("http://localhost:8080"));
    aiLayout->addRow(QStringLiteral("AI endpoint"), aiEndpoint);
    auto *aiModel = new QLineEdit(aiTab);
    aiModel->setPlaceholderText(QStringLiteral("Model name"));
    aiLayout->addRow(QStringLiteral("AI model"), aiModel);
    auto *testAIButton = new QPushButton(QStringLiteral("Test endpoint"), aiTab);
    aiLayout->addRow(testAIButton);
    tabs->addTab(aiTab, QStringLiteral("AI"));

    // Data tab
    auto *dataTab = new QWidget(tabs);
    auto *dataLayout = new QFormLayout(dataTab);
    auto *dataLocationLabel = new QLabel(dataTab);
    dataLayout->addRow(QStringLiteral("Data location"), dataLocationLabel);
    auto *storageUsageLabel = new QLabel(QStringLiteral("Loading storage usage…"), dataTab);
    storageUsageLabel->setWordWrap(true);
    dataLayout->addRow(QStringLiteral("Storage usage"), storageUsageLabel);
    auto *refreshStorageButton = new QPushButton(QStringLiteral("Refresh storage usage"), dataTab);
    dataLayout->addRow(refreshStorageButton);
    auto *chooseDataButton = new QPushButton(QStringLiteral("Choose data folder…"), dataTab);
    dataLayout->addRow(chooseDataButton);
    auto *useDefaultButton = new QPushButton(QStringLiteral("Use default folder"), dataTab);
    dataLayout->addRow(useDefaultButton);
    auto *clearCacheButton = new QPushButton(QStringLiteral("Clear media cache"), dataTab);
    dataLayout->addRow(clearCacheButton);
    auto *optimizeDatabaseButton = new QPushButton(QStringLiteral("Optimize database"), dataTab);
    dataLayout->addRow(optimizeDatabaseButton);
    tabs->addTab(dataTab, QStringLiteral("Data"));

    // About tab
    auto *aboutTab = new QWidget(tabs);
    auto *aboutLayout = new QFormLayout(aboutTab);
    auto *versionLabel = new QLabel(aboutTab);
    aboutLayout->addRow(QStringLiteral("Version"), versionLabel);
    auto *checkUpdatesButton = new QPushButton(QStringLiteral("Check for updates"), aboutTab);
    aboutLayout->addRow(checkUpdatesButton);
    tabs->addTab(aboutTab, QStringLiteral("About"));
    const QPointer<QLabel> guardedDataLocation(dataLocationLabel);
    const QPointer<QLabel> guardedStorageUsage(storageUsageLabel);
    const QPointer<QLabel> guardedNotificationSupport(notificationSupport);
    const QPointer<QLabel> guardedVersion(versionLabel);

    themeCombo->setCurrentText(preferences_.value(QStringLiteral("appearance.theme"))
                                   .toString(QStringLiteral("System default")));
    fontSizeCombo->setCurrentText(preferences_.value(QStringLiteral("appearance.font_size"))
                                      .toString(QStringLiteral("Medium")));
    zoomCombo->setCurrentText(QString::number(
        preferences_.value(QStringLiteral("appearance.zoom")).toDouble(100)));
    compactCheck->setChecked(preferences_.value(QStringLiteral("sidebar.compact_chat_list")).toBool());
    roomPreviewsCheck->setChecked(
        preferences_.value(QStringLiteral("sidebar.show_previews")).toBool(true));
    showTimestampsCheck->setChecked(
        preferences_.value(QStringLiteral("appearance.show_timestamps")).toBool(true));
    notifEnabled->setChecked(preferences_.value(QStringLiteral("notifications.enabled")).toBool(true));
    notifDirect->setChecked(preferences_.value(QStringLiteral("notifications.direct")).toBool(true));
    notifMentions->setChecked(preferences_.value(QStringLiteral("notifications.mentions")).toBool(true));
    notifSound->setChecked(preferences_.value(QStringLiteral("notifications.sound")).toBool());
    aiEndpoint->setText(preferences_.value(QStringLiteral("ai.endpoint")).toString());
    aiModel->setText(preferences_.value(QStringLiteral("ai.model")).toString());
    backend_->call(QStringLiteral("DataLocation"), {},
                   [guardedDataLocation](QJsonValue result, const QString &error) {
                       if (!guardedDataLocation) {
                           return;
                       }
                       if (!error.isEmpty()) {
                           guardedDataLocation->setText(error);
                           return;
                       }
                       const auto location = result.toObject();
                       guardedDataLocation->setText(location.value(QStringLiteral("dataDir")).toString());
                       guardedDataLocation->setToolTip(
                           QStringLiteral("Media cache: %1")
                               .arg(location.value(QStringLiteral("mediaCacheDir")).toString()));
                   });
    backend_->call(QStringLiteral("AppVersion"), {},
                   [guardedVersion](QJsonValue result, const QString &error) {
                       if (!guardedVersion) {
                           return;
                       }
                       if (error.isEmpty()) {
                           guardedVersion->setText(result.toString());
                       } else {
                           guardedVersion->setText(error);
                       }
                   });
    backend_->call(QStringLiteral("NativeNotificationsSupported"), {},
                   [guardedNotificationSupport](QJsonValue result, const QString &error) {
                       if (!guardedNotificationSupport) {
                           return;
                       }
                       if (!error.isEmpty()) {
                           guardedNotificationSupport->setText(error);
                       } else {
                           guardedNotificationSupport->setText(result.toBool()
                               ? QStringLiteral("Native notifications are available.")
                               : QStringLiteral("Native notifications are not yet supported by the Qt backend."));
                       }
                   });
    const auto refreshStorage = [this, guardedStorageUsage] {
        if (!guardedStorageUsage) {
            return;
        }
        guardedStorageUsage->setText(QStringLiteral("Loading storage usage…"));
        backend_->call(QStringLiteral("StorageUsage"), {},
                       [this, guardedStorageUsage](QJsonValue databaseValue, const QString &databaseError) {
                           if (!guardedStorageUsage) {
                               return;
                           }
                           if (!databaseError.isEmpty()) {
                               guardedStorageUsage->setText(databaseError);
                               return;
                           }
                           const auto database = databaseValue.toObject();
                           const qint64 dbBytes = static_cast<qint64>(
                               database.value(QStringLiteral("databaseBytes")).toDouble());
                           const qint64 walBytes = static_cast<qint64>(
                               database.value(QStringLiteral("walBytes")).toDouble());
                           backend_->call(QStringLiteral("MediaCacheUsage"), {},
                               [guardedStorageUsage, dbBytes, walBytes]
                               (QJsonValue mediaValue, const QString &mediaError) {
                                   if (!guardedStorageUsage) {
                                       return;
                                   }
                                   if (!mediaError.isEmpty()) {
                                       guardedStorageUsage->setText(mediaError);
                                       return;
                                   }
                                   const auto media = mediaValue.toObject();
                                   const qint64 mediaBytes = static_cast<qint64>(
                                       media.value(QStringLiteral("bytes")).toDouble());
                                   const int mediaFiles = media.value(QStringLiteral("files")).toInt();
                                   guardedStorageUsage->setText(
                                       QStringLiteral("Database %1 bytes · WAL %2 bytes · Cached media %3 bytes (%4 files)")
                                           .arg(dbBytes).arg(walBytes).arg(mediaBytes).arg(mediaFiles));
                               });
                       });
    };
    refreshStorage();

    // Connect buttons
    const auto saveStringPreference = [this](const QString &key, const QString &value) {
        backend_->call(QStringLiteral("SetStringPreference"), {key, value},
                       [this](QJsonValue, const QString &error) {
                           if (!error.isEmpty()) {
                               showError(error);
                           } else {
                               loadSnapshot();
                           }
                       });
    };
    const auto saveBooleanPreference = [this](const QString &key, bool value) {
        backend_->call(QStringLiteral("SetBooleanPreference"), {key, value},
                       [this](QJsonValue, const QString &error) {
                           if (!error.isEmpty()) {
                               showError(error);
                           } else {
                               loadSnapshot();
                           }
                       });
    };
    connect(themeCombo, &QComboBox::currentTextChanged, dialog,
            [saveStringPreference](const QString &value) {
                saveStringPreference(QStringLiteral("appearance.theme"), value);
            });
    connect(fontSizeCombo, &QComboBox::currentTextChanged, dialog,
            [saveStringPreference](const QString &value) {
                saveStringPreference(QStringLiteral("appearance.font_size"), value);
            });
    connect(zoomCombo, &QComboBox::currentTextChanged, dialog,
            [saveStringPreference](const QString &value) {
                saveStringPreference(QStringLiteral("appearance.zoom"), value);
            });
    connect(compactCheck, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("sidebar.compact_chat_list"), value);
            });
    connect(roomPreviewsCheck, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("sidebar.show_previews"), value);
            });
    connect(showTimestampsCheck, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("appearance.show_timestamps"), value);
            });
    connect(notifEnabled, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("notifications.enabled"), value);
            });
    connect(notifDirect, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("notifications.direct"), value);
            });
    connect(notifMentions, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("notifications.mentions"), value);
            });
    connect(notifSound, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("notifications.sound"), value);
            });
    connect(aiEndpoint, &QLineEdit::editingFinished, dialog,
            [aiEndpoint, saveStringPreference] {
                saveStringPreference(QStringLiteral("ai.endpoint"), aiEndpoint->text().trimmed());
            });
    connect(aiModel, &QLineEdit::editingFinished, dialog,
            [aiModel, saveStringPreference] {
                saveStringPreference(QStringLiteral("ai.model"), aiModel->text().trimmed());
            });
    connect(testAIButton, &QPushButton::clicked, this, [this] {
        callTestAIEndpoint();
    });
    connect(chooseDataButton, &QPushButton::clicked, dialog, [this] {
        const QString path = QFileDialog::getExistingDirectory(this, QStringLiteral("Choose data folder"));
        if (path.isEmpty()) {
            return;
        }
        backend_->call(QStringLiteral("SetDataFolder"), {path},
                       [this](QJsonValue, const QString &error) {
                           if (!error.isEmpty()) {
                               showError(error);
                               return;
                           }
                           QMessageBox::information(this, QStringLiteral("Data folder"),
                               QStringLiteral("The data folder will be changed after restarting Pinger."));
                       });
    });
    connect(useDefaultButton, &QPushButton::clicked, this, &MainWindow::callUseDefaultDataFolder);
    connect(clearCacheButton, &QPushButton::clicked, dialog, [this] {
        if (QMessageBox::question(this, QStringLiteral("Clear media cache"),
                                  QStringLiteral("Remove all cached media? Messages will remain, but media may need to be downloaded again."))
            != QMessageBox::Yes) {
            return;
        }
        callClearMediaCache();
    });
    connect(refreshStorageButton, &QPushButton::clicked, dialog, refreshStorage);
    connect(optimizeDatabaseButton, &QPushButton::clicked, dialog, [this] {
        if (QMessageBox::question(this, QStringLiteral("Optimize database"),
                                  QStringLiteral("Optimize the active account database now?"))
            != QMessageBox::Yes) {
            return;
        }
        backend_->call(QStringLiteral("OptimizeDatabase"), {},
                       [this](QJsonValue, const QString &error) {
                           if (!error.isEmpty()) {
                               showError(error);
                           } else {
                               statusBar()->showMessage(QStringLiteral("Database optimized."), 8000);
                           }
                       });
    });
    connect(checkUpdatesButton, &QPushButton::clicked, this, &MainWindow::callCheckForUpdates);

    auto *buttonBox = new QDialogButtonBox(QDialogButtonBox::Close, dialog);
    layout->addWidget(tabs);
    layout->addWidget(buttonBox);
    connect(buttonBox, &QDialogButtonBox::rejected, dialog, &QDialog::reject);

    dialog->exec();
}

void MainWindow::showAIDialog() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("AI Features"));
    dialog->resize(600, 400);
    auto *layout = new QVBoxLayout(dialog);

    auto *list = new QListWidget(dialog);
    list->addItem(QStringLiteral("Ask AI"));
    list->addItem(QStringLiteral("Suggest replies"));
    list->addItem(QStringLiteral("Generate reply draft"));
    list->addItem(QStringLiteral("Detect chat language"));
    list->addItem(QStringLiteral("Analyze draft tone"));
    list->addItem(QStringLiteral("Transcribe selected audio"));
    list->addItem(QStringLiteral("Generate room image"));
    auto *status = new QLabel(QStringLiteral("Choose an AI action."), dialog);
    status->setWordWrap(true);
    auto *runButton = new QPushButton(QStringLiteral("Run"), dialog);
    runButton->setEnabled(false);
    layout->addWidget(list);
    layout->addWidget(status);

    auto *buttonBox = new QDialogButtonBox(QDialogButtonBox::Close, dialog);
    buttonBox->addButton(runButton, QDialogButtonBox::ActionRole);
    layout->addWidget(buttonBox);
    connect(buttonBox, &QDialogButtonBox::rejected, dialog, &QDialog::reject);
    connect(list, &QListWidget::currentRowChanged, runButton, [runButton](int row) {
        runButton->setEnabled(row >= 0);
    });
    connect(runButton, &QPushButton::clicked, dialog, [this, dialog, list, status, runButton] {
        const int action = list->currentRow();
        if (action < 0) {
            return;
        }
        const QString roomID = currentRoomID_;
        const QString requestID = QUuid::createUuid().toString(QUuid::WithoutBraces);
        runButton->setEnabled(false);
        status->setText(QStringLiteral("Working…"));
        if (action == 0) {
            bool accepted = false;
            const QString prompt = QInputDialog::getMultiLineText(
                dialog, QStringLiteral("Ask AI"), QStringLiteral("Question"), {}, &accepted).trimmed();
            if (!accepted || prompt.isEmpty()) {
                status->setText(QStringLiteral("Choose an AI action."));
                runButton->setEnabled(true);
                return;
            }
            const QJsonArray messages{QJsonObject{
                {QStringLiteral("role"), QStringLiteral("user")},
                {QStringLiteral("content"), prompt},
            }};
            backend_->call(QStringLiteral("AIComplete"),
                           {messages, requestID, 0.7, 1000},
                           [this, status, runButton](QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               if (!error.isEmpty()) {
                                   status->setText(error);
                                   return;
                               }
                               status->setText(value.toString());
                           });
        } else if (action == 1 || action == 2) {
            if (roomID.isEmpty()) {
                status->setText(QStringLiteral("Select a room first."));
                runButton->setEnabled(true);
                return;
            }
            const QString method = action == 1
                ? QStringLiteral("AISuggestReplies")
                : QStringLiteral("AIGenerateReplyDraft");
            backend_->call(method, {roomID, requestID},
                           [this, dialog, status, runButton, roomID, action]
                           (QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               if (!error.isEmpty()) {
                                   status->setText(error);
                                   return;
                               }
                               if (currentRoomID_ != roomID) {
                                   status->setText(QStringLiteral("The active room changed."));
                                   return;
                               }
                               if (action == 2) {
                                   const QString draft = value.toString().trimmed();
                                   if (draft.isEmpty()) {
                                       status->setText(QStringLiteral("The AI returned an empty draft."));
                                       return;
                                   }
                                   composer_->setPlainText(draft);
                                   setComposeContext(QStringLiteral("AI-generated reply draft"));
                                   status->setText(QStringLiteral("Draft added to the composer."));
                                   return;
                               }
                               const auto suggestions = value.toObject()
                                   .value(QStringLiteral("suggestions")).toArray();
                               QStringList choices;
                               for (const auto &entry : suggestions) {
                                   const auto suggestion = entry.toObject();
                                   const QString text = suggestion.value(QStringLiteral("text")).toString().trimmed();
                                   if (!text.isEmpty()) {
                                       choices.append(QStringLiteral("%1: %2")
                                           .arg(suggestion.value(QStringLiteral("tone")).toString(), text));
                                   }
                               }
                               if (choices.isEmpty()) {
                                   status->setText(QStringLiteral("The AI returned no reply suggestions."));
                                   return;
                               }
                               bool accepted = false;
                               const QString selected = QInputDialog::getItem(
                                   dialog, QStringLiteral("Suggested replies"),
                                   QStringLiteral("Choose a reply draft"), choices, 0, false, &accepted);
                               if (!accepted) {
                                   status->setText(QStringLiteral("Suggestions were not added."));
                                   return;
                               }
                               const qsizetype separator = selected.indexOf(QStringLiteral(": "));
                               composer_->setPlainText(separator >= 0 ? selected.mid(separator + 2) : selected);
                               clearComposeContext();
                               status->setText(QStringLiteral("Reply added to the composer as a draft."));
                           });
        } else if (action == 3) {
            if (roomID.isEmpty()) {
                status->setText(QStringLiteral("Select a room first."));
                runButton->setEnabled(true);
                return;
            }
            backend_->call(QStringLiteral("AIDetectChatLanguage"), {roomID, requestID},
                           [status, runButton](QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               status->setText(error.isEmpty()
                                   ? QStringLiteral("Detected language: %1").arg(value.toString())
                                   : error);
                           });
        } else if (action == 4) {
            const QString draft = composer_->toPlainText().trimmed();
            if (draft.isEmpty()) {
                status->setText(QStringLiteral("Write a draft in the composer first."));
                runButton->setEnabled(true);
                return;
            }
            backend_->call(QStringLiteral("CheckMessageTone"),
                           {QJsonArray{QJsonObject{
                               {QStringLiteral("role"), QStringLiteral("user")},
                               {QStringLiteral("content"), draft},
                           }}},
                           [status, runButton](QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               status->setText(error.isEmpty()
                                   ? value.toString()
                                   : error);
                           });
        } else if (action == 5) {
            auto *item = messages_->currentItem();
            const auto message = item
                ? messagesByID_.value(item->data(Qt::UserRole).toString())
                : QJsonObject{};
            const QString mediaURI = message.value(QStringLiteral("mediaUri")).toString();
            if (mediaURI.isEmpty()) {
                status->setText(QStringLiteral("Select an audio message in the timeline first."));
                runButton->setEnabled(true);
                return;
            }
            const QString filename = message.value(QStringLiteral("body")).toString();
            const QString contentType = message.value(QStringLiteral("mediaMime")).toString();
            backend_->call(QStringLiteral("AITranscribeMedia"),
                           {mediaURI, filename, contentType},
                           [this, roomID, status, runButton](QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               if (!error.isEmpty()) {
                                   status->setText(error);
                               } else if (roomID != currentRoomID_) {
                                   status->setText(QStringLiteral("The active room changed."));
                               } else {
                                   const QString transcript = value.toString().trimmed();
                                   composer_->setPlainText(transcript);
                                   composer_->setFocus();
                                   status->setText(QStringLiteral("Transcript added to the composer as a draft."));
                               }
                           });
        } else {
            bool accepted = false;
            const QString prompt = QInputDialog::getMultiLineText(
                dialog, QStringLiteral("Generate room image"), QStringLiteral("Describe the image"), {},
                &accepted).trimmed();
            if (!accepted || prompt.isEmpty()) {
                status->setText(QStringLiteral("Choose an AI action."));
                runButton->setEnabled(true);
                return;
            }
            if (roomID.isEmpty()) {
                status->setText(QStringLiteral("Select a room first."));
                runButton->setEnabled(true);
                return;
            }
            backend_->call(QStringLiteral("GenerateRoomImage"), {prompt, requestID},
                           [this, dialog, status, runButton, roomID]
                           (QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               if (!error.isEmpty()) {
                                   status->setText(error);
                                   return;
                               }
                               if (currentRoomID_ != roomID) {
                                   status->setText(QStringLiteral("The active room changed."));
                                   return;
                               }
                               const QByteArray encoded = value.toString().toLatin1();
                               QPixmap image;
                               if (!image.loadFromData(QByteArray::fromBase64(encoded))) {
                                   status->setText(QStringLiteral("The generated image could not be previewed."));
                                   return;
                               }
                               QDialog preview(dialog);
                               preview.setWindowTitle(QStringLiteral("Review generated image"));
                               auto *previewLayout = new QVBoxLayout(&preview);
                               auto *imageLabel = new QLabel(&preview);
                               imageLabel->setAlignment(Qt::AlignCenter);
                               imageLabel->setPixmap(image.scaled(640, 480, Qt::KeepAspectRatio,
                                                                   Qt::SmoothTransformation));
                               auto *buttons = new QDialogButtonBox(
                                   QDialogButtonBox::Yes | QDialogButtonBox::No, &preview);
                               buttons->button(QDialogButtonBox::Yes)->setText(QStringLiteral("Send to room"));
                               buttons->button(QDialogButtonBox::No)->setText(QStringLiteral("Discard"));
                               previewLayout->addWidget(imageLabel);
                               previewLayout->addWidget(buttons);
                               connect(buttons, &QDialogButtonBox::accepted, &preview, &QDialog::accept);
                               connect(buttons, &QDialogButtonBox::rejected, &preview, &QDialog::reject);
                               if (preview.exec() != QDialog::Accepted) {
                                   status->setText(QStringLiteral("Generated image discarded."));
                                   return;
                               }
                               if (currentRoomID_ != roomID) {
                                   status->setText(QStringLiteral("The active room changed; image was not sent."));
                                   return;
                               }
                               backend_->call(QStringLiteral("SendRoomImage"), {roomID, QString::fromLatin1(encoded)},
                                              [status](QJsonValue, const QString &sendError) {
                                                  if (status) {
                                                      status->setText(sendError.isEmpty()
                                                          ? QStringLiteral("Image sent.")
                                                          : sendError);
                                                  }
                                              });
                           });
        }
    });

    dialog->exec();
}

void MainWindow::showScheduledDialog() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Scheduled Messages"));
    dialog->resize(600, 400);
    auto *layout = new QVBoxLayout(dialog);

    auto *list = new QListWidget(dialog);
    layout->addWidget(list);

    auto *buttonLayout = new QHBoxLayout;
    auto *refreshButton = new QPushButton(QStringLiteral("Refresh"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    buttonLayout->addStretch();
    buttonLayout->addWidget(refreshButton);
    buttonLayout->addWidget(closeButton);

    layout->addLayout(buttonLayout);

    connect(refreshButton, &QPushButton::clicked, this, &MainWindow::callScheduledJobs);
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::reject);

    callScheduledJobs();

    dialog->exec();
}

void MainWindow::showLocalAIChatDialog() {
    LocalAIChatDialog dialog(backend_, QString(), this, contentBlurEnabled_);
    dialog.exec();
}

void MainWindow::showExportDialog() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Export Chats"));
    dialog->resize(500, 300);
    auto *layout = new QVBoxLayout(dialog);

    auto *roomCombo = new QComboBox(dialog);
    layout->addWidget(new QLabel(QStringLiteral("Select room to export:"), dialog));
    layout->addWidget(roomCombo);

    auto *exportButton = new QPushButton(QStringLiteral("Export room chat…"), dialog);
    auto *bulkButton = new QPushButton(QStringLiteral("Export all chats…"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    layout->addWidget(exportButton);
    layout->addWidget(bulkButton);
    layout->addWidget(closeButton);

    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::reject);

    // Populate rooms
    const auto rooms = snapshot_.value(QStringLiteral("rooms")).toArray();
    for (const auto &entry : rooms) {
        const auto room = entry.toObject();
        const auto roomID = room.value(QStringLiteral("id")).toString();
        const auto name = room.value(QStringLiteral("name")).toString(roomID);
        roomCombo->addItem(name, roomID);
    }

    connect(exportButton, &QPushButton::clicked, this, [this, roomCombo] {
        const auto roomID = roomCombo->currentData().toString();
        if (roomID.isEmpty()) return;
        bool ok = false;
        auto dir = QFileDialog::getExistingDirectory(this, QStringLiteral("Select export folder"));
        if (!dir.isEmpty()) {
            callExportRoomChat(roomID, dir);
        }
    });

    connect(bulkButton, &QPushButton::clicked, this, [this] {
        bool ok = false;
        auto dir = QFileDialog::getExistingDirectory(this, QStringLiteral("Select export folder"));
        if (!dir.isEmpty()) {
            QJsonObject options;
            options[QStringLiteral("privateChats")] = true;
            options[QStringLiteral("groupChats")] = true;
            options[QStringLiteral("myMessages")] = true;
            options[QStringLiteral("theirMessages")] = true;
            options[QStringLiteral("deletedMessages")] = false;
            callExportRecentMessagesForAllChats(dir, 1000, options);
        }
    });

    dialog->exec();
}
