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
        QWidget { color: #F3F4F6; background: transparent; }
        QMainWindow, QStackedWidget, QDialog { background: #111317; }
        QWidget#chatPage, QWidget#conversation { background: #111317; }
        QWidget#sidebar { background: #181B20; }
        QLabel { color: #F3F4F6; }
        QLabel#roomTitle { background: #181B20; color: #F3F4F6; font-size: 18px; font-weight: 650; padding: 14px 18px; }
        QLabel#composeContext { color: #8E95A2; padding: 8px 12px; }

        QLineEdit, QPlainTextEdit, QTextEdit, QComboBox, QSpinBox, QDoubleSpinBox, QDateTimeEdit {
            background: #22262E; color: #F3F4F6; border: none; outline: 0;
            border-radius: 16px; padding: 12px 16px; selection-background-color: #3B82F6;
        }
        QLineEdit:focus, QPlainTextEdit:focus, QTextEdit:focus, QComboBox:focus,
        QSpinBox:focus, QDoubleSpinBox:focus, QDateTimeEdit:focus { border: none; outline: 0; }
        QLineEdit::placeholder, QPlainTextEdit::placeholder { color: #8E95A2; }

        QPushButton {
            background: #22262E; color: #F3F4F6; border: none; outline: 0;
            border-radius: 16px; padding: 10px 18px; min-height: 22px;
        }
        QPushButton:hover { background: #2B303A; }
        QPushButton:pressed { background: #303642; }
        QPushButton:checked { background: #3B82F6; color: white; }
        QPushButton:disabled { color: #626977; background: #1B1E24; }

        QListView, QListWidget, QTreeView, QTableView {
            background: #111317; color: #F3F4F6; border: none; outline: 0;
            selection-background-color: transparent; selection-color: #F3F4F6;
        }
        QListView#roomsList, QListWidget#roomsList { background: #181B20; }
        QListView#messagesList, QListWidget#messagesList { background: #111317; }
        QListView::item, QListWidget::item { border: none; outline: 0; }
        QSplitter::handle { background: #2A2E36; border: none; }
        QSplitter::handle:horizontal { width: 1px; }
        QSplitter::handle:vertical { height: 1px; }

        QScrollBar:vertical { background: transparent; width: 6px; margin: 2px 1px; border: none; }
        QScrollBar:horizontal { background: transparent; height: 6px; margin: 1px 2px; border: none; }
        QScrollBar::handle:vertical, QScrollBar::handle:horizontal {
            background: #3B404A; border-radius: 3px; min-height: 28px; min-width: 28px;
        }
        QScrollBar::handle:vertical:hover, QScrollBar::handle:horizontal:hover { background: #596170; }
        QScrollBar::add-line, QScrollBar::sub-line, QScrollBar::add-page, QScrollBar::sub-page {
            width: 0; height: 0; background: transparent; border: none;
        }

        QMenu { background: #22262E; border: none; border-radius: 12px; padding: 6px; }
        QMenu::item { padding: 8px 24px; border-radius: 8px; }
        QMenu::item:selected { background: #303642; }
        QMenu::separator { height: 1px; background: #343943; margin: 5px 8px; }
        QTabWidget::pane { border: none; background: #111317; }
        QTabBar::tab { background: #181B20; color: #8E95A2; border: none; padding: 10px 16px; }
        QTabBar::tab:selected { color: #F3F4F6; border-bottom: 2px solid #3B82F6; }
        QGroupBox { border: none; margin-top: 12px; padding-top: 8px; }
        QGroupBox::title { color: #8E95A2; subcontrol-origin: margin; left: 8px; }
        QStatusBar { background: #181B20; color: #8E95A2; border: none; }
        QToolTip { color: #F3F4F6; background: #22262E; border: none; padding: 6px 8px; }
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
    palette.setColor(QPalette::Window, QColor(QStringLiteral("#111317")));
    palette.setColor(QPalette::WindowText, QColor(QStringLiteral("#F3F4F6")));
    palette.setColor(QPalette::Base, QColor(QStringLiteral("#111317")));
    palette.setColor(QPalette::AlternateBase, QColor(QStringLiteral("#181B20")));
    palette.setColor(QPalette::Text, QColor(QStringLiteral("#F3F4F6")));
    palette.setColor(QPalette::Button, QColor(QStringLiteral("#22262E")));
    palette.setColor(QPalette::ButtonText, QColor(QStringLiteral("#F3F4F6")));
    palette.setColor(QPalette::Highlight, QColor(QStringLiteral("#3B82F6")));
    palette.setColor(QPalette::HighlightedText, Qt::white);
    palette.setColor(QPalette::PlaceholderText, QColor(QStringLiteral("#8E95A2")));
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
