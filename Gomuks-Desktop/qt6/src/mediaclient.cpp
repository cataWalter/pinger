#include "mediaclient.h"

#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QUrlQuery>

MediaClient::MediaClient(QObject *parent) : QObject(parent) {
    manager_.setTransferTimeout(120000);
}

void MediaClient::setBaseUrl(const QString &url) {
    QString normalized = url.trimmed();
    while (normalized.endsWith(QLatin1Char('/'))) {
        normalized.chop(1);
    }
    baseUrl_ = normalized;
}

QString MediaClient::baseUrl() const {
    return baseUrl_;
}

QString MediaClient::quoteSegment(const QString &value) {
    return QString::fromUtf8(QUrl::toPercentEncoding(value));
}

QString MediaClient::mediaUrl(const QString &source, const QString &roomId, const QString &eventId) const {
    if (baseUrl_.isEmpty()) {
        return QString();
    }
    return QStringLiteral("%1/media/%2/%3/%4")
        .arg(baseUrl_, source, quoteSegment(roomId), quoteSegment(eventId));
}

QString MediaClient::mxcUrl(const QString &mxc) const {
    if (baseUrl_.isEmpty() || !mxc.startsWith(QStringLiteral("mxc://"))) {
        return QString();
    }
    const QString withoutScheme = mxc.mid(6);
    const int slash = withoutScheme.indexOf(QLatin1Char('/'));
    if (slash <= 0) {
        return QString();
    }
    return QStringLiteral("%1/media/mxc/%2/%3")
        .arg(baseUrl_, quoteSegment(withoutScheme.left(slash)),
             quoteSegment(withoutScheme.mid(slash + 1)));
}

void MediaClient::fetch(const QString &url, Completion completion) {
    if (url.isEmpty()) {
        completion(false, {}, QStringLiteral("No media URL is available yet."));
        return;
    }
    get(QUrl(url), std::move(completion));
}

void MediaClient::download(const QString &url, const QString &path,
                           std::function<void(bool ok, const QString &error)> completion) {
    fetch(url, [path, completion = std::move(completion)](bool ok, const QByteArray &data,
                                                          const QString &error) {
        if (!ok) {
            completion(false, error);
            return;
        }
        QFile file(path);
        if (!file.open(QIODevice::WriteOnly)) {
            completion(false, file.errorString());
            return;
        }
        const qint64 written = file.write(data);
        file.close();
        if (written != data.size()) {
            completion(false, QStringLiteral("Could not write %1").arg(path));
            return;
        }
        completion(true, QString());
    });
}

void MediaClient::uploadAttachment(const QString &roomId, const QString &filename,
                                   const QByteArray &data, bool voiceNote, bool videoMessage,
                                   qint64 durationMs,
                                   std::function<void(bool ok, const QString &error)> completion) {
    if (baseUrl_.isEmpty()) {
        completion(false, QStringLiteral("The media service is not available yet."));
        return;
    }
    QUrl url(QStringLiteral("%1/media/ipc/attachment/%2")
                 .arg(baseUrl_, quoteSegment(roomId)));
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("filename"), filename);
    if (voiceNote) {
        query.addQueryItem(QStringLiteral("voiceNote"), QStringLiteral("true"));
    }
    if (videoMessage) {
        query.addQueryItem(QStringLiteral("videoMessage"), QStringLiteral("true"));
    }
    if (durationMs > 0) {
        query.addQueryItem(QStringLiteral("durationMs"), QString::number(durationMs));
    }
    url.setQuery(query);
    post(url, data, QStringLiteral("application/octet-stream"), {},
         [completion = std::move(completion)](bool ok, const QByteArray &body,
                                              const QString &error) {
             if (ok) {
                 completion(true, QString());
                 return;
             }
             completion(false, !body.isEmpty() ? QString::fromUtf8(body).trimmed() : error);
         });
}

void MediaClient::exportRoomKeys(const QString &passphrase, Completion completion) {
    if (baseUrl_.isEmpty()) {
        completion(false, {}, QStringLiteral("The media service is not available yet."));
        return;
    }
    const QJsonObject request{{QStringLiteral("passphrase"), passphrase}};
    const QByteArray body = QJsonDocument(request).toJson(QJsonDocument::Compact);
    post(QUrl(baseUrl_ + QStringLiteral("/media/ipc/room-keys/export")), body,
         QStringLiteral("application/json"), {}, std::move(completion));
}

void MediaClient::importRoomKeys(const QString &passphrase, const QByteArray &data,
                                 std::function<void(bool ok, int imported, int total,
                                                    const QString &error)> completion) {
    if (baseUrl_.isEmpty()) {
        completion(false, 0, 0, QStringLiteral("The media service is not available yet."));
        return;
    }
    post(QUrl(baseUrl_ + QStringLiteral("/media/ipc/room-keys/import")), data,
         QStringLiteral("application/octet-stream"),
         {{QByteArrayLiteral("X-Matrix-Backup-Passphrase"), passphrase.toUtf8()}},
         [completion = std::move(completion)](bool ok, const QByteArray &body,
                                              const QString &error) {
             if (!ok) {
                 completion(false, 0, 0, !body.isEmpty() ? QString::fromUtf8(body).trimmed() : error);
                 return;
             }
             const QJsonObject document = QJsonDocument::fromJson(body).object();
             completion(true, document.value(QStringLiteral("imported")).toInt(),
                        document.value(QStringLiteral("total")).toInt(), QString());
         });
}

void MediaClient::get(const QUrl &url, Completion completion) {
    QNetworkRequest request(url);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::NoLessSafeRedirectPolicy);
    request.setAttribute(QNetworkRequest::CacheLoadControlAttribute,
                         QNetworkRequest::AlwaysNetwork);
    QNetworkReply *reply = manager_.get(request);
    pending_.insert(reply, std::move(completion));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        const Completion completion = pending_.take(reply);
        reply->deleteLater();
        if (!completion) {
            return;
        }
        if (reply->error() != QNetworkReply::NoError) {
            completion(false, {}, reply->errorString());
            return;
        }
        completion(true, reply->readAll(), QString());
    });
}

void MediaClient::post(const QUrl &url, const QByteArray &body, const QString &contentType,
                       const QHash<QByteArray, QByteArray> &headers, Completion completion) {
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, contentType);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::NoLessSafeRedirectPolicy);
    request.setRawHeader("Cache-Control", "no-store");
    for (auto it = headers.constBegin(); it != headers.constEnd(); ++it) {
        request.setRawHeader(it.key(), it.value());
    }
    QNetworkReply *reply = manager_.post(request, body);
    pending_.insert(reply, std::move(completion));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        const Completion completion = pending_.take(reply);
        reply->deleteLater();
        if (!completion) {
            return;
        }
        const QByteArray payload = reply->readAll();
        if (reply->error() != QNetworkReply::NoError) {
            completion(false, payload, reply->errorString());
            return;
        }
        completion(true, payload, QString());
    });
}