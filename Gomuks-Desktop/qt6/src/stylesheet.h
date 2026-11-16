#pragma once

#include <QString>

class QApplication;
class QWidget;

QString applicationStyleSheet();
void applyModernStyle(QApplication *application);
void configureListViews(QWidget *root);
