#pragma once

#include <QByteArray>
#include <QHash>
#include <QNetworkAccessManager>
#include <QObject>
#include <QString>
#include <QUrl>

#include <functional>

class QNetworkReply;

class MediaClient final : public QObject {
    Q_OBJECT

public:
    using Completion = std::function<void(bool ok, const QByteArray &data, const QString &error)>;

    explicit MediaClient(QObject *parent = nullptr);

    void setBaseUrl(const QString &url);
    QString baseUrl() const;
    QString mediaUrl(const QString &source, const QString &roomId, const QString &eventId) const;
    QString mxcUrl(const QString &mxc) const;

    void fetch(const QString &url, Completion completion);
    void download(const QString &url, const QString &path,
                  std::function<void(bool ok, const QString &error)> completion);
    void uploadAttachment(const QString &roomId, const QString &filename, const QByteArray &data,
                          bool voiceNote, bool videoMessage, qint64 durationMs,
                          std::function<void(bool ok, const QString &error)> completion);
    void exportRoomKeys(const QString &passphrase, Completion completion);
    void importRoomKeys(const QString &passphrase, const QByteArray &data,
                        std::function<void(bool ok, int imported, int total, const QString &error)> completion);

    static QString quoteSegment(const QString &value);

private:
    void get(const QUrl &url, Completion completion);
    void post(const QUrl &url, const QByteArray &body, const QString &contentType,
              const QHash<QByteArray, QByteArray> &headers, Completion completion);

    QNetworkAccessManager manager_;
    QString baseUrl_;
    QHash<QNetworkReply *, Completion> pending_;
};