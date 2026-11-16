cmake_minimum_required(VERSION 3.21)
project(PingerQt LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 6.4 REQUIRED COMPONENTS Network Widgets)

qt_add_executable(pinger-qt
    src/main.cpp
    src/mainwindow.cpp
    src/mainwindow.h
    src/backendclient.cpp
    src/backendclient.h
    src/localaichatdialog.cpp
    src/localaichatdialog.h
    src/aitoolsdialog.cpp
    src/aitoolsdialog.h
    src/mediaclient.cpp
    src/mediaclient.h
    src/qtutil.cpp
    src/qtutil.h
    src/settingsdialog.cpp
    src/settingsdialog.h
    src/stylesheet.cpp
    src/stylesheet.h
    src/chatitemdelegate.cpp
    src/chatitemdelegate.h
)

target_link_libraries(pinger-qt PRIVATE Qt6::Network Qt6::Widgets)
