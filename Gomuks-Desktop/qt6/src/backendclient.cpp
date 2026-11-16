#include "backendclient.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPointer>

#include <utility>

BackendClient::BackendClient(QObject *parent) : QObject(parent) {
    process_.setProcessChannelMode(QProcess::ForwardedErrorChannel);
    connect(&process_, &QProcess::readyReadStandardOutput, this, &BackendClient::readOutput);
    connect(&process_, &QProcess::errorOccurred, this, [this](QProcess::ProcessError) {
        const auto message = process_.errorString();
        failPending(message);
        emit backendFailed(message);
    });
    connect(&process_, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), this,
            [this](int exitCode, QProcess::ExitStatus) {
                const auto message = QStringLiteral("Backend exited (code %1)").arg(exitCode);
                failPending(message);
                emit backendFailed(message);
            });
}

BackendClient::~BackendClient() {
    if (process_.state() == QProcess::Running) {
        process_.closeWriteChannel();
        if (!process_.waitForFinished(3000)) {
            process_.terminate();
            if (!process_.waitForFinished(1000)) {
                process_.kill();
                process_.waitForFinished();
            }
        }
    }
}

bool BackendClient::start(const QString &executable, QString *error) {
    process_.start(executable, {QStringLiteral("--qt-backend")});
    if (!process_.waitForStarted(5000)) {
        *error = process_.errorString();
        return false;
    }
    return true;
}

QString BackendClient::mediaBaseUrl() const {
    return mediaBaseUrl_;
}

void BackendClient::call(const QString &method, const QJsonArray &params, Completion completion) {
    if (process_.state() != QProcess::Running) {
        completion({}, QStringLiteral("Backend is not running"));
        return;
    }

    const QString id = QString::number(nextID_++);
    pendingCalls_.insert(id, std::move(completion));
    const QJsonObject request{
        {QStringLiteral("id"), id},
        {QStringLiteral("method"), method},
        {QStringLiteral("params"), params},
    };
    auto line = QJsonDocument(request).toJson(QJsonDocument::Compact);
    line.append('\n');
    if (process_.write(line) < 0) {
        auto callback = pendingCalls_.take(id);
        if (callback) {
            callback({}, process_.errorString());
        }
    }
}

void BackendClient::call(QObject *context, const QString &method, const QJsonArray &params,
                         Completion completion) {
    if (!context) {
        completion({}, QStringLiteral("Request context is unavailable."));
        return;
    }
    const QPointer<QObject> guardedContext(context);
    call(method, params, [guardedContext, completion = std::move(completion)]
         (QJsonValue result, QString error) {
        if (guardedContext) {
            completion(std::move(result), std::move(error));
        }
    });
}

void BackendClient::readOutput() {
    pendingOutput_.append(process_.readAllStandardOutput());
    qsizetype newline = -1;
    while ((newline = pendingOutput_.indexOf('\n')) >= 0) {
        const auto line = pendingOutput_.left(newline);
        pendingOutput_.remove(0, newline + 1);
        const auto document = QJsonDocument::fromJson(line);
        if (!document.isObject()) {
            emit backendFailed(QStringLiteral("Backend sent an invalid response"));
            continue;
        }
        const auto response = document.object();
        const auto event = response.value(QStringLiteral("event")).toString();
        if (!event.isEmpty()) {
            const auto data = response.value(QStringLiteral("data"));
            if (event == QStringLiteral("media-ready") && data.isObject()) {
                mediaBaseUrl_ = data.toObject().value(QStringLiteral("url")).toString();
            }
            emit eventReceived(event, data);
            continue;
        }
        const QString id = response.value(QStringLiteral("id")).toString();
        auto callback = pendingCalls_.take(id);
        if (!callback) {
            continue;
        }
        callback(response.value(QStringLiteral("result")),
                 response.value(QStringLiteral("error")).toString());
    }
}

void BackendClient::failPending(const QString &message) {
    const auto calls = std::move(pendingCalls_);
    pendingCalls_.clear();
    for (const auto &completion : calls) {
        if (completion) {
            completion({}, message);
        }
    }
}
