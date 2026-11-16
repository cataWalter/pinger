#include "backendclient.h"
#include "mainwindow.h"
#include "stylesheet.h"

#include <QApplication>
#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QFileInfo>
#include <QMessageBox>
#include <QStandardPaths>
#include <QStringList>

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    QCoreApplication::setApplicationName(QStringLiteral("Pinger"));
    QCoreApplication::setOrganizationName(QStringLiteral("Pinger"));
    applyModernStyle(&app);

    QCommandLineParser parser;
    parser.addHelpOption();
    QCommandLineOption backendOption(
        QStringList{QStringLiteral("b"), QStringLiteral("backend")},
        QStringLiteral("Path to the Go backend executable."),
        QStringLiteral("path"));
    parser.addOption(backendOption);
    parser.process(app);

    QString backendPath = parser.value(backendOption);
    if (backendPath.isEmpty()) {
#ifdef Q_OS_WIN
        const QString sibling = QCoreApplication::applicationDirPath() + QStringLiteral("/pinger.exe");
#else
        const QString sibling = QCoreApplication::applicationDirPath() + QStringLiteral("/pinger");
#endif
        backendPath = QFileInfo::exists(sibling)
                          ? sibling
                          : QStandardPaths::findExecutable(QStringLiteral("pinger"));
    }
    if (backendPath.isEmpty()) {
        QMessageBox::critical(nullptr, QStringLiteral("Pinger"),
                              QStringLiteral("The Go backend executable was not found. Use --backend to specify it."));
        return 1;
    }

    BackendClient backend;
    QString error;
    if (!backend.start(backendPath, &error)) {
        QMessageBox::critical(nullptr, QStringLiteral("Pinger"),
                              QStringLiteral("Could not start the Go backend: %1").arg(error));
        return 1;
    }
    MainWindow window(&backend);
    window.show();
    return app.exec();
}
