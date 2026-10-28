#pragma once

#include <QCoreApplication>

#include <gtest/gtest.h>

/// main() for GoogleTest binaries that exercise QObjects (signals, QTimer,
/// deleteLater). Link GTest::gtest — not gtest_main — and put
/// AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION() once at file scope.
///
/// Qt Test (QTest) binaries don't need this; they use QTEST_GUILESS_MAIN.
#define AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION()                                                                       \
    int main(int argc, char** argv) {                                                                                  \
        ::testing::InitGoogleTest(&argc, argv);                                                                        \
        QCoreApplication app(argc, argv);                                                                              \
        return RUN_ALL_TESTS();                                                                                        \
    }
