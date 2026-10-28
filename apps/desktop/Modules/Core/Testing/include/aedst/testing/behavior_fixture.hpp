#pragma once

#include <QByteArray>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QString>

#include <gtest/gtest.h>

#include <string_view>

#ifndef AEDST_BEHAVIOR_FIXTURE_DIR
#error "AEDST_BEHAVIOR_FIXTURE_DIR is defined by Modules/Core/Testing/CMakeLists.txt (docs/contract/behavior)"
#endif

/// Loads a cross-platform behavior fixture (docs/contract/behavior/<name>.json), the single source shared by
/// the Web, Android, Apple and Desktop tests. The directory comes from the build (AEDST_BEHAVIOR_FIXTURE_DIR), so
/// the tests read the repository file itself, never a copy. A missing or malformed fixture is a test failure,
/// not a skip: a replay test that silently runs nothing proves nothing.
namespace aedst::testing {

[[nodiscard]] inline QJsonObject loadBehaviorFixture(std::string_view name) {
    const QString path = QStringLiteral(AEDST_BEHAVIOR_FIXTURE_DIR "/") +
                         QString::fromUtf8(name.data(), static_cast<qsizetype>(name.size())) + QStringLiteral(".json");
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        ADD_FAILURE() << "cannot open behavior fixture " << qPrintable(path);
        return {};
    }
    QJsonParseError parseError{};
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        ADD_FAILURE() << "malformed behavior fixture " << qPrintable(path) << ": "
                      << qPrintable(parseError.errorString());
        return {};
    }
    return document.object();
}

} // namespace aedst::testing
