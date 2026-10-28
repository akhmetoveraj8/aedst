#include "aedst/capabilities/capabilities_service.hpp"
#include "aedst/testing/behavior_fixture.hpp"
#include "capability_test_support.hpp"

#include <QJsonArray>
#include <QJsonObject>
#include <QJsonValue>

#include <gtest/gtest.h>

#include <memory>
#include <string>

// Replays docs/contract/behavior/capabilities.json (the file Web, Android and Apple replay too) through the REAL
// CapabilitiesService and rules. Only the network and the cache are doubles: the server answer is built as the
// generated GetCapabilitiesResponse, the lastKnown value is stored as its serialized form, exactly as production stores
// it.

namespace aedst::capabilities {
namespace {

using namespace testsupport;

std::string toStd(const QString& text) {
    return text.toStdString();
}

/// {"features": {"<name>": {"enabled": bool, "requiredClientVersion": "x.y.z"}}} -> the generated message.
ServerCapabilities toResponse(const QJsonObject& snapshot) {
    ServerCapabilities response;
    const QJsonObject features = snapshot.value(QLatin1String("features")).toObject();
    for (auto it = features.begin(); it != features.end(); ++it) {
        const QJsonObject feature = it.value().toObject();
        addFeature(response, toStd(it.key()), feature.value(QLatin1String("enabled")).toBool(),
                   toStd(feature.value(QLatin1String("requiredClientVersion")).toString()));
    }
    return response;
}

ClientBuild buildFrom(const QJsonObject& clientBuild) {
    ClientBuild build;
    build.platform = toStd(clientBuild.value(QLatin1String("platform")).toString());
    build.version = toStd(clientBuild.value(QLatin1String("version")).toString());
    for (const QJsonValue& value : clientBuild.value(QLatin1String("features")).toArray()) {
        build.features.insert(toStd(value.toString()));
    }
    for (const QJsonValue& value : clientBuild.value(QLatin1String("flagged")).toArray()) {
        build.flagged.insert(toStd(value.toString()));
    }
    return build;
}

TEST(CapabilitiesFixtureTest, EveryCaseOfTheSharedFixtureHolds) {
    const QJsonObject fixture = aedst::testing::loadBehaviorFixture("capabilities");
    ASSERT_EQ(fixture.value(QLatin1String("behavior")).toString(), QLatin1String("capability-negotiation"));
    const ClientBuild build = buildFrom(fixture.value(QLatin1String("clientBuild")).toObject());
    const QJsonArray cases = fixture.value(QLatin1String("cases")).toArray();
    ASSERT_FALSE(cases.isEmpty()) << "a fixture without cases proves nothing";

    for (const QJsonValue& caseValue : cases) {
        const QJsonObject testCase = caseValue.toObject();
        const std::string id = toStd(testCase.value(QLatin1String("id")).toString());
        SCOPED_TRACE(id);

        auto remote = std::make_shared<ScriptedRemote>();
        auto cache = std::make_shared<MemoryCache>();
        if (const QJsonValue lastKnown = testCase.value(QLatin1String("lastKnown")); lastKnown.isObject()) {
            cache->stored = toResponse(lastKnown.toObject()).SerializeAsString();
        }

        CapabilitiesService service({.remote = remote, .cache = cache, .build = build});
        service.start();
        ASSERT_EQ(remote->pending.size(), 1U) << "start() must fetch";
        if (const QJsonValue server = testCase.value(QLatin1String("server")); server.isObject()) {
            remote->answer(toResponse(server.toObject()));
        } else {
            remote->fail();
        }

        const QJsonObject expect = testCase.value(QLatin1String("expect")).toObject();
        ASSERT_FALSE(expect.isEmpty());
        for (auto it = expect.begin(); it != expect.end(); ++it) {
            EXPECT_EQ(service.isEnabled(toStd(it.key())), it.value().toBool()) << "feature " << qPrintable(it.key());
        }
    }
}

} // namespace
} // namespace aedst::capabilities
