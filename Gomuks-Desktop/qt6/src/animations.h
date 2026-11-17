#pragma once

#include <QAbstractItemView>
#include <QWidget>

void fadeIn(QWidget *widget, int durationMs = 180);
void smoothScrollToBottom(QAbstractItemView *view, int durationMs = 220);
