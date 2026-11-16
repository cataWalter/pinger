#include "settingsdialog.h"

#include "backendclient.h"
#include "mediaclient.h"
#include "qtutil.h"
#include "stylesheet.h"

#include <QApplication>
#include <QCoreApplication>
#include <QDir>
#include <QCheckBox>
#include <QComboBox>
#include <QDateTime>
#include <QDesktopServices>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QListWidgetItem>
#include <QSet>
#include <QMessageBox>
#include <QPlainTextEdit>
#include <QPointer>
#include <QPushButton>
#include <QSettings>
#include <QSpinBox>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTextBrowser>
#include <QVBoxLayout>
#include <QUuid>

namespace {

const QStringList kLanguageCodes = {
    QStringLiteral("ar"), QStringLiteral("de"), QStringLiteral("el"), QStringLiteral("en"),
    QStringLiteral("es"), QStringLiteral("fr"), QStringLiteral("it"), QStringLiteral("ja"),
    QStringLiteral("ko"), QStringLiteral("nl"), QStringLiteral("pl"), QStringLiteral("pt"),
    QStringLiteral("ru"), QStringLiteral("sv"), QStringLiteral("tr"), QStringLiteral("zh"),
};

QString languageName(const QString &code) {
    static const QHash<QString, QString> names = {
        {QStringLiteral("ar"), QStringLiteral("Arabic")},
        {QStringLiteral("de"), QStringLiteral("German")},
        {QStringLiteral("el"), QStringLiteral("Greek")},
        {QStringLiteral("en"), QStringLiteral("English")},
        {QStringLiteral("es"), QStringLiteral("Spanish")},
        {QStringLiteral("fr"), QStringLiteral("French")},
        {QStringLiteral("it"), QStringLiteral("Italian")},
        {QStringLiteral("ja"), QStringLiteral("Japanese")},
        {QStringLiteral("ko"), QStringLiteral("Korean")},
        {QStringLiteral("nl"), QStringLiteral("Dutch")},
        {QStringLiteral("pl"), QStringLiteral("Polish")},
        {QStringLiteral("pt"), QStringLiteral("Portuguese")},
        {QStringLiteral("ru"), QStringLiteral("Russian")},
        {QStringLiteral("sv"), QStringLiteral("Swedish")},
        {QStringLiteral("tr"), QStringLiteral("Turkish")},
        {QStringLiteral("zh"), QStringLiteral("Chinese")},
    };
    return names.value(code, code);
}

QString languageLabel(const QString &code) {
    return code.isEmpty() ? QStringLiteral("Default") : QStringLiteral("%1 (%2)").arg(languageName(code), code);
}

void setLaunchAtStartup(bool enabled) {
#ifdef Q_OS_WIN
    QSettings settings(QStringLiteral("HKEY_CURRENT_USER/Software/Microsoft/Windows/CurrentVersion/Run"),
                       QSettings::NativeFormat);
    if (enabled) {
        settings.setValue(QStringLiteral("Pinger"), QCoreApplication::applicationFilePath());
    } else {
        settings.remove(QStringLiteral("Pinger"));
    }
    settings.sync();
#elif defined(Q_OS_MAC)
    Q_UNUSED(enabled);
#else
    const QString directory = QStandardPaths::writableLocation(QStandardPaths::ConfigLocation)
                              + QStringLiteral("/autostart");
    const QString path = directory + QStringLiteral("/pinger.desktop");
    if (!enabled) {
        QFile::remove(path);
        return;
    }
    QDir().mkpath(directory);
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        return;
    }
    const QString contents = QStringLiteral(
                                 "[Desktop Entry]\n"
                                 "Type=Application\n"
                                 "Name=Pinger\n"
                                 "Exec=\"%1\"\n"
                                 "X-GNOME-Autostart-enabled=true\n")
                                 .arg(QCoreApplication::applicationFilePath());
    file.write(contents.toUtf8());
    file.close();
#endif
}

class AgentEditorDialog final : public QDialog {
public:
    explicit AgentEditorDialog(const QJsonObject &preferences, QWidget *parent = nullptr)
        : QDialog(parent) {
        setWindowTitle(QStringLiteral("Chat agents"));
        resize(620, 480);
        auto *layout = new QVBoxLayout(this);
        auto *form = new QFormLayout;
        name_ = new QLineEdit(this);
        instructions_ = new QPlainTextEdit(this);
        instructions_->setMaximumHeight(120);
        form->addRow(QStringLiteral("Name"), name_);
        form->addRow(QStringLiteral("Instructions"), instructions_);
        layout->addLayout(form);

        agents_ = new QListWidget(this);
        layout->addWidget(agents_, 1);
        auto *buttons = new QHBoxLayout;
        auto *add = new QPushButton(QStringLiteral("Add"), this);
        auto *remove = new QPushButton(QStringLiteral("Remove"), this);
        auto *defaultLabel = new QLabel(QStringLiteral("Default agent"), this);
        defaultAgent_ = new QComboBox(this);
        buttons->addWidget(add);
        buttons->addWidget(remove);
        buttons->addWidget(defaultLabel);
        buttons->addWidget(defaultAgent_, 1);
        layout->addLayout(buttons);
        auto *dialogButtons = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel, this);
        layout->addWidget(dialogButtons);
        connect(dialogButtons, &QDialogButtonBox::accepted, this, &QDialog::accept);
        connect(dialogButtons, &QDialogButtonBox::rejected, this, &QDialog::reject);

        const QJsonObject stored = QJsonDocument::fromJson(
                                       qtutil::preferenceString(preferences, "ai.local_agents").toUtf8())
                                       .object();
        const QJsonArray agents = stored.value(QStringLiteral("agents")).toArray();
        QString defaultID = stored.value(QStringLiteral("defaultAgentId")).toString();
        for (const QJsonValue &value : agents) {
            const QJsonObject agent = value.toObject();
            Agent entry;
            entry.id = agent.value(QStringLiteral("id")).toString();
            if (entry.id.isEmpty()) {
                entry.id = QUuid::createUuid().toString(QUuid::WithoutBraces);
            }
            entry.name = agent.value(QStringLiteral("name")).toString();
            entry.instructions = agent.value(QStringLiteral("instructions")).toString();
            entries_.append(entry);
        }
        if (entries_.isEmpty()) {
            Agent entry;
            entry.id = QUuid::createUuid().toString(QUuid::WithoutBraces);
            entries_.append(entry);
            if (defaultID.isEmpty()) {
                defaultID = entry.id;
            }
        }
        rebuild(defaultID);

        connect(add, &QPushButton::clicked, this, [this] {
            Agent entry;
            entry.id = QUuid::createUuid().toString(QUuid::WithoutBraces);
            entries_.append(entry);
            rebuild(defaultID_);
            agents_->setCurrentRow(agents_->count() - 1);
        });
        connect(remove, &QPushButton::clicked, this, [this] {
            const int row = agents_->currentRow();
            if (row < 0 || entries_.size() <= 1) {
                return;
            }
            const QString removedID = entries_.takeAt(row).id;
            if (defaultID_ == removedID) {
                defaultID_ = entries_.isEmpty() ? QString() : entries_.first().id;
            }
            rebuild(defaultID_);
        });
        connect(agents_, &QListWidget::currentRowChanged, this, [this](int row) {
            if (row < 0 || row >= entries_.size()) {
                name_->clear();
                instructions_->clear();
                return;
            }
            name_->setText(entries_[row].name);
            instructions_->setPlainText(entries_[row].instructions);
        });
        connect(name_, &QLineEdit::textChanged, this, [this](const QString &text) {
            const int row = agents_->currentRow();
            if (row >= 0 && row < entries_.size()) {
                entries_[row].name = text;
            }
        });
        connect(instructions_, &QPlainTextEdit::textChanged, this, [this] {
            const int row = agents_->currentRow();
            if (row >= 0 && row < entries_.size()) {
                entries_[row].instructions = instructions_->toPlainText();
            }
        });
        connect(defaultAgent_, qOverload<int>(&QComboBox::currentIndexChanged), this, [this](int index) {
            if (index >= 0) {
                defaultID_ = defaultAgent_->itemData(index).toString();
            }
        });
    }

    QJsonObject collection() const {
        QJsonArray array;
        for (const Agent &agent : entries_) {
            array.append(QJsonObject{
                {QStringLiteral("id"), agent.id},
                {QStringLiteral("name"), agent.name},
                {QStringLiteral("instructions"), agent.instructions},
            });
        }
        return QJsonObject{
            {QStringLiteral("agents"), array},
            {QStringLiteral("defaultAgentId"), defaultID_},
        };
    }

private:
    struct Agent {
        QString id;
        QString name;
        QString instructions;
    };

    void rebuild(const QString &selected) {
        agents_->clear();
        for (int index = 0; index < entries_.size(); ++index) {
            const Agent &agent = entries_.at(index);
            agents_->addItem(agent.name.isEmpty() ? QStringLiteral("(unnamed agent)") : agent.name);
        }
        defaultAgent_->clear();
        for (const Agent &agent : entries_) {
            defaultAgent_->addItem(agent.name.isEmpty() ? QStringLiteral("(unnamed agent)") : agent.name,
                                   agent.id);
        }
        defaultID_ = selected;
        int selectedRow = -1;
        for (int index = 0; index < entries_.size(); ++index) {
            if (entries_[index].id == defaultID_) {
                selectedRow = index;
                break;
            }
        }
        if (selectedRow < 0 && !entries_.isEmpty()) {
            selectedRow = 0;
            defaultID_ = entries_.first().id;
        }
        const int defaultIndex = defaultAgent_->findData(defaultID_);
        if (defaultIndex >= 0) {
            defaultAgent_->setCurrentIndex(defaultIndex);
        }
        if (selectedRow >= 0) {
            agents_->setCurrentRow(selectedRow);
        }
    }

    QListWidget *agents_ = nullptr;
    QLineEdit *name_ = nullptr;
    QPlainTextEdit *instructions_ = nullptr;
    QComboBox *defaultAgent_ = nullptr;
    QList<Agent> entries_;
    QString defaultID_;
};

} // namespace

SettingsDialog::SettingsDialog(BackendClient *backend, const QJsonObject &snapshot, MediaClient *media,
                               std::function<void()> onChanged, QWidget *parent)
    : QDialog(parent), backend_(backend), media_(media), onChanged_(std::move(onChanged)) {
    setWindowTitle(QStringLiteral("Settings"));
    resize(860, 660);
    snapshot_ = snapshot;
    preferences_ = snapshot.value(QStringLiteral("preferences")).toObject();
    auto *layout = new QVBoxLayout(this);
    tabs_ = new QTabWidget(this);
    layout->addWidget(tabs_, 1);
    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Close, this);
    layout->addWidget(buttons);
    connect(buttons, &QDialogButtonBox::rejected, this, &QDialog::reject);
    connect(buttons, &QDialogButtonBox::accepted, this, &QDialog::accept);

    buildGeneral();
    buildAccount();
    buildAppearance();
    buildNotifications();
    buildKeyboard();
    buildHistory();
    buildDevices();
    buildStorage();
    buildSecurity();
    buildHelp();
    buildAbout();
    buildAI();
    buildIntegrations();
    configureListViews(this);
}

QWidget *SettingsDialog::newPage(const QString &name) {
    auto *page = new QWidget(this);
    auto *layout = new QVBoxLayout(page);
    layout->setContentsMargins(12, 12, 12, 12);
    layout->setSpacing(8);
    tabs_->addTab(page, name);
    return page;
}

QCheckBox *SettingsDialog::addBool(QWidget *page, QFormLayout *form, const QString &key,
                                   const QString &label, bool fallback) {
    Q_UNUSED(page);
    auto *check = new QCheckBox(label, this);
    check->setChecked(qtutil::preferenceBool(preferences_, key.toUtf8().constData(), fallback));
    form->addRow(check);
    connect(check, &QCheckBox::toggled, this, [this, key](bool value) {
        saveBool(key, value);
    });
    return check;
}

QComboBox *SettingsDialog::addChoice(QWidget *page, QFormLayout *form, const QString &key,
                                     const QString &label, const QStringList &values,
                                     const QString &fallback) {
    Q_UNUSED(page);
    auto *combo = new QComboBox(this);
    combo->addItems(values);
    const QString current = qtutil::preferenceString(preferences_, key.toUtf8().constData(), fallback);
    const int index = combo->findText(current);
    combo->setCurrentIndex(index >= 0 ? index : 0);
    form->addRow(label, combo);
    connect(combo, qOverload<int>(&QComboBox::currentIndexChanged), this, [this, key, combo](int) {
        saveString(key, combo->currentText());
    });
    return combo;
}

QLineEdit *SettingsDialog::addString(QWidget *page, QFormLayout *form, const QString &key,
                                     const QString &label, const QString &fallback) {
    Q_UNUSED(page);
    auto *edit = new QLineEdit(this);
    edit->setText(qtutil::preferenceString(preferences_, key.toUtf8().constData(), fallback));
    form->addRow(label, edit);
    connect(edit, &QLineEdit::editingFinished, this, [this, key, edit] {
        saveString(key, edit->text());
    });
    return edit;
}

QSpinBox *SettingsDialog::addInteger(QWidget *page, QFormLayout *form, const QString &key,
                                     const QString &label, int fallback, int minimum, int maximum) {
    Q_UNUSED(page);
    auto *spin = new QSpinBox(this);
    spin->setRange(minimum, maximum);
    spin->setValue(qtutil::preferenceString(preferences_, key.toUtf8().constData(),
                                            QString::number(fallback)).toInt());
    form->addRow(label, spin);
    connect(spin, &QSpinBox::editingFinished, this, [this, key, spin] {
        saveString(key, QString::number(spin->value()));
    });
    return spin;
}

void SettingsDialog::saveBool(const QString &key, bool value) {
    if (!backend_) {
        return;
    }
    if (key == QStringLiteral("system.launch_at_startup")) {
        setLaunchAtStartup(value);
    }
    backend_->call(this, QStringLiteral("SetBooleanPreference"), {key, value},
                   [this, key](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            QMessageBox::warning(this, QStringLiteral("Settings"),
                                 QStringLiteral("Could not save %1: %2").arg(key, error));
            return;
        }
        refresh();
        if (onChanged_) {
            onChanged_();
        }
    });
}

void SettingsDialog::saveString(const QString &key, const QString &value) {
    if (!backend_) {
        return;
    }
    backend_->call(this, QStringLiteral("SetStringPreference"), {key, value},
                   [this, key](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            QMessageBox::warning(this, QStringLiteral("Settings"),
                                 QStringLiteral("Could not save %1: %2").arg(key, error));
            return;
        }
        refresh();
        if (onChanged_) {
            onChanged_();
        }
    });
}

void SettingsDialog::saveStringBatch(const QJsonObject &values) {
    if (!backend_) {
        return;
    }
    backend_->call(this, QStringLiteral("SetStringPreferences"), {values},
                   [this](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            QMessageBox::warning(this, QStringLiteral("Settings"),
                                 QStringLiteral("Could not save the settings: %1").arg(error));
            return;
        }
        refresh();
        if (onChanged_) {
            onChanged_();
        }
    });
}

void SettingsDialog::refresh() {
    if (!backend_) {
        return;
    }
    backend_->call(this, QStringLiteral("Snapshot"), {}, [this](QJsonValue value, const QString &error) {
        if (error.isEmpty() && value.isObject()) {
            preferences_ = value.toObject().value(QStringLiteral("preferences")).toObject();
        }
    });
}

void SettingsDialog::buildGeneral() {
    auto *page = newPage(QStringLiteral("General"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *form = new QFormLayout;
    addBool(page, form, QStringLiteral("system.launch_at_startup"),
            QStringLiteral("Launch Pinger at login"));
    addBool(page, form, QStringLiteral("window.minimize_to_tray"),
            QStringLiteral("Minimize to tray when closing the window"));
    addBool(page, form, QStringLiteral("window.start_minimized"),
            QStringLiteral("Start minimized"));
    addBool(page, form, QStringLiteral("window.quit_on_close"),
            QStringLiteral("Quit Pinger when the window closes"));
    addBool(page, form, QStringLiteral("window.menu_bar_icon"),
            QStringLiteral("Show menu bar icon"));
    layout->addLayout(form);

    auto *downloads = new QGroupBox(QStringLiteral("Downloads"), page);
    auto *downloadLayout = new QFormLayout(downloads);
    auto *folderRow = new QHBoxLayout;
    auto *folder = new QLineEdit(qtutil::preferenceString(preferences_, "downloads.folder"), downloads);
    auto *browse = new QPushButton(QStringLiteral("Choose…"), downloads);
    folderRow->addWidget(folder, 1);
    folderRow->addWidget(browse);
    downloadLayout->addRow(QStringLiteral("Download folder"), folderRow);
    connect(browse, &QPushButton::clicked, this, [this, folder] {
        const QString chosen = QFileDialog::getExistingDirectory(
            this, QStringLiteral("Choose a download folder"), folder->text());
        if (!chosen.isEmpty()) {
            folder->setText(chosen);
            saveString(QStringLiteral("downloads.folder"), chosen);
        }
    });
    addBool(downloads, downloadLayout, QStringLiteral("downloads.ask_each_time"),
            QStringLiteral("Ask where to save each download"));
    layout->addWidget(downloads);

    auto *general = new QGroupBox(QStringLiteral("General"), page);
    auto *generalLayout = new QFormLayout(general);
    addChoice(page, generalLayout, QStringLiteral("messages.double_click"),
              QStringLiteral("Double-click a message"),
              {QStringLiteral("None"), QStringLiteral("Reply"), QStringLiteral("React")},
              QStringLiteral("Reply"));
    addBool(page, generalLayout, QStringLiteral("reactions.quick_enabled"),
            QStringLiteral("Show quick reaction picker"));
    addChoice(page, generalLayout, QStringLiteral("reactions.quick_source"),
              QStringLiteral("Quick reaction set"),
              {QStringLiteral("Frequent"), QStringLiteral("Custom")}, QStringLiteral("Frequent"));
    addString(page, generalLayout, QStringLiteral("reactions.default_emoji"),
              QStringLiteral("Default reaction"), QStringLiteral("👍"));
    addString(page, generalLayout, QStringLiteral("reactions.custom_emojis"),
              QStringLiteral("Custom quick reactions (up to 6)"));
    addChoice(page, generalLayout, QStringLiteral("inbox.after_read"),
              QStringLiteral("After changing a room's read state"),
              {QStringLiteral("stay"), QStringLiteral("next_visible"), QStringLiteral("next_unread"),
               QStringLiteral("none")},
              QStringLiteral("stay"));
    addChoice(page, generalLayout, QStringLiteral("archive.next_room"),
              QStringLiteral("After archiving a room"),
              {QStringLiteral("next_visible"), QStringLiteral("next_unread"), QStringLiteral("none")},
              QStringLiteral("next_visible"));
    addBool(page, generalLayout, QStringLiteral("archive.automatic"),
            QStringLiteral("Automatically archive inactive rooms"));
    addInteger(page, generalLayout, QStringLiteral("archive.older_than_days"),
               QStringLiteral("Inactive room age (days)"), 30, 1, 3650);
    addString(page, generalLayout, QStringLiteral("audio.input_device"),
              QStringLiteral("Voice-note microphone"), QStringLiteral("default"));
    addBool(page, generalLayout, QStringLiteral("voice.autoplay_next"),
            QStringLiteral("Auto-play next voice note"));
    layout->addWidget(general);

    auto *schedule = new QGroupBox(QStringLiteral("Scheduling"), page);
    auto *scheduleLayout = new QFormLayout(schedule);
    addInteger(page, scheduleLayout, QStringLiteral("schedule.default_send_minutes"),
               QStringLiteral("Default Send Later delay (minutes)"), 60, 1, 10080);
    addInteger(page, scheduleLayout, QStringLiteral("schedule.default_reminder_minutes"),
               QStringLiteral("Default Remind Later delay (minutes)"), 60, 1, 10080);
    addString(page, scheduleLayout, QStringLiteral("schedule.suggestions_minutes"),
              QStringLiteral("Schedule time suggestions (1–6 minutes)"), QStringLiteral("15,60,1440"));
    layout->addWidget(schedule);
    layout->addStretch();
}

void SettingsDialog::buildAccount() {
    auto *page = newPage(QStringLiteral("Account"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *profile = new QGroupBox(QStringLiteral("Account details"), page);
    auto *form = new QFormLayout(profile);
    const QJsonObject account = snapshot_.value(QStringLiteral("profile")).toObject();
    const QString name = qtutil::stringValue(account, "displayName",
                                             QStringLiteral("Not signed in"));
    const QString userID = qtutil::stringValue(account, "userId");
    const QString homeserver = qtutil::stringValue(account, "homeserver");
    const QString deviceID = qtutil::stringValue(account, "deviceId");
    const bool verified = qtutil::boolValue(account, "verified");
    form->addRow(QStringLiteral("Display name"), new QLabel(name, profile));
    form->addRow(QStringLiteral("User ID"), new QLabel(userID, profile));
    form->addRow(QStringLiteral("Homeserver"), new QLabel(homeserver, profile));
    form->addRow(QStringLiteral("Device"), new QLabel(deviceID, profile));
    form->addRow(QStringLiteral("Verified"),
                 new QLabel(verified ? QStringLiteral("Yes") : QStringLiteral("No"), profile));
    layout->addWidget(profile);

    auto *privacy = new QGroupBox(QStringLiteral("Privacy"), page);
    auto *privacyForm = new QFormLayout(privacy);
    addBool(page, privacyForm, QStringLiteral("appearance.show_avatars"),
            QStringLiteral("Show avatars"));
    addBool(page, privacyForm, QStringLiteral("privacy.incognito"),
            QStringLiteral("Content blur"));
    addBool(page, privacyForm, QStringLiteral("composer.keep_drafts"),
            QStringLiteral("Keep unsent drafts after restarting"));
    addBool(page, privacyForm, QStringLiteral("window.menu_bar_icon"),
            QStringLiteral("Show menu bar icon"));
    layout->addWidget(privacy);

    auto *logout = new QPushButton(QStringLiteral("Log out"), page);
    layout->addWidget(logout);
    connect(logout, &QPushButton::clicked, this, [this] {
        if (QMessageBox::question(this, QStringLiteral("Log out"),
                                  QStringLiteral("Sign out and clear this local session?"))
            != QMessageBox::Yes) {
            return;
        }
        backend_->call(this, QStringLiteral("Logout"), {},
                       [this](QJsonValue, const QString &error) {
            if (!error.isEmpty()) {
                QMessageBox::warning(this, QStringLiteral("Log out"), error);
                return;
            }
            accept();
        });
    });
    layout->addStretch();
}

void SettingsDialog::buildAppearance() {
    auto *page = newPage(QStringLiteral("Appearance"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *form = new QFormLayout;
    addChoice(page, form, QStringLiteral("appearance.theme"), QStringLiteral("Theme"),
              {QStringLiteral("System default"), QStringLiteral("Light"), QStringLiteral("Dark"),
               QStringLiteral("VS Code"), QStringLiteral("OLED black"), QStringLiteral("Bosco"),
               QStringLiteral("Rosa"), QStringLiteral("Dracula"), QStringLiteral("Midnight"),
               QStringLiteral("Slate"), QStringLiteral("Solarized"), QStringLiteral("Sepia")},
              QStringLiteral("System default"));
    addChoice(page, form, QStringLiteral("appearance.font_size"), QStringLiteral("Font size"),
              {QStringLiteral("Small"), QStringLiteral("Medium"), QStringLiteral("Large")},
              QStringLiteral("Medium"));
    addChoice(page, form, QStringLiteral("appearance.zoom"), QStringLiteral("App zoom"),
              {QStringLiteral("75"), QStringLiteral("80"), QStringLiteral("85"), QStringLiteral("90"),
               QStringLiteral("95"), QStringLiteral("100"), QStringLiteral("105"),
               QStringLiteral("110"), QStringLiteral("115"), QStringLiteral("120"),
               QStringLiteral("125")},
              QStringLiteral("100"));
    addString(page, form, QStringLiteral("appearance.bubble_color"),
              QStringLiteral("Outgoing message color (#RRGGBB)"));
    addChoice(page, form, QStringLiteral("appearance.accent_color"),
              QStringLiteral("Theme accent"),
              {QStringLiteral("Forest"), QStringLiteral("Ocean"), QStringLiteral("Rose"),
               QStringLiteral("Gold")},
              QStringLiteral("Forest"));
    addChoice(page, form, QStringLiteral("appearance.chat_wallpaper"),
              QStringLiteral("Chat wallpaper"),
              {QStringLiteral("None"), QStringLiteral("Meadow"), QStringLiteral("Tide"),
               QStringLiteral("Rose")},
              QStringLiteral("None"));
    layout->addLayout(form);

    auto *list = new QGroupBox(QStringLiteral("Chat list"), page);
    auto *listForm = new QFormLayout(list);
    addBool(page, listForm, QStringLiteral("sidebar.show_previews"),
            QStringLiteral("Show room previews"));
    addBool(page, listForm, QStringLiteral("sidebar.show_unread_counts"),
            QStringLiteral("Show unread counts"));
    addBool(page, listForm, QStringLiteral("sidebar.compact_chat_list"),
            QStringLiteral("Compact chat list"));
    addBool(page, listForm, QStringLiteral("sidebar.network_icons"),
            QStringLiteral("Show network labels in the chat list"));
    addChoice(page, listForm, QStringLiteral("sidebar.pinned_style"),
              QStringLiteral("Favorite chats"),
              {QStringLiteral("Top of list"), QStringLiteral("Star only")},
              QStringLiteral("Top of list"));
    layout->addWidget(list);

    auto *messages = new QGroupBox(QStringLiteral("Messages"), page);
    auto *messageForm = new QFormLayout(messages);
    addBool(page, messageForm, QStringLiteral("appearance.show_timestamps"),
            QStringLiteral("Show message timestamps"));
    addBool(page, messageForm, QStringLiteral("appearance.time_24_hour"),
            QStringLiteral("Use a 24-hour clock"));
    addBool(page, messageForm, QStringLiteral("appearance.relative_timestamps"),
            QStringLiteral("Use relative timestamps"));
    addBool(page, messageForm, QStringLiteral("appearance.hide_images_and_videos"),
            QStringLiteral("Hide images and videos"));
    addBool(page, messageForm, QStringLiteral("messages.url_previews"),
            QStringLiteral("Show link previews"));
    addBool(page, messageForm, QStringLiteral("messages.url_previews_encrypted"),
            QStringLiteral("Show link previews in encrypted rooms"));
    addBool(page, messageForm, QStringLiteral("appearance.hide_deleted_messages"),
            QStringLiteral("Hide deleted messages"));
    addBool(page, messageForm, QStringLiteral("appearance.balanced_text"),
            QStringLiteral("Balance message line wrapping"));
    addBool(page, messageForm, QStringLiteral("appearance.message_animations"),
            QStringLiteral("Animate new messages"));
    addBool(page, messageForm, QStringLiteral("appearance.pointer_cursor"),
            QStringLiteral("Use pointer cursor on clickable controls"));
    addBool(page, messageForm, QStringLiteral("privacy.incognito"),
            QStringLiteral("Content blur"));
    layout->addWidget(messages);
    layout->addStretch();
}

void SettingsDialog::buildNotifications() {
    auto *page = newPage(QStringLiteral("Notifications"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *form = new QFormLayout;
    addBool(page, form, QStringLiteral("notifications.enabled"),
            QStringLiteral("Enable notifications"));
    addBool(page, form, QStringLiteral("notifications.only_when_unfocused"),
            QStringLiteral("Only notify when Pinger is unfocused"));
    addBool(page, form, QStringLiteral("notifications.sound"),
            QStringLiteral("Play a notification sound"));
    addChoice(page, form, QStringLiteral("notifications.privacy"),
              QStringLiteral("Notification content"),
              {QStringLiteral("Sender and message preview"), QStringLiteral("Sender only"),
               QStringLiteral("Hidden content")},
              QStringLiteral("Sender and message preview"));
    addBool(page, form, QStringLiteral("notifications.direct"),
            QStringLiteral("Direct message alerts"));
    addBool(page, form, QStringLiteral("notifications.mentions"),
            QStringLiteral("Mention alerts"));
    addBool(page, form, QStringLiteral("notifications.group"),
            QStringLiteral("Group message alerts"));
    addChoice(page, form, QStringLiteral("notifications.sound_direct"),
              QStringLiteral("Direct message tone"),
              {QStringLiteral("Chime"), QStringLiteral("Pulse"), QStringLiteral("Soft"),
               QStringLiteral("Silent")},
              QStringLiteral("Chime"));
    addChoice(page, form, QStringLiteral("notifications.sound_mention"),
              QStringLiteral("Mention tone"),
              {QStringLiteral("Chime"), QStringLiteral("Pulse"), QStringLiteral("Soft"),
               QStringLiteral("Silent")},
              QStringLiteral("Chime"));
    addChoice(page, form, QStringLiteral("notifications.sound_group"),
              QStringLiteral("Group message tone"),
              {QStringLiteral("Chime"), QStringLiteral("Pulse"), QStringLiteral("Soft"),
               QStringLiteral("Silent")},
              QStringLiteral("Soft"));
    addChoice(page, form, QStringLiteral("notifications.batch_seconds"),
              QStringLiteral("Batch new messages (seconds)"),
              {QStringLiteral("0"), QStringLiteral("3"), QStringLiteral("10"),
               QStringLiteral("30")},
              QStringLiteral("3"));
    addChoice(page, form, QStringLiteral("notifications.repeat_minutes"),
              QStringLiteral("Repeat unread reminder (minutes)"),
              {QStringLiteral("0"), QStringLiteral("5"), QStringLiteral("15"),
               QStringLiteral("60")},
              QStringLiteral("0"));
    addBool(page, form, QStringLiteral("notifications.otp_immediate"),
            QStringLiteral("Notify one-time codes immediately"));
    addBool(page, form, QStringLiteral("notifications.otp_copy"),
            QStringLiteral("Copy one-time codes automatically"));
    addChoice(page, form, QStringLiteral("sounds.effects"),
              QStringLiteral("Sound effects"),
              {QStringLiteral("Off"), QStringLiteral("Sent messages"),
               QStringLiteral("Incoming and sent messages")},
              QStringLiteral("Off"));
    layout->addLayout(form);

    auto *buttons = new QHBoxLayout;
    auto *permission = new QPushButton(QStringLiteral("Request system permission"), page);
    auto *settings = new QPushButton(QStringLiteral("Open system notification settings"), page);
    buttons->addWidget(permission);
    buttons->addWidget(settings);
    buttons->addStretch();
    layout->addLayout(buttons);
    connect(permission, &QPushButton::clicked, this, [this] {
        if (backend_) {
            backend_->call(this, QStringLiteral("RequestNotificationPermission"), {},
                           [this](QJsonValue, const QString &error) {
                if (!error.isEmpty()) {
                    QMessageBox::information(this, QStringLiteral("Notifications"), error);
                }
            });
        }
    });
    connect(settings, &QPushButton::clicked, this, [this] {
        if (backend_) {
            backend_->call(this, QStringLiteral("OpenNotificationSettings"), {},
                           [this](QJsonValue, const QString &error) {
                if (!error.isEmpty()) {
                    QMessageBox::information(this, QStringLiteral("Notifications"), error);
                }
            });
        }
    });
    layout->addStretch();
}

void SettingsDialog::buildKeyboard() {
    auto *page = newPage(QStringLiteral("Keyboard"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *form = new QFormLayout;
    addBool(page, form, QStringLiteral("shortcuts.single_keys"),
            QStringLiteral("Enable single-key room shortcuts"), true);
    addBool(page, form, QStringLiteral("composer.ctrl_enter"),
            QStringLiteral("Use Ctrl + Enter to send"));
    addBool(page, form, QStringLiteral("composer.spellcheck"),
            QStringLiteral("Spellcheck messages"));
    addBool(page, form, QStringLiteral("composer.formatting_toolbar"),
            QStringLiteral("Show formatting toolbar"));
    addBool(page, form, QStringLiteral("composer.keep_drafts"),
            QStringLiteral("Keep unsent drafts after restarting"));
    addBool(page, form, QStringLiteral("emoji.autocomplete"),
            QStringLiteral("Suggest emoji for :shortcodes:"));
    addBool(page, form, QStringLiteral("emoji.replace_emoticons"),
            QStringLiteral("Replace emoticons as you type"));
    addBool(page, form, QStringLiteral("clipboard.copy_timestamp"),
            QStringLiteral("Include timestamps when copying messages"));
    addBool(page, form, QStringLiteral("composer.arrow_up_focus_timeline"),
            QStringLiteral("Use Up to focus the message list when the composer is empty"));
    addString(page, form, QStringLiteral("shortcuts.mark_answered"),
              QStringLiteral("Mark answered shortcut (one character)"), QStringLiteral("E"));
    layout->addLayout(form);

    auto *shortcutSearch = new QLineEdit(page);
    shortcutSearch->setClearButtonEnabled(true);
    shortcutSearch->setPlaceholderText(QStringLiteral("Find a shortcut"));
    shortcutSearch->setAccessibleName(QStringLiteral("Search keyboard shortcuts"));
    auto *shortcutList = new QListWidget(page);
    const QList<QPair<QString, QString>> shortcuts{
        {QStringLiteral("Quick switch rooms"), QStringLiteral("Ctrl / ⌘ + K")},
        {QStringLiteral("Search messages"), QStringLiteral("Ctrl / ⌘ + F")},
        {QStringLiteral("Open settings"), QStringLiteral("Ctrl / ⌘ + ,")},
        {QStringLiteral("Focus room search"), QStringLiteral("/ or Ctrl / ⌘ + Shift + S")},
        {QStringLiteral("Switch rooms"), QStringLiteral("Alt + ↑ / ↓")},
        {QStringLiteral("Switch needs-reply rooms"), QStringLiteral("Ctrl / ⌘ + Shift + ↑ / ↓")},
        {QStringLiteral("Show all rooms"), QStringLiteral("Ctrl / ⌘ + Shift + A")},
        {QStringLiteral("Show archived rooms"), QStringLiteral("Ctrl / ⌘ + Shift + H")},
        {QStringLiteral("Show unanswered rooms"), QStringLiteral("Ctrl / ⌘ + Shift + R")},
        {QStringLiteral("Show needs-reply rooms"), QStringLiteral("Ctrl / ⌘ + Shift + U")},
        {QStringLiteral("Show favorite rooms"), QStringLiteral("Ctrl / ⌘ + Shift + F")},
        {QStringLiteral("Toggle hiding images and videos"), QStringLiteral("Ctrl / ⌘ + Shift + I")},
        {QStringLiteral("Start a private model chat"), QStringLiteral("Ctrl / ⌘ + Shift + M")},
        {QStringLiteral("Jump to latest messages"), QStringLiteral("Ctrl / ⌘ + Shift + L")},
        {QStringLiteral("Switch to a visible room"), QStringLiteral("Ctrl / ⌘ + 1–9")},
        {QStringLiteral("Switch Matrix accounts"), QStringLiteral("Ctrl / ⌘ + Alt + 1–9")},
        {QStringLiteral("Open keyboard shortcuts"), QStringLiteral("?")},
        {QStringLiteral("Add room to Needs reply"), QStringLiteral("N")},
        {QStringLiteral("Toggle room unread"), QStringLiteral("U")},
        {QStringLiteral("Archive or restore room"), QStringLiteral("A")},
        {QStringLiteral("Toggle room favorite"), QStringLiteral("F")},
        {QStringLiteral("Mute or unmute room"), QStringLiteral("M")},
    };
    for (const auto &shortcut : shortcuts) {
        auto *item = new QListWidgetItem(
            QStringLiteral("%1\t%2").arg(shortcut.first, shortcut.second), shortcutList);
        item->setData(Qt::UserRole, (shortcut.first + QLatin1Char(' ') + shortcut.second).toLower());
    }
    connect(shortcutSearch, &QLineEdit::textChanged, shortcutList,
            [shortcutList](const QString &query) {
        const QString needle = query.trimmed().toLower();
        for (int index = 0; index < shortcutList->count(); ++index) {
            QListWidgetItem *item = shortcutList->item(index);
            item->setHidden(!needle.isEmpty()
                            && !item->data(Qt::UserRole).toString().contains(needle));
        }
    });
    layout->addWidget(shortcutSearch);
    layout->addWidget(shortcutList, 1);
    layout->addStretch();
}

void SettingsDialog::buildHistory() {
    auto *page = newPage(QStringLiteral("History"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *form = new QFormLayout;
    addChoice(page, form, QStringLiteral("history.initial_messages"),
              QStringLiteral("Messages to load when opening a room"),
              {QStringLiteral("25"), QStringLiteral("50"), QStringLiteral("100"),
               QStringLiteral("250"), QStringLiteral("500"), QStringLiteral("1000")},
              QStringLiteral("100"));
    layout->addLayout(form);
    layout->addStretch();
}

void SettingsDialog::buildDevices() {
    auto *page = newPage(QStringLiteral("Devices"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    deviceStatus_ = new QLabel(QStringLiteral("Loading devices…"), page);
    layout->addWidget(deviceStatus_);
    deviceList_ = new QListWidget(page);
    layout->addWidget(deviceList_, 1);
    auto *revoke = new QPushButton(QStringLiteral("Revoke selected device"), page);
    layout->addWidget(revoke);
    layout->addStretch();
    connect(revoke, &QPushButton::clicked, this, &SettingsDialog::revokeSelectedDevice);
    loadDevices();
}

void SettingsDialog::loadDevices() {
    if (!backend_) {
        return;
    }
    backend_->call(this, QStringLiteral("Devices"), {}, [this](QJsonValue value, const QString &error) {
        if (!deviceList_) {
            return;
        }
        deviceList_->clear();
        if (!error.isEmpty()) {
            deviceStatus_->setText(error);
            return;
        }
        const QJsonArray array = value.toArray();
        for (const QJsonValue &entry : array) {
            const QJsonObject device = entry.toObject();
            const QString id = qtutil::stringValue(device, "id");
            const QString name = qtutil::stringValue(device, "displayName");
            QString label = name.isEmpty() ? QStringLiteral("Unnamed device") : name;
            if (qtutil::boolValue(device, "current")) {
                label += QStringLiteral(" (this device)");
            }
            const qint64 lastSeen = qtutil::intValue(device, "lastSeenAt");
            const QString seen = lastSeen > 0
                                     ? qtutil::formatTime(lastSeen, true)
                                     : QStringLiteral("unknown");
            auto *item = new QListWidgetItem(
                QStringLiteral("%1\nLast seen: %2\nDevice ID: %3").arg(label, seen, id),
                deviceList_);
            item->setData(Qt::UserRole, id);
            item->setData(Qt::UserRole + 1, qtutil::boolValue(device, "current"));
            if (qtutil::boolValue(device, "current")) {
                item->setFlags(item->flags() & ~Qt::ItemIsSelectable);
            }
        }
        deviceStatus_->setText(array.isEmpty() ? QStringLiteral("No devices were returned.")
                                               : QStringLiteral("%1 devices").arg(array.size()));
    });
}

void SettingsDialog::revokeSelectedDevice() {
    auto *item = deviceList_ ? deviceList_->currentItem() : nullptr;
    if (!item || item->data(Qt::UserRole + 1).toBool()) {
        return;
    }
    bool accepted = false;
    const QString password = QInputDialog::getText(
        this, QStringLiteral("Confirm device revocation"),
        QStringLiteral("Matrix account password"), QLineEdit::Password, {}, &accepted);
    if (!accepted || password.isEmpty()) {
        return;
    }
    if (QMessageBox::question(this, QStringLiteral("Revoke device"),
                              QStringLiteral("Revoke device %1? It will be signed out.")
                                  .arg(item->data(Qt::UserRole).toString()))
        != QMessageBox::Yes) {
        return;
    }
    backend_->call(this, QStringLiteral("RevokeDevice"),
                   {item->data(Qt::UserRole).toString(), password},
                   [this](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            QMessageBox::warning(this, QStringLiteral("Revoke device"), error);
            return;
        }
        loadDevices();
    });
}

void SettingsDialog::buildStorage() {
    auto *page = newPage(QStringLiteral("Storage"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *form = new QFormLayout;
    dataLocationLabel_ = new QLabel(page);
    dataLocationLabel_->setWordWrap(true);
    form->addRow(QStringLiteral("Data folder"), dataLocationLabel_);
    auto *dataButtons = new QHBoxLayout;
    auto *changeData = new QPushButton(QStringLiteral("Change…"), page);
    auto *defaultData = new QPushButton(QStringLiteral("Use default"), page);
    dataButtons->addWidget(changeData);
    dataButtons->addWidget(defaultData);
    dataButtons->addStretch();
    form->addRow(QString(), dataButtons);
    layout->addLayout(form);

    storageStatus_ = new QLabel(QStringLiteral("Loading storage usage…"), page);
    storageStatus_->setWordWrap(true);
    layout->addWidget(storageStatus_);
    roomStorageList_ = new QListWidget(page);
    layout->addWidget(roomStorageList_, 1);

    auto *buttons = new QHBoxLayout;
    auto *clear = new QPushButton(QStringLiteral("Clear media cache"), page);
    auto *optimize = new QPushButton(QStringLiteral("Optimize database"), page);
    auto *exportAll = new QPushButton(QStringLiteral("Export recent messages for all chats"), page);
    buttons->addWidget(clear);
    buttons->addWidget(optimize);
    buttons->addWidget(exportAll);
    buttons->addStretch();
    layout->addLayout(buttons);
    layout->addStretch();

    connect(changeData, &QPushButton::clicked, this, &SettingsDialog::chooseDataFolder);
    connect(defaultData, &QPushButton::clicked, this, &SettingsDialog::useDefaultDataFolder);
    connect(clear, &QPushButton::clicked, this, &SettingsDialog::clearMediaCache);
    connect(optimize, &QPushButton::clicked, this, &SettingsDialog::optimizeDatabase);
    connect(exportAll, &QPushButton::clicked, this, &SettingsDialog::exportAllChats);
    loadStorageUsage();
}

void SettingsDialog::chooseDataFolder() {
    const QString folder = QFileDialog::getExistingDirectory(
        this, QStringLiteral("Choose a folder for Pinger data"));
    if (folder.isEmpty()) {
        return;
    }
    backend_->call(this, QStringLiteral("SetDataFolder"), {folder},
                   [this](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            QMessageBox::warning(this, QStringLiteral("Data folder"), error);
            return;
        }
        const QJsonObject location = value.toObject();
        dataLocationLabel_->setText(
            QStringLiteral("%1\nPending: %2")
                .arg(qtutil::stringValue(location, "dataDir"),
                     qtutil::stringValue(location, "pendingDir")));
        QMessageBox::information(this, QStringLiteral("Data folder"),
                                 QStringLiteral("The data folder will move when Pinger restarts."));
        if (onChanged_) {
            onChanged_();
        }
    });
}

void SettingsDialog::useDefaultDataFolder() {
    backend_->call(this, QStringLiteral("UseDefaultDataFolder"), {},
                   [this](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            QMessageBox::warning(this, QStringLiteral("Data folder"), error);
            return;
        }
        const QJsonObject location = value.toObject();
        dataLocationLabel_->setText(
            QStringLiteral("%1\nPending: %2")
                .arg(qtutil::stringValue(location, "dataDir"),
                     qtutil::stringValue(location, "pendingDir")));
        QMessageBox::information(this, QStringLiteral("Data folder"),
                                 QStringLiteral("The data folder will move when Pinger restarts."));
    });
}

void SettingsDialog::loadStorageUsage() {
    if (!backend_) {
        return;
    }
    backend_->call(this, QStringLiteral("DataLocation"), {},
                   [this](QJsonValue value, const QString &error) {
        if (!error.isEmpty() || !value.isObject()) {
            if (dataLocationLabel_) {
                dataLocationLabel_->setText(error.isEmpty() ? QStringLiteral("Unavailable") : error);
            }
            return;
        }
        const QJsonObject location = value.toObject();
        dataLocationLabel_->setText(
            QStringLiteral("Data: %1\nDefault: %2\nMedia cache: %3%4")
                .arg(qtutil::stringValue(location, "dataDir"),
                     qtutil::stringValue(location, "defaultDir"),
                     qtutil::stringValue(location, "mediaCacheDir"),
                     qtutil::stringValue(location, "pendingDir").isEmpty()
                         ? QString()
                         : QStringLiteral("\nPending: %1")
                               .arg(qtutil::stringValue(location, "pendingDir"))));
    });
    backend_->call(this, QStringLiteral("StorageUsage"), {},
                   [this](QJsonValue value, const QString &error) {
        if (storageStatus_ && !error.isEmpty()) {
            storageStatus_->setText(error);
            return;
        }
        backend_->call(this, QStringLiteral("MediaCacheUsage"), {},
                       [this, value](QJsonValue mediaValue, const QString &mediaError) {
            if (!storageStatus_) {
                return;
            }
            const QJsonObject database = value.toObject();
            const QJsonObject media = mediaValue.toObject();
            const qint64 databaseBytes = qtutil::intValue(database, "databaseBytes")
                                         + qtutil::intValue(database, "walBytes");
            storageStatus_->setText(
                QStringLiteral("Database: %1\nMedia cache: %2 (%3 files)")
                    .arg(qtutil::formatBytes(databaseBytes),
                         qtutil::formatBytes(qtutil::intValue(media, "bytes")),
                         QString::number(qtutil::intValue(media, "files"))));
            if (!mediaError.isEmpty()) {
                storageStatus_->setText(storageStatus_->text() + QStringLiteral("\n%1").arg(mediaError));
            }
        });
        backend_->call(this, QStringLiteral("RoomStorageUsage"), {},
                       [this](QJsonValue roomValue, const QString &roomError) {
            if (!roomStorageList_) {
                return;
            }
            roomStorageList_->clear();
            if (!roomError.isEmpty()) {
                return;
            }
            for (const QJsonValue &entry : roomValue.toArray()) {
                const QJsonObject room = entry.toObject();
                const QString name = qtutil::stringValue(room, "name");
                const qint64 media = qtutil::intValue(room, "mediaBytes");
                const qint64 text = qtutil::intValue(room, "textBytes");
                auto *item = new QListWidgetItem(
                    QStringLiteral("%1\nMessages: %2 · Text: %3 · Media: %4")
                        .arg(name,
                             QString::number(qtutil::intValue(room, "messages")),
                             qtutil::formatBytes(text),
                             qtutil::formatBytes(media)),
                    roomStorageList_);
                item->setData(Qt::UserRole, qtutil::stringValue(room, "roomId"));
            }
        });
    });
}

void SettingsDialog::clearMediaCache() {
    if (QMessageBox::question(this, QStringLiteral("Clear media cache"),
                              QStringLiteral("Delete cached media? Messages and keys are kept."))
        != QMessageBox::Yes) {
        return;
    }
    backend_->call(this, QStringLiteral("ClearMediaCache"), {},
                   [this](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            QMessageBox::warning(this, QStringLiteral("Clear media cache"), error);
            return;
        }
        loadStorageUsage();
    });
}

void SettingsDialog::optimizeDatabase() {
    backend_->call(this, QStringLiteral("OptimizeDatabase"), {},
                   [this](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            QMessageBox::warning(this, QStringLiteral("Optimize database"), error);
            return;
        }
        loadStorageUsage();
    });
}

void SettingsDialog::exportAllChats() {
    const QString directory = QFileDialog::getExistingDirectory(
        this, QStringLiteral("Choose a folder for the export"));
    if (directory.isEmpty()) {
        return;
    }
    QDialog dialog(this);
    dialog.setWindowTitle(QStringLiteral("Export recent messages"));
    auto *layout = new QVBoxLayout(&dialog);
    auto *limit = new QSpinBox(&dialog);
    limit->setRange(1, 100000);
    limit->setValue(1000);
    auto *form = new QFormLayout;
    form->addRow(QStringLiteral("Messages per chat"), limit);
    layout->addLayout(form);
    auto *privateChats = new QCheckBox(QStringLiteral("Private chats"), &dialog);
    auto *groupChats = new QCheckBox(QStringLiteral("Group chats"), &dialog);
    auto *mine = new QCheckBox(QStringLiteral("My messages"), &dialog);
    auto *theirs = new QCheckBox(QStringLiteral("Their messages"), &dialog);
    auto *deleted = new QCheckBox(QStringLiteral("Deleted messages"), &dialog);
    privateChats->setChecked(true);
    groupChats->setChecked(true);
    mine->setChecked(true);
    theirs->setChecked(true);
    layout->addWidget(privateChats);
    layout->addWidget(groupChats);
    layout->addWidget(mine);
    layout->addWidget(theirs);
    layout->addWidget(deleted);
    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel, &dialog);
    layout->addWidget(buttons);
    connect(buttons, &QDialogButtonBox::accepted, &dialog, &QDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    if (dialog.exec() != QDialog::Accepted) {
        return;
    }
    const QJsonObject options{
        {QStringLiteral("privateChats"), privateChats->isChecked()},
        {QStringLiteral("groupChats"), groupChats->isChecked()},
        {QStringLiteral("myMessages"), mine->isChecked()},
        {QStringLiteral("theirMessages"), theirs->isChecked()},
        {QStringLiteral("deletedMessages"), deleted->isChecked()},
    };
    backend_->call(this, QStringLiteral("ExportRecentMessagesForAllChats"),
                   {directory, limit->value(), options},
                   [this](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            QMessageBox::warning(this, QStringLiteral("Export recent messages"), error);
            return;
        }
        const QJsonObject result = value.toObject();
        QMessageBox::information(
            this, QStringLiteral("Export recent messages"),
            QStringLiteral("Wrote %1 messages from %2 chats to %3%4")
                .arg(qtutil::intValue(result, "messages"))
                .arg(qtutil::intValue(result, "chats"))
                .arg(qtutil::stringValue(result, "path"))
                .arg(qtutil::boolValue(result, "cancelled")
                         ? QStringLiteral("\nThe export was cancelled.")
                         : QString()));
    });
}

void SettingsDialog::buildSecurity() {
    auto *page = newPage(QStringLiteral("Security"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *form = new QFormLayout;
    form->addRow(QStringLiteral("Verification"),
                 new QLabel(QStringLiteral("Use Devices to verify this session with your other devices."),
                            page));
    layout->addLayout(form);

    auto *backup = new QGroupBox(QStringLiteral("Room key backup"), page);
    auto *backupLayout = new QFormLayout(backup);
    auto *exportButton = new QPushButton(QStringLiteral("Export room keys…"), backup);
    auto *importButton = new QPushButton(QStringLiteral("Import room keys…"), backup);
    auto *buttons = new QHBoxLayout;
    buttons->addWidget(exportButton);
    buttons->addWidget(importButton);
    buttons->addStretch();
    backupLayout->addRow(QString(), buttons);
    layout->addWidget(backup);
    layout->addStretch();

    connect(exportButton, &QPushButton::clicked, this, [this] {
        exportRoomKeys();
    });
    connect(importButton, &QPushButton::clicked, this, [this] {
        importRoomKeys();
    });
}

void SettingsDialog::exportRoomKeys() {
    if (!media_) {
        return;
    }
    bool accepted = false;
    const QString passphrase = QInputDialog::getText(
        this, QStringLiteral("Export room keys"), QStringLiteral("Backup passphrase"),
        QLineEdit::Password, {}, &accepted);
    if (!accepted || passphrase.isEmpty()) {
        return;
    }
    const QString path = QFileDialog::getSaveFileName(
        this, QStringLiteral("Save room keys"), QStringLiteral("matrix-room-keys.txt"));
    if (path.isEmpty()) {
        return;
    }
    const QPointer<SettingsDialog> self(this);
    media_->exportRoomKeys(passphrase,
                           [self, path](bool ok, const QByteArray &data, const QString &error) {
        if (!self) {
            return;
        }
        if (!ok) {
            QMessageBox::warning(self, QStringLiteral("Export room keys"), error);
            return;
        }
        QFile file(path);
        if (!file.open(QIODevice::WriteOnly)) {
            QMessageBox::warning(self, QStringLiteral("Export room keys"), file.errorString());
            return;
        }
        const qint64 written = file.write(data);
        file.close();
        if (written != data.size()) {
            QMessageBox::warning(self, QStringLiteral("Export room keys"),
                                 QStringLiteral("Could not write the room key backup completely."));
            return;
        }
        QMessageBox::information(self, QStringLiteral("Export room keys"),
                                 QStringLiteral("Room keys saved to %1").arg(path));
    });
}

void SettingsDialog::importRoomKeys() {
    if (!media_) {
        return;
    }
    const QString path = QFileDialog::getOpenFileName(this, QStringLiteral("Import room keys"));
    if (path.isEmpty()) {
        return;
    }
    bool accepted = false;
    const QString passphrase = QInputDialog::getText(
        this, QStringLiteral("Import room keys"), QStringLiteral("Backup passphrase"),
        QLineEdit::Password, {}, &accepted);
    if (!accepted || passphrase.isEmpty()) {
        return;
    }
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        QMessageBox::warning(this, QStringLiteral("Import room keys"), file.errorString());
        return;
    }
    constexpr qint64 maximumRoomKeyBackupBytes = 100LL * 1024 * 1024;
    if (file.size() <= 0 || file.size() > maximumRoomKeyBackupBytes) {
        QMessageBox::warning(this, QStringLiteral("Import room keys"),
                             file.size() <= 0 ? QStringLiteral("The room key backup is empty.")
                                              : QStringLiteral("Room key backups cannot exceed 100 MiB."));
        return;
    }
    const QByteArray data = file.readAll();
    if (data.size() != file.size()) {
        QMessageBox::warning(this, QStringLiteral("Import room keys"),
                             file.errorString().isEmpty()
                                 ? QStringLiteral("The room key backup could not be read completely.")
                                 : file.errorString());
        return;
    }
    const QPointer<SettingsDialog> self(this);
    media_->importRoomKeys(passphrase, data,
                           [self](bool ok, int imported, int total, const QString &error) {
        if (!self) {
            return;
        }
        if (!ok) {
            QMessageBox::warning(self, QStringLiteral("Import room keys"), error);
            return;
        }
        QMessageBox::information(self, QStringLiteral("Import room keys"),
                                 QStringLiteral("Imported %1 of %2 room keys.").arg(imported).arg(total));
    });
}

void SettingsDialog::buildHelp() {
    auto *page = newPage(QStringLiteral("Help"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *browser = new QTextBrowser(page);
    browser->setOpenExternalLinks(true);
    browser->setHtml(QStringLiteral(
        "<h2>Pinger Help</h2>"
        "<p>Pinger is a Matrix desktop client.</p>"
        "<ul>"
        "<li><a href=\"https://github.com/cataWalter/pinger/issues\">Report an issue</a></li>"
        "<li><a href=\"https://github.com/cataWalter/pinger\">Project repository</a></li>"
        "<li><a href=\"https://github.com/cataWalter/pinger/releases\">Release notes</a></li>"
        "<li><a href=\"https://github.com/cataWalter/pinger/blob/main/LICENSE\">License</a></li>"
        "</ul>"
        "<h3>Storage and media</h3>"
        "<p>Clearing the media cache deletes downloaded attachments. Messages and encryption keys are kept.</p>"
        "<h3>Local AI</h3>"
        "<p>Pinger connects to a llama-server or another OpenAI-compatible endpoint you run yourself. Set the endpoint in the AI tab.</p>"));
    layout->addWidget(browser, 1);
}

void SettingsDialog::buildAbout() {
    auto *page = newPage(QStringLiteral("About"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    versionLabel_ = new QLabel(page);
    versionLabel_->setWordWrap(true);
    layout->addWidget(versionLabel_);
    auto *form = new QFormLayout;
    auto *version = new QPushButton(QStringLiteral("Check for updates"), page);
    auto *repository = new QPushButton(QStringLiteral("Open project repository"), page);
    auto *license = new QPushButton(QStringLiteral("Open license"), page);
    form->addRow(QString(), version);
    form->addRow(QString(), repository);
    form->addRow(QString(), license);
    layout->addLayout(form);
    layout->addStretch();
    connect(version, &QPushButton::clicked, this, &SettingsDialog::checkForUpdates);
    connect(repository, &QPushButton::clicked, this, [this] {
        openURL(QStringLiteral("https://github.com/cataWalter/pinger"));
    });
    connect(license, &QPushButton::clicked, this, [this] {
        openURL(QStringLiteral("https://github.com/cataWalter/pinger/blob/main/LICENSE"));
    });
    backend_->call(this, QStringLiteral("AppVersion"), {},
                   [this](QJsonValue value, const QString &error) {
        backend_->call(this, QStringLiteral("AppBuildInfo"), {},
                       [this, value, error](QJsonValue buildValue, const QString &buildError) {
            const QJsonObject build = buildValue.toObject();
            versionLabel_->setText(
                QStringLiteral("Pinger %1\nCommit: %2\nBuild date: %3")
                    .arg(error.isEmpty() ? value.toString() : QStringLiteral("dev"),
                         qtutil::stringValue(build, "commit"),
                         qtutil::stringValue(build, "buildDate")));
            if (!buildError.isEmpty()) {
                versionLabel_->setText(versionLabel_->text() + QStringLiteral("\n%1").arg(buildError));
            }
        });
    });
}

void SettingsDialog::checkForUpdates() {
    backend_->call(this, QStringLiteral("CheckForUpdates"), {},
                   [this](QJsonValue value, const QString &error) {
        const QJsonObject status = value.toObject();
        const QString message = !error.isEmpty()
                                    ? error
                                    : qtutil::stringValue(status, "message",
                                                          QStringLiteral("No update information."));
        QMessageBox::information(this, QStringLiteral("Check for updates"), message);
    });
}

void SettingsDialog::openURL(const QString &url) {
    QDesktopServices::openUrl(QUrl(url));
}

void SettingsDialog::buildAI() {
    auto *page = newPage(QStringLiteral("AI"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *form = new QFormLayout;
    aiEndpoint_ = addString(page, form, QStringLiteral("ai.endpoint"),
                            QStringLiteral("Endpoint (localhost)"), QStringLiteral("http://127.0.0.1:11434"));
    aiModel_ = addString(page, form, QStringLiteral("ai.model"),
                         QStringLiteral("Model (optional)"));
    aiThinking_ = addChoice(page, form, QStringLiteral("ai.thinking_level"),
                            QStringLiteral("Thinking level"),
                            {QStringLiteral("none"), QStringLiteral("low"), QStringLiteral("medium"),
                             QStringLiteral("high")},
                            QStringLiteral("none"));
    aiTranscription_ = addString(page, form, QStringLiteral("ai.transcription_model"),
                                 QStringLiteral("Transcription model (optional)"));
    addBool(page, form, QStringLiteral("ai.detect_chat_language"),
            QStringLiteral("Detect chat language automatically"));
    layout->addLayout(form);

    auto *buttons = new QHBoxLayout;
    auto *test = new QPushButton(QStringLiteral("Test endpoint"), page);
    aiStatus_ = new QLabel(page);
    aiStatus_->setWordWrap(true);
    buttons->addWidget(test);
    buttons->addWidget(aiStatus_, 1);
    layout->addLayout(buttons);
    connect(test, &QPushButton::clicked, this, &SettingsDialog::testAIEndpoint);

    auto *languages = new QGroupBox(QStringLiteral("Language Tutor"), page);
    auto *languageLayout = new QFormLayout(languages);
    tutorLanguage_ = new QComboBox(languages);
    tutorLanguage_->addItem(languageLabel(QString()), QString());
    for (const QString &code : kLanguageCodes) {
        tutorLanguage_->addItem(languageLabel(code), code);
    }
    const QString learning = qtutil::preferenceString(preferences_, "ai.tutor_language", QStringLiteral("tr"));
    const int learningIndex = tutorLanguage_->findData(learning);
    tutorLanguage_->setCurrentIndex(learningIndex >= 0 ? learningIndex : 0);
    languageLayout->addRow(QStringLiteral("Language you are learning"), tutorLanguage_);
    connect(tutorLanguage_, qOverload<int>(&QComboBox::currentIndexChanged), this, [this](int) {
        const QString defaultCode = qtutil::preferenceString(preferences_, "ai.default_language",
                                                             QStringLiteral("en"));
        const QString learningCode = tutorLanguage_->currentData().toString();
        if (!learningCode.isEmpty() && learningCode == defaultCode) {
            QMessageBox::warning(this, QStringLiteral("Language Tutor"),
                                 QStringLiteral("The learning language must differ from the default language."));
            return;
        }
        saveStringBatch({{QStringLiteral("ai.tutor_language"), learningCode}});
    });

    defaultLanguage_ = new QComboBox(languages);
    defaultLanguage_->addItem(languageLabel(QString()), QString());
    for (const QString &code : kLanguageCodes) {
        defaultLanguage_->addItem(languageLabel(code), code);
    }
    const QString defaultCode = qtutil::preferenceString(preferences_, "ai.default_language",
                                                         QStringLiteral("en"));
    const int defaultIndex = defaultLanguage_->findData(defaultCode);
    defaultLanguage_->setCurrentIndex(defaultIndex >= 0 ? defaultIndex : 0);
    languageLayout->addRow(QStringLiteral("Explanation language"), defaultLanguage_);
    connect(defaultLanguage_, qOverload<int>(&QComboBox::currentIndexChanged), this, [this](int) {
        const QString learningCode = tutorLanguage_->currentData().toString();
        const QString explanation = defaultLanguage_->currentData().toString();
        if (!learningCode.isEmpty() && learningCode == explanation) {
            QMessageBox::warning(this, QStringLiteral("Language Tutor"),
                                 QStringLiteral("The learning language must differ from the default language."));
            return;
        }
        saveStringBatch({{QStringLiteral("ai.default_language"), explanation}});
    });

    knownLanguages_ = new QListWidget(languages);
    knownLanguages_->setMaximumHeight(150);
    const QJsonArray known = QJsonDocument::fromJson(
                                 qtutil::preferenceString(preferences_, "ai.known_languages",
                                                          QStringLiteral("[\"en\"]"))
                                     .toUtf8())
                                 .array();
    for (const QString &code : kLanguageCodes) {
        auto *item = new QListWidgetItem(languageName(code), knownLanguages_);
        item->setData(Qt::UserRole, code);
        item->setFlags(item->flags() | Qt::ItemIsUserCheckable);
        bool checked = false;
        for (const QJsonValue &value : known) {
            if (value.toString() == code) {
                checked = true;
                break;
            }
        }
        item->setCheckState(checked ? Qt::Checked : Qt::Unchecked);
    }
    languageLayout->addRow(QStringLiteral("Languages you know"), knownLanguages_);
    connect(knownLanguages_, &QListWidget::itemChanged, this, [this](QListWidgetItem *) {
        QJsonArray codes;
        for (int index = 0; index < knownLanguages_->count(); ++index) {
            auto *item = knownLanguages_->item(index);
            if (item->checkState() == Qt::Checked) {
                codes.append(item->data(Qt::UserRole).toString());
            }
        }
        saveString(QStringLiteral("ai.known_languages"),
                   QString::fromUtf8(QJsonDocument(codes).toJson(QJsonDocument::Compact)));
    });
    layout->addWidget(languages);

    auto *agentsButton = new QPushButton(QStringLiteral("Edit chat agents…"), page);
    layout->addWidget(agentsButton);
    connect(agentsButton, &QPushButton::clicked, this, [this] {
        AgentEditorDialog dialog(preferences_, this);
        if (dialog.exec() == QDialog::Accepted) {
            saveString(QStringLiteral("ai.local_agents"),
                       QString::fromUtf8(QJsonDocument(dialog.collection()).toJson(QJsonDocument::Compact)));
        }
    });

    auto *tuning = new QGroupBox(QStringLiteral("Prompts and tuning"), page);
    auto *tuningLayout = new QVBoxLayout(tuning);
    featureList_ = new QListWidget(tuning);
    featureList_->setMaximumHeight(120);
    featurePrompt_ = new QPlainTextEdit(tuning);
    featurePrompt_->setMaximumHeight(100);
    auto *tuningForm = new QFormLayout;
    featureTemperature_ = new QDoubleSpinBox(tuning);
    featureTemperature_->setRange(0.6, 2.0);
    featureTemperature_->setSingleStep(0.1);
    featureMaxTokens_ = new QSpinBox(tuning);
    featureMaxTokens_->setRange(0, 8192);
    tuningForm->addRow(QStringLiteral("Temperature"), featureTemperature_);
    tuningForm->addRow(QStringLiteral("Max tokens"), featureMaxTokens_);
    tuningLayout->addWidget(featureList_);
    tuningLayout->addWidget(featurePrompt_);
    tuningLayout->addLayout(tuningForm);
    auto *saveTuning = new QPushButton(QStringLiteral("Save tuning"), tuning);
    tuningLayout->addWidget(saveTuning);
    layout->addWidget(tuning, 1);

    connect(featureList_, &QListWidget::currentRowChanged, this, [this](int row) {
        if (row < 0 || !featureList_->item(row)) {
            return;
        }
        auto *item = featureList_->item(row);
        if (!item) {
            return;
        }
        const QJsonObject values =
            item->data(Qt::UserRole + 1).value<QJsonObject>();
        featurePrompt_->setPlainText(qtutil::stringValue(values, "prompt"));
        featureTemperature_->setValue(qtutil::stringValue(values, "temperature").toDouble());
        featureMaxTokens_->setValue(qtutil::stringValue(values, "maxTokens").toInt());
    });
    connect(saveTuning, &QPushButton::clicked, this, [this] {
        auto *item = featureList_->currentItem();
        if (!item) {
            return;
        }
        const QString id = item->data(Qt::UserRole).toString();
        const QString temperature = QString::number(featureTemperature_->value(), 'f', 2);
        const QString maxTokens = featureMaxTokens_->value() > 0
                                      ? QString::number(featureMaxTokens_->value())
                                      : QString();
        saveStringBatch({
            {QStringLiteral("ai.feature.%1.prompt").arg(id), featurePrompt_->toPlainText()},
            {QStringLiteral("ai.feature.%1.temperature").arg(id), temperature},
            {QStringLiteral("ai.feature.%1.max_tokens").arg(id), maxTokens},
        });
    });
    loadAIFeatureDefaults();
    layout->addStretch();
}

void SettingsDialog::loadAIFeatureDefaults() {
    if (!backend_) {
        return;
    }
    backend_->call(this, QStringLiteral("AIFeatureDefaults"), {},
                   [this](QJsonValue value, const QString &error) {
        if (!featureList_) {
            return;
        }
        featureList_->clear();
        if (!error.isEmpty()) {
            aiStatus_->setText(error);
            return;
        }
        const QJsonArray features = value.toArray();
        featureDefaults_ = features;
        for (const QJsonValue &entry : features) {
            const QJsonObject feature = entry.toObject();
            auto *item = new QListWidgetItem(qtutil::stringValue(feature, "label"), featureList_);
            item->setData(Qt::UserRole, qtutil::stringValue(feature, "id"));
            const QString id = item->data(Qt::UserRole).toString();
            const QString prompt = qtutil::preferenceString(
                preferences_, QStringLiteral("ai.feature.%1.prompt").arg(id).toUtf8().constData(),
                qtutil::stringValue(feature, "prompt"));
            const QString temperature = qtutil::preferenceString(
                preferences_, QStringLiteral("ai.feature.%1.temperature").arg(id).toUtf8().constData(),
                QString::number(qtutil::doubleValue(feature, "temperature", 1.0), 'f', 2));
            const QString maxTokens = qtutil::preferenceString(
                preferences_, QStringLiteral("ai.feature.%1.max_tokens").arg(id).toUtf8().constData(),
                QString::number(qtutil::intValue(feature, "maxTokens")));
            item->setData(Qt::UserRole + 1, QJsonObject{
                                               {QStringLiteral("prompt"), prompt},
                                               {QStringLiteral("temperature"), temperature},
                                               {QStringLiteral("maxTokens"), maxTokens},
                                           });
        }
        if (featureList_->count() > 0) {
            featureList_->setCurrentRow(0);
        }
    });
}

void SettingsDialog::testAIEndpoint() {
    if (!backend_) {
        return;
    }
    aiStatus_->setText(QStringLiteral("Testing…"));
    backend_->call(this, QStringLiteral("TestAIEndpoint"), {},
                   [this](QJsonValue, const QString &error) {
        aiStatus_->setText(error.isEmpty() ? QStringLiteral("The AI endpoint is reachable.")
                                           : error);
    });
}

void SettingsDialog::buildIntegrations() {
    auto *page = newPage(QStringLiteral("Integrations"));
    auto *layout = qobject_cast<QVBoxLayout *>(page->layout());
    auto *label = new QLabel(QStringLiteral("Detected chat networks"), page);
    label->setProperty("role", QStringLiteral("heading"));
    layout->addWidget(label);
    auto *list = new QListWidget(page);
    layout->addWidget(list, 1);
    const QJsonArray rooms = snapshot_.value(QStringLiteral("rooms")).toArray();
    QSet<QString> bridges;
    for (const QJsonValue &value : rooms) {
        const QString bridge = qtutil::stringValue(value.toObject(), "bridge");
        if (!bridge.isEmpty()) {
            bridges.insert(bridge);
        }
    }
    for (const QString &bridge : bridges) {
        list->addItem(bridge);
    }
    if (bridges.isEmpty()) {
        list->addItem(QStringLiteral("No bridged networks were detected."));
    }
    layout->addStretch();
}

void SettingsDialog::chooseDownloadFolder() {
    const QString folder = QFileDialog::getExistingDirectory(
        this, QStringLiteral("Choose a download folder"));
    if (!folder.isEmpty()) {
        saveString(QStringLiteral("downloads.folder"), folder);
    }
}
