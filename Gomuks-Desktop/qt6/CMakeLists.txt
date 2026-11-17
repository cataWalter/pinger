cmake_minimum_required(VERSION 3.21)
project(PingerQt LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 6.5 REQUIRED COMPONENTS Network Widgets Multimedia MultimediaWidgets)

qt_add_executable(pinger-qt
    src/main.cpp
    src/mainwindow.cpp
    src/mainwindow.h
    resources/appicon.qrc
    src/mainwindow_menus.cpp
    src/animations.cpp
    src/animations.h
    src/backendclient.cpp
    src/backendclient.h
    src/localaichatdialog.cpp
    src/localaichatdialog.h
    src/aitoolsdialog.cpp
    src/aitoolsdialog.h
    src/mediaclient.cpp
    src/mediaclient.h
    src/mediadialogs.cpp
    src/mediadialogs.h
    src/qtutil.cpp
    src/qtutil.h
    src/settingsdialog.cpp
    src/settingsdialog.h
    src/stylesheet.cpp
    src/stylesheet.h
    src/chatitemdelegate.cpp
    src/chatitemdelegate.h
)

target_link_libraries(pinger-qt PRIVATE Qt6::Network Qt6::Widgets Qt6::Multimedia Qt6::MultimediaWidgets)
