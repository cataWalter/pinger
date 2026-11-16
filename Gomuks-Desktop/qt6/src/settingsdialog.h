#pragma once

#include <QDialog>
#include <QJsonArray>
#include <QJsonObject>

#include <functional>

class BackendClient;
class MediaClient;
class QCheckBox;
class QComboBox;
class QDoubleSpinBox;
class QFormLayout;
class QLineEdit;
class QLabel;
class QListWidget;
class QPlainTextEdit;
class QSpinBox;
class QTabWidget;
class QWidget;

class SettingsDialog final : public QDialog {
    Q_OBJECT

public:
    SettingsDialog(BackendClient *backend, const QJsonObject &snapshot, MediaClient *media,
                   std::function<void()> onChanged, QWidget *parent = nullptr);

private:
    QWidget *newPage(const QString &name);
    void buildGeneral();
    void buildAccount();
    void buildAppearance();
    void buildNotifications();
    void buildKeyboard();
    void buildHistory();
    void buildDevices();
    void buildStorage();
    void buildSecurity();
    void buildHelp();
    void buildAbout();
    void buildAI();
    void buildIntegrations();

    QCheckBox *addBool(QWidget *page, QFormLayout *form, const QString &key,
                       const QString &label, bool fallback = false);
    QComboBox *addChoice(QWidget *page, QFormLayout *form, const QString &key,
                         const QString &label, const QStringList &values,
                         const QString &fallback);
    QLineEdit *addString(QWidget *page, QFormLayout *form, const QString &key,
                         const QString &label, const QString &fallback = QString());
    QSpinBox *addInteger(QWidget *page, QFormLayout *form, const QString &key,
                         const QString &label, int fallback, int minimum, int maximum);

    void saveBool(const QString &key, bool value);
    void saveString(const QString &key, const QString &value);
    void saveStringBatch(const QJsonObject &values);
    void refresh();

    void chooseDownloadFolder();
    void chooseDataFolder();
    void useDefaultDataFolder();
    void loadStorageUsage();
    void clearMediaCache();
    void optimizeDatabase();
    void exportAllChats();
    void revokeSelectedDevice();
    void loadDevices();
    void exportRoomKeys();
    void importRoomKeys();
    void testAIEndpoint();
    void checkForUpdates();
    void openURL(const QString &url);
    void loadAIFeatureDefaults();

    BackendClient *backend_ = nullptr;
    MediaClient *media_ = nullptr;
    std::function<void()> onChanged_;
    QJsonObject snapshot_;
    QJsonObject preferences_;
    QTabWidget *tabs_ = nullptr;
    QListWidget *deviceList_ = nullptr;
    QLabel *deviceStatus_ = nullptr;
    QListWidget *roomStorageList_ = nullptr;
    QLabel *storageStatus_ = nullptr;
    QLabel *dataLocationLabel_ = nullptr;
    QLabel *versionLabel_ = nullptr;
    QLabel *aiStatus_ = nullptr;
    QLineEdit *aiEndpoint_ = nullptr;
    QLineEdit *aiModel_ = nullptr;
    QComboBox *aiThinking_ = nullptr;
    QLineEdit *aiTranscription_ = nullptr;
    QComboBox *tutorLanguage_ = nullptr;
    QComboBox *defaultLanguage_ = nullptr;
    QListWidget *knownLanguages_ = nullptr;
    QListWidget *featureList_ = nullptr;
    QPlainTextEdit *featurePrompt_ = nullptr;
    QDoubleSpinBox *featureTemperature_ = nullptr;
    QSpinBox *featureMaxTokens_ = nullptr;
    QJsonArray featureDefaults_;
};