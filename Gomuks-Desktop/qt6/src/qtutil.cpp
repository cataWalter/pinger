#include "qtutil.h"

#include <QApplication>
#include <QBrush>
#include <QDateTime>
#include <QFont>
#include <QGuiApplication>
#include <QPainter>
#include <QPalette>
#include <QPixmap>
#include <QRegularExpression>
#include <QStyle>
#include <QWidget>

#include <cmath>

namespace qtutil {

QString stringValue(const QJsonObject &object, const char *key, const QString &fallback) {
    const QJsonValue value = object.value(QLatin1String(key));
    return value.isString() ? value.toString() : fallback;
}

bool boolValue(const QJsonObject &object, const char *key, bool fallback) {
    const QJsonValue value = object.value(QLatin1String(key));
    return value.isBool() ? value.toBool() : fallback;
}

qint64 intValue(const QJsonObject &object, const char *key, qint64 fallback) {
    const QJsonValue value = object.value(QLatin1String(key));
    if (value.isDouble()) {
        return static_cast<qint64>(value.toDouble());
    }
    if (value.isString()) {
        bool ok = false;
        const qint64 parsed = value.toString().toLongLong(&ok);
        return ok ? parsed : fallback;
    }
    return fallback;
}

double doubleValue(const QJsonObject &object, const char *key, double fallback) {
    const QJsonValue value = object.value(QLatin1String(key));
    return value.isDouble() ? value.toDouble() : fallback;
}

QString preferenceString(const QJsonObject &preferences, const char *key, const QString &fallback) {
    return stringValue(preferences, key, fallback);
}

bool preferenceBool(const QJsonObject &preferences, const char *key, bool fallback) {
    return boolValue(preferences, key, fallback);
}

QString formatTime(qint64 milliseconds, bool relative, bool use24Hour) {
    if (milliseconds <= 0) {
        return QString();
    }
    const QDateTime when = QDateTime::fromMSecsSinceEpoch(milliseconds).toLocalTime();
    if (!relative) {
        return when.toString(use24Hour ? QStringLiteral("yyyy-MM-dd HH:mm")
                                       : QStringLiteral("yyyy-MM-dd hh:mm AP"));
    }
    const QDateTime now = QDateTime::currentDateTime();
    const qint64 seconds = when.secsTo(now);
    if (seconds < 0) {
        return when.toString(use24Hour ? QStringLiteral("HH:mm") : QStringLiteral("hh:mm AP"));
    }
    if (seconds < 60) {
        return QObject::tr("just now");
    }
    if (seconds < 3600) {
        return QObject::tr("%1 min ago").arg(seconds / 60);
    }
    if (when.date() == now.date()) {
        return when.toString(use24Hour ? QStringLiteral("HH:mm") : QStringLiteral("hh:mm AP"));
    }
    if (when.date().addDays(1) == now.date()) {
        return QObject::tr("yesterday");
    }
    if (when.date().year() == now.date().year()) {
        return when.toString(QStringLiteral("MMM d"));
    }
    return when.toString(QStringLiteral("MMM d yyyy"));
}

QString formatBytes(qint64 bytes) {
    if (bytes <= 0) {
        return QStringLiteral("0 B");
    }
    static const char *units[] = {"B", "KiB", "MiB", "GiB", "TiB"};
    double value = static_cast<double>(bytes);
    int unit = 0;
    while (value >= 1024.0 && unit < 4) {
        value /= 1024.0;
        ++unit;
    }
    if (unit == 0) {
        return QStringLiteral("%1 B").arg(bytes);
    }
    return QStringLiteral("%1 %2").arg(value, 0, 'f', value < 10.0 ? 1 : 0).arg(QLatin1String(units[unit]));
}

QString formatDuration(qint64 milliseconds) {
    const qint64 seconds = qMax<qint64>(0, milliseconds) / 1000;
    const qint64 minutes = seconds / 60;
    return QStringLiteral("%1:%2")
        .arg(minutes)
        .arg(seconds % 60, 2, 10, QLatin1Char('0'));
}

QString initials(const QString &name) {
    const QString cleaned = name.trimmed();
    if (cleaned.isEmpty()) {
        return QStringLiteral("?");
    }
    const QStringList parts = cleaned.split(QRegularExpression(QStringLiteral("[\\s_.@-]+")),
                                            Qt::SkipEmptyParts);
    QString result;
    for (const QString &part : parts) {
        if (!result.isEmpty()) {
            break;
        }
        result = part.left(1).toUpper();
    }
    return result.isEmpty() ? cleaned.left(1).toUpper() : result;
}

QString displayName(const QJsonObject &account) {
    const QJsonObject profile = account.value(QStringLiteral("profile")).toObject();
    const QString name = stringValue(profile, "displayName");
    if (!name.isEmpty() && name != stringValue(profile, "userId")) {
        return name;
    }
    return stringValue(profile, "userId", QStringLiteral("Account"));
}

QString accountLabel(const QJsonObject &account) {
    const QJsonObject profile = account.value(QStringLiteral("profile")).toObject();
    const QString name = stringValue(profile, "displayName");
    const QString userID = stringValue(profile, "userId");
    if (!name.isEmpty() && !userID.isEmpty() && name != userID) {
        return QStringLiteral("%1 (%2)").arg(name, userID);
    }
    return displayName(account);
}

QString themeName(const QJsonObject &preferences) {
    return preferenceString(preferences, "appearance.theme", QStringLiteral("System default"));
}

bool darkTheme(const QJsonObject &preferences) {
    const QString theme = themeName(preferences);
    if (theme.compare(QStringLiteral("Light"), Qt::CaseInsensitive) == 0) {
        return false;
    }
    if (theme.compare(QStringLiteral("System default"), Qt::CaseInsensitive) == 0) {
        const QPalette palette = QGuiApplication::palette();
        return palette.color(QPalette::Window).lightness() < 128;
    }
    return true;
}

QColor accentColor(const QJsonObject &preferences) {
    const QString name = preferenceString(preferences, "appearance.accent_color");
    if (name.startsWith(QLatin1Char('#'))) {
        return QColor(name);
    }
    if (name.compare(QStringLiteral("Ocean"), Qt::CaseInsensitive) == 0) {
        return QColor(QStringLiteral("#2f7fa8"));
    }
    if (name.compare(QStringLiteral("Rose"), Qt::CaseInsensitive) == 0) {
        return QColor(QStringLiteral("#b34f6f"));
    }
    if (name.compare(QStringLiteral("Gold"), Qt::CaseInsensitive) == 0) {
        return QColor(QStringLiteral("#b78a24"));
    }
    return QColor(QStringLiteral("#2f7d5b"));
}

QColor bubbleColor(const QJsonObject &preferences) {
    const QString name = preferenceString(preferences, "appearance.bubble_color");
    if (name.startsWith(QLatin1Char('#'))) {
        return QColor(name);
    }
    return accentColor(preferences);
}

QColor backgroundColor(const QJsonObject &preferences) {
    return darkTheme(preferences) ? QColor(QStringLiteral("#20242a"))
                                  : QColor(QStringLiteral("#f7f8f7"));
}

QIcon applicationIcon() {
    QIcon icon(QStringLiteral(":/appicon.png"));
    if (!icon.isNull()) {
        return icon;
    }
    QPixmap fallback(64, 64);
    fallback.fill(Qt::transparent);
    QPainter painter(&fallback);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setBrush(QColor(QStringLiteral("#2f7d5b")));
    painter.setPen(Qt::NoPen);
    painter.drawEllipse(4, 4, 56, 56);
    painter.setPen(Qt::white);
    painter.setFont(QFont(QStringLiteral("Sans"), 26, QFont::Bold));
    painter.drawText(fallback.rect(), Qt::AlignCenter, QStringLiteral("P"));
    painter.end();
    return QIcon(fallback);
}

QPixmap avatarFromUri(const QString &uri, int size) {
    Q_UNUSED(uri);
    QPixmap pixmap(size, size);
    pixmap.fill(Qt::transparent);
    QPainter painter(&pixmap);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(QStringLiteral("#7aa6a0")));
    painter.drawEllipse(0, 0, size, size);
    painter.setPen(Qt::white);
    painter.setFont(QFont(QStringLiteral("Sans"), qMax(8, size / 3), QFont::Bold));
    painter.drawText(pixmap.rect(), Qt::AlignCenter, qtutil::initials(uri));
    painter.end();
    return pixmap;
}

QPixmap avatarFor(const QJsonObject &room, int size) {
    const QString avatar = stringValue(room, "avatar");
    if (!avatar.isEmpty()) {
        const QPixmap loaded = avatarFromUri(avatar, size);
        if (!loaded.isNull()) {
            return loaded;
        }
    }
    return avatarFromUri(stringValue(room, "name", QStringLiteral("?")), size);
}

QString mediaUrl(const QString &base, const QString &source, const QString &roomId,
                 const QString &eventId) {
    if (base.isEmpty()) {
        return QString();
    }
    return QStringLiteral("%1/media/%2/%3/%4")
        .arg(base, source, QString::fromUtf8(QUrl::toPercentEncoding(roomId)),
             QString::fromUtf8(QUrl::toPercentEncoding(eventId)));
}

QString mxcMediaUrl(const QString &base, const QString &mxc) {
    if (base.isEmpty() || !mxc.startsWith(QStringLiteral("mxc://"))) {
        return QString();
    }
    const QString withoutScheme = mxc.mid(6);
    const int slash = withoutScheme.indexOf(QLatin1Char('/'));
    if (slash <= 0) {
        return QString();
    }
    const QString server = withoutScheme.left(slash);
    const QString mediaId = withoutScheme.mid(slash + 1);
    return QStringLiteral("%1/media/mxc/%2/%3")
        .arg(base, QString::fromUtf8(QUrl::toPercentEncoding(server)),
             QString::fromUtf8(QUrl::toPercentEncoding(mediaId)));
}

bool isHttpUrl(const QString &text) {
    return text.startsWith(QStringLiteral("http://"), Qt::CaseInsensitive)
           || text.startsWith(QStringLiteral("https://"), Qt::CaseInsensitive)
           || text.startsWith(QStringLiteral("mailto:"), Qt::CaseInsensitive);
}

QString linkPreviewUrl(const QJsonObject &message, const QString &roomId) {
    Q_UNUSED(roomId);
    const QString body = stringValue(message, "body");
    const QRegularExpression matcher(QStringLiteral("https?://[^\\s<>]+"));
    QRegularExpressionMatchIterator iterator = matcher.globalMatch(body);
    QString last;
    while (iterator.hasNext()) {
        last = iterator.next().captured(0);
    }
    return last;
}

QStringList messageLinks(const QString &body) {
    QStringList links;
    const QRegularExpression matcher(QStringLiteral("https?://[^\\s<>]+"));
    QRegularExpressionMatchIterator iterator = matcher.globalMatch(body);
    while (iterator.hasNext()) {
        QString link = iterator.next().captured(0);
        while (link.endsWith(QLatin1Char('.')) || link.endsWith(QLatin1Char(','))
               || link.endsWith(QLatin1Char(')')) || link.endsWith(QLatin1Char(']'))) {
            link.chop(1);
        }
        if (!link.isEmpty()) {
            links.append(link);
        }
    }
    return links;
}

void applyApplicationPreferences(QApplication *application, const QJsonObject &preferences) {
    if (!application) {
        return;
    }
    const bool dark = darkTheme(preferences);
    const QColor window = dark ? QColor(QStringLiteral("#20242a")) : QColor(QStringLiteral("#f7f8f7"));
    const QColor text = dark ? QColor(QStringLiteral("#e8ece9")) : QColor(QStringLiteral("#1f2a24"));
    const QColor base = dark ? QColor(QStringLiteral("#282e35")) : QColor(QStringLiteral("#ffffff"));
    const QColor accent = accentColor(preferences);
    QPalette palette(application->palette());
    palette.setColor(QPalette::Window, window);
    palette.setColor(QPalette::WindowText, text);
    palette.setColor(QPalette::Base, base);
    palette.setColor(QPalette::AlternateBase, dark ? QColor(QStringLiteral("#30363e"))
                                                   : QColor(QStringLiteral("#edf2ef")));
    palette.setColor(QPalette::Text, text);
    palette.setColor(QPalette::Button, dark ? QColor(QStringLiteral("#303740"))
                                            : QColor(QStringLiteral("#ffffff")));
    palette.setColor(QPalette::ButtonText, text);
    palette.setColor(QPalette::Highlight, accent);
    palette.setColor(QPalette::HighlightedText, Qt::white);
    palette.setColor(QPalette::ToolTipBase, dark ? QColor(QStringLiteral("#303740")) : Qt::white);
    palette.setColor(QPalette::ToolTipText, text);
    palette.setColor(QPalette::PlaceholderText, dark ? QColor(QStringLiteral("#8b969d"))
                                                     : QColor(QStringLiteral("#78837d")));
    application->setPalette(palette);

    QFont font = application->font();
    const QString size = preferenceString(preferences, "appearance.font_size", QStringLiteral("Medium"));
    int points = font.pointSize();
    if (size.compare(QStringLiteral("Small"), Qt::CaseInsensitive) == 0) {
        points = qMax(8, points - 1);
    } else if (size.compare(QStringLiteral("Large"), Qt::CaseInsensitive) == 0) {
        points = points + 1;
    }
    font.setPointSize(points);
    application->setFont(font);
}

void applyWidgetPreferences(QWidget *widget, const QJsonObject &preferences) {
    if (!widget) {
        return;
    }
    const bool dark = darkTheme(preferences);
    const QColor accent = accentColor(preferences);
    const QString background = dark ? QStringLiteral("#20242a") : QStringLiteral("#f7f8f7");
    const QString panel = dark ? QStringLiteral("#282e35") : QStringLiteral("#ffffff");
    const QString line = dark ? QStringLiteral("#3b434c") : QStringLiteral("#d8dfdb");
    const QString text = dark ? QStringLiteral("#e8ece9") : QStringLiteral("#1f2a24");
    widget->setStyleSheet(QStringLiteral(
                              "QWidget { color: %1; }"
                              "QLineEdit, QPlainTextEdit, QTextEdit, QListWidget, QComboBox, QSpinBox, QDateTimeEdit {"
                              "  background: %2; border: 1px solid %3; border-radius: 6px; padding: 4px; }"
                              "QPushButton { background: %2; border: 1px solid %3; border-radius: 6px; padding: 5px 10px; }"
                              "QPushButton:hover { border-color: %4; }"
                              "QPushButton:disabled { color: #8a948e; }"
                              "QListWidget::item:selected { background: %4; color: white; }"
                              "QLabel[role=\"heading\"] { font-size: 16px; font-weight: bold; }"
                              "QTabWidget::pane { border: 1px solid %3; }")
                              .arg(text, panel, line, accent.name()));
    widget->setAutoFillBackground(true);
    Q_UNUSED(background);
}

QString joinNonEmpty(const QStringList &values, const QString &separator) {
    QStringList filtered;
    for (const QString &value : values) {
        if (!value.trimmed().isEmpty()) {
            filtered.append(value);
        }
    }
    return filtered.join(separator);
}

} // namespace qtutil