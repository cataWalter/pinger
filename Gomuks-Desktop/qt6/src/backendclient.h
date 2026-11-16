#pragma once

#include <QJsonValue>
#include <QHash>
#include <QObject>
#include <QProcess>
#include <QString>
#include <QJsonArray>

#include <functional>

class BackendClient final : public QObject {
    Q_OBJECT

public:
    using Completion = std::function<void(QJsonValue result, QString error)>;

    explicit BackendClient(QObject *parent = nullptr);
    ~BackendClient() override;
    bool start(const QString &executable, QString *error);
    QString mediaBaseUrl() const;
    void call(const QString &method, const QJsonArray &params, Completion completion);
    void call(QObject *context, const QString &method, const QJsonArray &params,
              Completion completion);

signals:
    void eventReceived(const QString &name, const QJsonValue &data);
    void backendFailed(const QString &message);

private:
    void readOutput();
    void failPending(const QString &message);

    QProcess process_;
    QByteArray pendingOutput_;
    QHash<QString, Completion> pendingCalls_;
    quint64 nextID_ = 1;
    QString mediaBaseUrl_;
};
