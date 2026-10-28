#include "aedst/testing/behavior_fixture.hpp"
#include "outbox_test_support.hpp"

#include <QJsonArray>
#include <QJsonObject>

#include <gtest/gtest.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Replays docs/contract/behavior/offline-outbox.json (the file Web, Android and Apple replay too) against the REAL
// OutboxDrainer and the real SQLite queue on a temp database. Handlers are scripted; everything else is production
// code.

namespace aedst::outbox {
namespace {

using namespace testsupport;

DeliveryResult scripted(const QString& outcome) {
    if (outcome == QLatin1String("ok")) {
        return DeliveryResult::delivered();
    }
    if (outcome == QLatin1String("retryable")) {
        return DeliveryResult::retryable("network");
    }
    if (outcome == QLatin1String("permanent")) {
        return DeliveryResult::permanent("invalid_argument");
    }
    ADD_FAILURE() << "unknown scripted outcome " << qPrintable(outcome);
    return DeliveryResult::permanent("test");
}

const char* resultName(RunResult result) {
    switch (result) {
    case RunResult::Complete:
        return "complete";
    case RunResult::Retry:
        return "retry";
    case RunResult::Blocked:
        return "blocked";
    }
    return "?";
}

/// Mirrors the fixture's queue entries ({id, status, attempts}).
QJsonArray queueView(const std::vector<OutboxItem>& rows) {
    QJsonArray view;
    for (const OutboxItem& row : rows) {
        view.append(QJsonObject{{"id", QString::fromStdString(row.id)},
                                {"status", row.status == OutboxStatus::Pending ? "pending" : "failed"},
                                {"attempts", row.attempts}});
    }
    return view;
}

QJsonArray sentView(const ScriptedHandler::Script& script) {
    QJsonArray view;
    for (const auto& [id, key] : script.sent) {
        view.append(QJsonObject{{"id", QString::fromStdString(id)}, {"idempotencyKey", QString::fromStdString(key)}});
    }
    return view;
}

void expectRun(const QJsonObject& expect, const RunReport& report, const ScriptedHandler::Script& script,
               const std::vector<OutboxItem>& rows) {
    if (expect.contains("result")) {
        EXPECT_EQ(QString::fromLatin1(resultName(report.result)), expect.value("result").toString());
    }
    if (expect.contains("sent")) {
        EXPECT_EQ(sentView(script), expect.value("sent").toArray());
    }
    if (expect.contains("queue")) {
        EXPECT_EQ(queueView(rows), expect.value("queue").toArray());
    }
}

TEST(OutboxFixtureTest, ReplaysEveryCase) {
    const QJsonObject fixture = aedst::testing::loadBehaviorFixture("offline-outbox");
    const QJsonArray cases = fixture.value("cases").toArray();
    ASSERT_FALSE(cases.isEmpty());
    ASSERT_EQ(fixture.value("maxAttempts").toInt(), DrainerConfig{}.maxAttempts);

    for (const QJsonValue& entry : cases) {
        const QJsonObject c = entry.toObject();
        SCOPED_TRACE(c.value("id").toString().toStdString());

        SqliteFixture db;
        auto script = std::make_shared<ScriptedHandler::Script>();
        auto handlers = std::make_shared<OutboxHandlers>();
        for (const QJsonValue& type : fixture.value("knownTypes").toArray()) {
            ASSERT_TRUE(handlers->add(std::make_shared<ScriptedHandler>(type.toString().toStdString(), script)));
        }

        for (const QJsonValue& stepValue : c.value("steps").toArray()) {
            const QJsonObject step = stepValue.toObject();
            if (step.contains("enqueue")) {
                const QJsonObject item = step.value("enqueue").toObject();
                ASSERT_TRUE(
                    db.enqueue(item.value("id").toString().toStdString(), item.value("type").toString().toStdString()));
                continue;
            }
            const int times = step.contains("repeatRun") ? step.value("repeatRun").toInt() : 1;
            for (int n = 0; n < times; ++n) {
                script->sent.clear();
                script->outcomes.clear();
                for (const QJsonValue& outcome : step.value("run").toObject().value("outcomes").toArray()) {
                    script->outcomes.push_back(scripted(outcome.toString()));
                }
                const auto report = db.run(handlers);
                ASSERT_TRUE(report.has_value()) << report.error().message;
                EXPECT_TRUE(script->outcomes.empty()) << "the run did not consume every scripted outcome";
                expectRun(step.value("expect").toObject(), *report, *script, db.snapshot());
            }
        }
    }
}

TEST(OutboxFixtureTest, ABlockedHandlerStopsTheRunWithoutCountingAnAttempt) {
    SqliteFixture db;
    auto script = std::make_shared<ScriptedHandler::Script>();
    script->outcomes.push_back(DeliveryResult::blocked("unauthenticated"));
    auto handlers = std::make_shared<OutboxHandlers>();
    ASSERT_TRUE(handlers->add(std::make_shared<ScriptedHandler>("task.create", script)));
    ASSERT_TRUE(db.enqueue("a", "task.create"));
    ASSERT_TRUE(db.enqueue("b", "task.create"));

    const auto report = db.run(handlers);

    ASSERT_TRUE(report.has_value());
    EXPECT_EQ(report->result, RunResult::Blocked);
    EXPECT_EQ(script->sent.size(), 1U);
    const auto rows = db.snapshot();
    ASSERT_EQ(rows.size(), 2U);
    EXPECT_EQ(rows[0].attempts, 0);
    EXPECT_EQ(rows[0].status, OutboxStatus::Pending);
}

TEST(OutboxFixtureTest, AThrowingHandlerParksTheItemAndTheRunContinues) {
    class Throwing final : public OutboxHandler {
    public:
        [[nodiscard]] std::string type() const override { return "task.create"; }

        void deliver(const OutboxDelivery&, DeliveryCompletion) override { throw std::runtime_error("boom"); }
    };

    SqliteFixture db;
    auto script = std::make_shared<ScriptedHandler::Script>();
    auto handlers = std::make_shared<OutboxHandlers>();
    ASSERT_TRUE(handlers->add(std::make_shared<Throwing>()));
    ASSERT_TRUE(handlers->add(std::make_shared<ScriptedHandler>("task.update", script)));
    ASSERT_TRUE(db.enqueue("a", "task.create"));
    ASSERT_TRUE(db.enqueue("b", "task.update"));

    const auto report = db.run(handlers);

    ASSERT_TRUE(report.has_value());
    EXPECT_EQ(report->result, RunResult::Complete);
    ASSERT_EQ(script->sent.size(), 1U);
    const auto rows = db.snapshot();
    ASSERT_EQ(rows.size(), 1U);
    EXPECT_EQ(rows[0].id, "a");
    EXPECT_EQ(rows[0].status, OutboxStatus::Failed);
    EXPECT_EQ(rows[0].lastError, "Exception");
}

TEST(OutboxHandlersTest, RejectsADuplicateTypeAndANullHandler) {
    OutboxHandlers handlers;
    auto script = std::make_shared<ScriptedHandler::Script>();

    EXPECT_TRUE(handlers.add(std::make_shared<ScriptedHandler>("task.create", script)));
    EXPECT_FALSE(handlers.add(std::make_shared<ScriptedHandler>("task.create", script)));
    EXPECT_FALSE(handlers.add(nullptr));
    EXPECT_EQ(handlers.size(), 1U);
    EXPECT_NE(handlers.find("task.create"), nullptr);
    EXPECT_EQ(handlers.find("task.update"), nullptr);
}

TEST(DeliveryResultTest, MapsCoreErrorsToTheDeliveryVerdict) {
    EXPECT_EQ(DeliveryResult::fromError(core::Error::unavailable("x")).status, DeliveryStatus::Retryable);
    EXPECT_EQ(DeliveryResult::fromError(core::Error::cancelled("x")).status, DeliveryStatus::Retryable);
    EXPECT_EQ(DeliveryResult::fromError(core::Error::unauthenticated("x")).status, DeliveryStatus::Blocked);
    EXPECT_EQ(DeliveryResult::fromError(core::Error::upgradeRequired("x")).status, DeliveryStatus::Blocked);
    EXPECT_EQ(DeliveryResult::fromError(core::Error::invalidInput("x")).status, DeliveryStatus::Permanent);
    EXPECT_EQ(DeliveryResult::fromError(core::Error::notFound("x")).status, DeliveryStatus::Permanent);
    EXPECT_EQ(DeliveryResult::fromError(core::Error::unknown("x")).status, DeliveryStatus::Permanent);
    EXPECT_EQ(DeliveryResult::fromError(core::Error::unavailable("secret detail")).errorKind, "unavailable");
}

TEST(DeliveryResultTest, EveryKindGetsTheVerdictDeclaredInErrorKindsJson) {
    const QJsonObject kinds = aedst::testing::loadBehaviorFixture("error-kinds").value("kinds").toObject();
    const core::ErrorCode all[] = {
        core::ErrorCode::Unknown,         core::ErrorCode::InvalidInput, core::ErrorCode::Unauthenticated,
        core::ErrorCode::Forbidden,       core::ErrorCode::NotFound,     core::ErrorCode::Conflict,
        core::ErrorCode::RateLimited,     core::ErrorCode::Unavailable,  core::ErrorCode::Offline,
        core::ErrorCode::Timeout,         core::ErrorCode::Storage,      core::ErrorCode::Cancelled,
        core::ErrorCode::UpgradeRequired,
    };
    for (const core::ErrorCode code : all) {
        const std::string_view name = core::toString(code);
        const QString key = QString::fromUtf8(name.data(), static_cast<qsizetype>(name.size()));
        ASSERT_TRUE(kinds.contains(key)) << name;
        const QString verdict = kinds.value(key).toObject().value("outbox").toString();
        const DeliveryStatus expected = verdict == QLatin1String("retry")     ? DeliveryStatus::Retryable
                                        : verdict == QLatin1String("blocked") ? DeliveryStatus::Blocked
                                                                              : DeliveryStatus::Permanent;
        EXPECT_EQ(DeliveryResult::fromError(core::Error{code, "x"}).status, expected) << name;
    }
}

TEST(DeliveryResultTest, EveryKindGetsTheVerdictDeclaredInErrorKindsJson) {
    const QJsonObject kinds = aedst::testing::loadBehaviorFixture("error-kinds").value("kinds").toObject();
    const core::ErrorCode all[] = {
        core::ErrorCode::Unknown,         core::ErrorCode::InvalidInput, core::ErrorCode::Unauthenticated,
        core::ErrorCode::Forbidden,       core::ErrorCode::NotFound,     core::ErrorCode::Conflict,
        core::ErrorCode::RateLimited,     core::ErrorCode::Unavailable,  core::ErrorCode::Offline,
        core::ErrorCode::Timeout,         core::ErrorCode::Storage,      core::ErrorCode::Cancelled,
        core::ErrorCode::UpgradeRequired,
    };
    for (const core::ErrorCode code : all) {
        const std::string_view name = core::toString(code);
        const QString key = QString::fromUtf8(name.data(), static_cast<qsizetype>(name.size()));
        ASSERT_TRUE(kinds.contains(key)) << name;
        const QString verdict = kinds.value(key).toObject().value("outbox").toString();
        const DeliveryStatus expected = verdict == QLatin1String("retry")     ? DeliveryStatus::Retryable
                                        : verdict == QLatin1String("blocked") ? DeliveryStatus::Blocked
                                                                              : DeliveryStatus::Permanent;
        EXPECT_EQ(DeliveryResult::fromError(core::Error{code, "x"}).status, expected) << name;
    }
}

} // namespace
} // namespace aedst::outbox
