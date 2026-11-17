#include "stylesheet.h"

#include <QApplication>
#include <QAbstractItemView>
#include <QColor>
#include <QListView>
#include <QPalette>
#include <QStyleFactory>
#include <QWidget>

QString applicationStyleSheet() {
    return QStringLiteral(R"QSS(
        * { outline: 0; }
        QWidget { color: #EAF1FC; background: transparent; }
        QMainWindow, QStackedWidget, QDialog { background: #0E1928; }
        QWidget#chatPage, QWidget#conversation { background: #0E1928; }
        QWidget#sidebar { background: #0B1524; border-right: 1px solid #24364D; }
        QLabel { color: #EAF1FC; }
        QLabel#roomsSectionLabel { color: #91A3BB; font-size: 10px; font-weight: 700; letter-spacing: 1.2px; }
        QLabel#roomsCount { color: #9AABC2; background: #16263B; border-radius: 9px; padding: 2px 6px; font-size: 10px; }
        QLabel#filterCountBadge {
            color: #0E1928; background: #D67593; border: 1px solid #0B1524;
            border-radius: 7px; font-size: 8px; font-weight: 700; padding: 0;
        }
        QLabel#profileAvatar, QLabel#roomAvatar {
            color: #EAF1FC; background: #263A54; font-weight: 700;
        }
        QLabel#profileAvatar { border-radius: 18px; font-size: 12px; }
        QLabel#roomAvatar { border-radius: 20px; font-size: 14px; }
        QLabel#profileName { color: #EAF1FC; font-size: 12px; font-weight: 600; }
        QLabel#profileID { color: #8395AE; font-size: 10px; }
        QFrame#profileFooter { background: #111F32; border: 1px solid #253850; border-radius: 13px; }
        QFrame#conversationHeader { background: #142238; border-bottom: 1px solid #2B3D55; }
        QLabel#roomTitle { background: transparent; color: #EAF1FC; font-size: 15px; font-weight: 600; }
        QLabel#roomSubtitle { background: transparent; color: #91A3BB; font-size: 11px; }
        QLabel#verificationSAS {
            color: #F0A2B5; background: #142238; border: 1px solid #354B66;
            border-radius: 12px; padding: 12px;
        }
        QLabel#verificationError { color: #F48B9E; }
        QLabel#composeContext { color: #A7B7CC; padding: 8px 14px; }
        QWidget#sidebar QComboBox, QWidget#sidebar QLineEdit#roomSearchField {
            background: #142238; border: 1px solid #293C55; padding: 8px 12px; border-radius: 11px;
        }
        QWidget#sidebar QLineEdit:focus { border: 1px solid #526B8A; }

        QFrame#composerPanel {
            background: #17263B; border: 1px solid #344963; border-radius: 16px;
            margin: 0 22px 16px 22px;
        }
        QFrame#composerPanel QPlainTextEdit#composerInput {
            background: transparent; border: none; border-radius: 8px;
            padding: 5px 3px; color: #EAF1FC;
        }
        QFrame#composerPanel QPlainTextEdit#composerInput:focus { border: none; }
        QFrame#composerSuggestions {
            background: #142238; border: 1px solid #344963; border-radius: 12px;
        }
        QListWidget#composerSuggestionList {
            background: transparent; border: none; padding: 0;
        }
        QListWidget#composerSuggestionList::item {
            color: #DCE7F5; border-radius: 8px; padding: 7px 10px;
        }
        QListWidget#composerSuggestionList::item:selected {
            color: #FFFFFF; background: #263B57;
        }
        QFrame#composerDivider { background: #2A3E57; }
        QFrame#composerTools { background: transparent; }
        QPushButton#composerToolButton {
            background: transparent; color: #9AABC2; border: 1px solid transparent;
            border-radius: 9px; padding: 3px; min-width: 26px; min-height: 26px;
        }
        QPushButton#composerToolButton:hover { background: #22354D; color: #EAF1FC; }
        QPushButton#composerToolButton:pressed { background: #2A405B; }
        QPushButton#composerToolButton:disabled { color: #566984; background: transparent; }
        QPushButton#composerToolButton::menu-indicator { image: none; width: 0; }
        QToolButton#composerToolButton {
            background: transparent; color: #9AABC2; border: 1px solid transparent;
            border-radius: 8px; padding: 3px 6px;
        }
        QToolButton#composerToolButton:hover { background: #22354D; color: #EAF1FC; }
        QToolButton#composerToolButton:pressed { background: #2A405B; }
        QWidget#formattingToolbar { background: transparent; }
        QPushButton#sendButton {
            background: #B95271; color: white; font-weight: 600; border-radius: 12px;
            padding: 6px; border: 1px solid #C6607E;
        }
        QPushButton#sendButton:hover { background: #C86482; }
        QPushButton#sendButton:pressed { background: #A84765; }
        QPushButton#sendButton:disabled { background: #26364B; color: #71829A; border-color: #2C405A; }
        QToolButton#iconButton, QToolButton#sidebarMoreButton {
            background: transparent; color: #91A3BB; border: 1px solid transparent;
            border-radius: 10px; padding: 4px;
        }
        QToolButton#iconButton:hover, QToolButton#sidebarMoreButton:hover {
            background: #1B2D44; color: #EAF1FC;
        }
        QToolButton#contentBlurIndicator {
            background: #332638; color: #F0A2B5; border: 1px solid #6A4056;
            border-radius: 10px; padding: 4px;
        }
        QToolButton#contentBlurIndicator:hover { background: #493047; color: #FFD0DC; }
        QToolButton#iconButton:checked {
            background: #1B2E46; border-color: #314863;
        }
        QToolButton#iconButton::menu-indicator, QToolButton#sidebarMoreButton::menu-indicator {
            image: none; width: 0;
        }

        QWidget#loginPage { background: #0E1928; }
        QFrame#loginCard { background: #142238; border: 1px solid #2B3D55; border-radius: 20px; }
        QLabel#loginTitle { color: #EAF1FC; font-size: 26px; font-weight: 700; }
        QLabel#loginSubtitle { color: #91A3BB; font-size: 13px; padding-bottom: 4px; }
        QLabel#fieldCaption { color: #91A3BB; font-size: 12px; font-weight: 600; padding-left: 4px; }
        QLabel#loginError { color: #F48B9E; font-size: 12px; min-height: 18px; }
        QFrame#loginCard QLineEdit { border: 1px solid transparent; }
        QFrame#loginCard QLineEdit:focus { border: 1px solid #A65370; }
        QPushButton#primaryButton {
            background: #B95271; color: white; font-weight: 600; padding: 12px 18px; border-radius: 14px;
        }
        QPushButton#primaryButton:hover { background: #C86482; }
        QPushButton#primaryButton:pressed { background: #A84765; }
        QPushButton#primaryButton:disabled { background: #2A3A55; color: #91A3BB; }

        QLineEdit, QPlainTextEdit, QTextEdit, QComboBox, QSpinBox, QDoubleSpinBox, QDateTimeEdit {
            background: #16253A; color: #EAF1FC; border: 1px solid #2B3D55; outline: 0;
            border-radius: 12px; padding: 10px 13px; selection-background-color: #D67593;
        }
        QLineEdit:focus, QPlainTextEdit:focus, QTextEdit:focus, QComboBox:focus,
        QSpinBox:focus, QDoubleSpinBox:focus, QDateTimeEdit:focus { border: 1px solid #526B8A; outline: 0; }
        QLineEdit::placeholder, QPlainTextEdit::placeholder { color: #8395AE; }

        QPushButton {
            background: #1B2A40; color: #EAF1FC; border: 1px solid transparent; outline: 0;
            border-radius: 12px; padding: 8px 14px; min-height: 20px;
        }
        QPushButton:hover { background: #243750; }
        QPushButton:pressed { background: #2D425C; }
        QPushButton:checked { background: #A74765; color: white; }
        QPushButton:disabled { color: #71829A; background: #162238; }

        QListView, QListWidget, QTreeView, QTableView {
            background: #0E1928; color: #EAF1FC; border: none; outline: 0;
            selection-background-color: transparent; selection-color: #EAF1FC;
        }
        QListView#roomsList, QListWidget#roomsList { background: #0B1524; padding: 2px 0; }
        QListView#messagesList, QListWidget#messagesList { background: #0E1928; padding: 12px 14px 8px; }
        QListView::item, QListWidget::item { border: none; outline: 0; }
        QSplitter::handle { background: #2A3D56; border: none; }
        QSplitter::handle:horizontal { width: 1px; }
        QSplitter::handle:vertical { height: 1px; }

        QScrollBar:vertical { background: transparent; width: 6px; margin: 2px 1px; border: none; }
        QScrollBar:horizontal { background: transparent; height: 6px; margin: 1px 2px; border: none; }
        QScrollBar::handle:vertical, QScrollBar::handle:horizontal {
            background: #3B506B; border-radius: 3px; min-height: 28px; min-width: 28px;
        }
        QScrollBar::handle:vertical:hover, QScrollBar::handle:horizontal:hover { background: #687F9B; }
        QScrollBar::add-line, QScrollBar::sub-line, QScrollBar::add-page, QScrollBar::sub-page {
            width: 0; height: 0; background: transparent; border: none;
        }

        QMenu { background: #142238; border: none; border-radius: 12px; padding: 6px; font-size: 12px; }
        QMenu::item { padding: 7px 14px; min-height: 20px; margin: 1px 2px; border-radius: 7px; }
        QMenu::item:selected { background: #253951; color: #FFFFFF; }
        QMenu::item:disabled { color: #71829A; }
        QMenu::separator { height: 1px; background: #30445E; margin: 4px 8px; }
        QTabWidget::pane { border: none; background: #0E1928; }
        QTabBar::tab { background: #142238; color: #91A3BB; border: none; padding: 10px 16px; }
        QTabBar::tab:selected { color: #EAF1FC; border-bottom: 2px solid #D67593; }
        QGroupBox { border: none; margin-top: 12px; padding-top: 8px; }
        QGroupBox::title { color: #91A3BB; subcontrol-origin: margin; left: 8px; }
        QStatusBar { background: #111F32; color: #91A3BB; border: none; }
        QToolTip { color: #EAF1FC; background: #1A2B42; border: 1px solid #354B66; border-radius: 8px; padding: 7px 10px; }
        QCheckBox, QRadioButton { spacing: 8px; }
    )QSS");
}

void applyModernStyle(QApplication *application) {
    if (!application) {
        return;
    }
    if (QStyle *fusion = QStyleFactory::create(QStringLiteral("Fusion"))) {
        application->setStyle(fusion);
    }
    QPalette palette;
    palette.setColor(QPalette::Window, QColor(QStringLiteral("#0E1928")));
    palette.setColor(QPalette::WindowText, QColor(QStringLiteral("#EAF1FC")));
    palette.setColor(QPalette::Base, QColor(QStringLiteral("#0E1928")));
    palette.setColor(QPalette::AlternateBase, QColor(QStringLiteral("#16253A")));
    palette.setColor(QPalette::Text, QColor(QStringLiteral("#EAF1FC")));
    palette.setColor(QPalette::Button, QColor(QStringLiteral("#1B2A40")));
    palette.setColor(QPalette::ButtonText, QColor(QStringLiteral("#EAF1FC")));
    palette.setColor(QPalette::Highlight, QColor(QStringLiteral("#D67593")));
    palette.setColor(QPalette::HighlightedText, Qt::white);
    palette.setColor(QPalette::PlaceholderText, QColor(QStringLiteral("#8395AE")));
    application->setPalette(palette);
    application->setStyleSheet(applicationStyleSheet());
}

void configureListViews(QWidget *root) {
    if (!root) {
        return;
    }
    const auto lists = root->findChildren<QListView *>();
    for (QListView *list : lists) {
        list->setVerticalScrollMode(QAbstractItemView::ScrollPerPixel);
        list->setHorizontalScrollMode(QAbstractItemView::ScrollPerPixel);
        list->setMouseTracking(true);
        list->viewport()->setMouseTracking(true);
    }
}
