#pragma once

#include <QColor>
#include <QDateTime>
#include <QIcon>
#include <QJsonObject>
#include <QString>
#include <QUrl>
#include <QVariant>

class QApplication;
class QPixmap;
class QWidget;

namespace qtutil {

QString stringValue(const QJsonObject &object, const char *key, const QString &fallback = QString());
bool boolValue(const QJsonObject &object, const char *key, bool fallback = false);
qint64 intValue(const QJsonObject &object, const char *key, qint64 fallback = 0);
double doubleValue(const QJsonObject &object, const char *key, double fallback = 0.0);

QString preferenceString(const QJsonObject &preferences, const char *key,
                         const QString &fallback = QString());
bool preferenceBool(const QJsonObject &preferences, const char *key, bool fallback = false);

QString formatTime(qint64 milliseconds, bool relative = false, bool use24Hour = true);
QString formatBytes(qint64 bytes);
QString formatDuration(qint64 milliseconds);
QString initials(const QString &name);
QString displayName(const QJsonObject &account);
QString accountLabel(const QJsonObject &account);

QColor accentColor(const QJsonObject &preferences);
QColor bubbleColor(const QJsonObject &preferences);
QColor backgroundColor(const QJsonObject &preferences);
QString themeName(const QJsonObject &preferences);
bool darkTheme(const QJsonObject &preferences);

QIcon applicationIcon();
QIcon menuBarIcon(bool systemDark);
QIcon roundedAvatarIcon(const QPixmap &source, int logicalSize);
QPixmap avatarFor(const QJsonObject &room, int size = 48);
QPixmap avatarFromUri(const QString &uri, int size = 48);

QString mediaUrl(const QString &base, const QString &source, const QString &roomId,
                 const QString &eventId);
QString mxcMediaUrl(const QString &base, const QString &mxc);
bool isHttpUrl(const QString &text);
QString linkPreviewUrl(const QJsonObject &message, const QString &roomId);
QStringList messageLinks(const QString &body);

void applyApplicationPreferences(QApplication *application, const QJsonObject &preferences);
void applyWidgetPreferences(QWidget *widget, const QJsonObject &preferences);

QString joinNonEmpty(const QStringList &values, const QString &separator);

} // namespace qtutil