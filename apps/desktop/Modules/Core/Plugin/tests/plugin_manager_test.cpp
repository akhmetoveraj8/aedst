#include "aedst/plugin/plugin_manager.hpp"

#include <gtest/gtest.h>

#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace aedst::plugin {
namespace {

struct Greeter {
    std::string text{"hello"};
};

/// Configurable plugin double.
class FakePlugin final : public IFeaturePlugin {
public:
    explicit FakePlugin(PluginDescriptor descriptor, std::vector<RouteContribution> routes = {})
        : descriptor_(std::move(descriptor)), routes_(std::move(routes)) {}

    [[nodiscard]] const PluginDescriptor& descriptor() const noexcept override { return descriptor_; }

    [[nodiscard]] std::vector<RouteContribution> routes() const override { return routes_; }

    [[nodiscard]] core::VoidOutcome registerServices(ServiceRegistry& registry) override {
        ++registerCalls;
        if (onRegister) {
            return onRegister(registry);
        }
        return core::ok();
    }

    std::function<core::VoidOutcome(ServiceRegistry&)> onRegister;
    int registerCalls{0};

private:
    PluginDescriptor descriptor_;
    std::vector<RouteContribution> routes_;
};

PluginDescriptor descriptor(std::string id, std::vector<std::string> capabilities = {}, std::string flag = {}) {
    return PluginDescriptor{.id = std::move(id),
                            .version = "1.2.3",
                            .apiVersion = kPluginApiVersion,
                            .requiredCapabilities = std::move(capabilities),
                            .featureFlag = std::move(flag)};
}

RouteContribution route(std::string name) {
    return RouteContribution{.routeName = std::move(name), .viewUrl = "qrc:/qt/qml/Test/View.qml"};
}

/// Adds `plugin` and keeps a raw pointer for inspection (the manager owns it).
FakePlugin* addTo(PluginManager& manager, std::unique_ptr<FakePlugin> plugin,
                  PluginOrigin origin = PluginOrigin::BuiltIn) {
    FakePlugin* raw = plugin.get();
    EXPECT_TRUE(manager.add(std::move(plugin), origin));
    return raw;
}

const PluginStatus& statusOf(const std::vector<PluginStatus>& report, const std::string& id) {
    for (const PluginStatus& status : report) {
        if (status.id == id) {
            return status;
        }
    }
    ADD_FAILURE() << "no status for " << id;
    static const PluginStatus empty;
    return empty;
}

const StaticCapabilitySource kUnknown{};

CapabilitySet serverWith(CapabilitySet::Names capabilities, CapabilitySet::Names flags = {}) {
    return CapabilitySet::known(std::move(capabilities), std::move(flags));
}

TEST(PluginId, AcceptsOnlyTheDocumentedShape) {
    EXPECT_TRUE(isValidPluginId("aedst.tasks"));
    EXPECT_TRUE(isValidPluginId("vendor-x_1.reports"));
    EXPECT_FALSE(isValidPluginId(""));
    EXPECT_FALSE(isValidPluginId("ab"));
    EXPECT_FALSE(isValidPluginId("1abc"));
    EXPECT_FALSE(isValidPluginId("Aedst.Tasks"));
    EXPECT_FALSE(isValidPluginId("a b c"));
    EXPECT_FALSE(isValidPluginId("../evil"));
    EXPECT_FALSE(isValidPluginId(std::string(65, 'a')));
}

TEST(PluginManager, ActivatesAValidBuiltInAndExposesItsRoutes) {
    PluginManager manager;
    ServiceRegistry registry;
    auto* tasks = addTo(manager, std::make_unique<FakePlugin>(descriptor("aedst.tasks"),
                                                              std::vector{route("tasks/list"), route("tasks/detail")}));

    manager.activate(kUnknown, registry);

    EXPECT_TRUE(manager.isActive("aedst.tasks"));
    EXPECT_EQ(tasks->registerCalls, 1);
    const auto routes = manager.activeRoutes();
    ASSERT_EQ(routes.size(), 2U);
    EXPECT_EQ(routes.front().routeName, "tasks/list");
    EXPECT_EQ(statusOf(manager.report(), "aedst.tasks").state, PluginState::Active);
}

TEST(PluginManager, ActivateIsIdempotent) {
    PluginManager manager;
    ServiceRegistry registry;
    auto* plugin =
        addTo(manager, std::make_unique<FakePlugin>(descriptor("aedst.tasks"), std::vector{route("tasks/list")}));

    manager.activate(kUnknown, registry);
    manager.activate(kUnknown, registry);

    EXPECT_EQ(plugin->registerCalls, 1);
    EXPECT_EQ(manager.activeRoutes().size(), 1U);
}

TEST(PluginManager, RejectsADuplicateIdAtAdd) {
    PluginManager manager;
    addTo(manager, std::make_unique<FakePlugin>(descriptor("aedst.tasks")));
    EXPECT_FALSE(manager.add(std::make_unique<FakePlugin>(descriptor("aedst.tasks")), PluginOrigin::Runtime));
    EXPECT_FALSE(manager.add(nullptr, PluginOrigin::BuiltIn));
    EXPECT_EQ(manager.report().size(), 1U);
}

TEST(PluginManager, RejectsABadDescriptor) {
    PluginManager manager;
    ServiceRegistry registry;
    PluginDescriptor wrongApi = descriptor("vendor.api");
    wrongApi.apiVersion = kPluginApiVersion + 1;
    PluginDescriptor wrongVersion = descriptor("vendor.ver");
    wrongVersion.version = "one";
    addTo(manager, std::make_unique<FakePlugin>(descriptor("Bad Id")));
    auto* api = addTo(manager, std::make_unique<FakePlugin>(wrongApi));
    addTo(manager, std::make_unique<FakePlugin>(wrongVersion));

    manager.activate(kUnknown, registry);

    for (const PluginStatus& status : manager.report()) {
        EXPECT_EQ(status.state, PluginState::Rejected) << status.id;
        EXPECT_FALSE(status.reason.empty()) << status.id;
    }
    EXPECT_EQ(api->registerCalls, 0);
}

TEST(PluginManager, RejectsNonQrcViewsAndEmptyRouteNames) {
    PluginManager manager;
    ServiceRegistry registry;
    addTo(manager,
          std::make_unique<FakePlugin>(
              descriptor("vendor.remote"),
              std::vector{RouteContribution{.routeName = "remote/home", .viewUrl = "https://evil.example/x.qml"}}));
    addTo(manager, std::make_unique<FakePlugin>(
                       descriptor("vendor.file"),
                       std::vector{RouteContribution{.routeName = "file/home", .viewUrl = "file:///tmp/x.qml"}}));
    addTo(manager,
          std::make_unique<FakePlugin>(descriptor("vendor.noname"),
                                       std::vector{RouteContribution{.routeName = "", .viewUrl = "qrc:/x.qml"}}));

    manager.activate(kUnknown, registry);

    EXPECT_TRUE(manager.activeRoutes().empty());
    for (const PluginStatus& status : manager.report()) {
        EXPECT_EQ(status.state, PluginState::Rejected) << status.id;
    }
}

TEST(PluginManager, RejectsMalformedLinkPrefixesAndKeepsValidOnes) {
    PluginManager manager;
    ServiceRegistry registry;
    int index = 0;
    for (const std::string bad : {"", "Tasks", "a/b", "a-b", "a.b", "tasks?x"}) {
        const std::string n = std::to_string(index++);
        addTo(manager, std::make_unique<FakePlugin>(descriptor("vendor.bad" + n),
                                                    std::vector{RouteContribution{.routeName = "bad/" + n,
                                                                                  .viewUrl = "qrc:/x.qml",
                                                                                  .linkPrefixes = {bad}}}));
    }
    addTo(manager, std::make_unique<FakePlugin>(descriptor("vendor.good"),
                                                std::vector{RouteContribution{.routeName = "good/home",
                                                                              .viewUrl = "qrc:/x.qml",
                                                                              .linkPrefixes = {"good"}}}));

    manager.activate(kUnknown, registry);

    const auto active = manager.activeRoutes();
    ASSERT_EQ(active.size(), 1U);
    EXPECT_EQ(active.front().linkPrefixes, std::vector<std::string>{"good"});
}

TEST(PluginManager, ARuntimePluginCannotShadowABuiltInRoute) {
    PluginManager manager;
    ServiceRegistry registry;
    addTo(manager, std::make_unique<FakePlugin>(descriptor("aedst.auth"), std::vector{route("auth/login")}));
    auto* impostor =
        addTo(manager, std::make_unique<FakePlugin>(descriptor("vendor.phish"), std::vector{route("auth/login")}),
              PluginOrigin::Runtime);

    manager.activate(StaticCapabilitySource(serverWith({})), registry);

    EXPECT_TRUE(manager.isActive("aedst.auth"));
    EXPECT_FALSE(manager.isActive("vendor.phish"));
    EXPECT_EQ(impostor->registerCalls, 0);
    EXPECT_EQ(statusOf(manager.report(), "vendor.phish").state, PluginState::Rejected);
}

TEST(PluginManager, UnknownCapabilitiesKeepBuiltInsActiveAndRuntimePluginsPending) {
    PluginManager manager;
    ServiceRegistry registry;
    addTo(manager, std::make_unique<FakePlugin>(descriptor("aedst.admin", {"admin.v1"})));
    auto* runtime = addTo(manager, std::make_unique<FakePlugin>(descriptor("vendor.reports")), PluginOrigin::Runtime);

    manager.activate(kUnknown, registry);

    EXPECT_TRUE(manager.isActive("aedst.admin"));
    EXPECT_FALSE(manager.isActive("vendor.reports"));
    EXPECT_EQ(runtime->registerCalls, 0);
    EXPECT_EQ(statusOf(manager.report(), "vendor.reports").state, PluginState::Pending);
}

TEST(PluginManager, KnownCapabilitiesGateOnRequirementsAndFlags) {
    PluginManager manager;
    ServiceRegistry registry;
    addTo(manager, std::make_unique<FakePlugin>(descriptor("vendor.a", {"cap.one", "cap.two"})), PluginOrigin::Runtime);
    addTo(manager, std::make_unique<FakePlugin>(descriptor("vendor.b", {"cap.one"}, "beta.reports")),
          PluginOrigin::Runtime);
    addTo(manager, std::make_unique<FakePlugin>(descriptor("vendor.c", {"cap.one"})), PluginOrigin::Runtime);

    manager.activate(StaticCapabilitySource(serverWith({"cap.one"})), registry);

    const auto report = manager.report();
    EXPECT_EQ(statusOf(report, "vendor.a").state, PluginState::Pending);
    EXPECT_NE(statusOf(report, "vendor.a").reason.find("cap.two"), std::string::npos);
    EXPECT_EQ(statusOf(report, "vendor.b").state, PluginState::Pending);
    EXPECT_EQ(statusOf(report, "vendor.c").state, PluginState::Active);
}

TEST(PluginManager, PendingPluginActivatesWhenCapabilitiesArrive) {
    PluginManager manager;
    ServiceRegistry registry;
    auto* plugin = addTo(manager,
                         std::make_unique<FakePlugin>(descriptor("vendor.b", {"cap.one"}, "beta.reports"),
                                                      std::vector{route("reports/home")}),
                         PluginOrigin::Runtime);

    manager.activate(StaticCapabilitySource(serverWith({"cap.one"})), registry);
    EXPECT_FALSE(manager.isActive("vendor.b"));

    manager.activate(StaticCapabilitySource(serverWith({"cap.one"}, {"beta.reports"})), registry);
    EXPECT_TRUE(manager.isActive("vendor.b"));
    EXPECT_EQ(plugin->registerCalls, 1);
    EXPECT_EQ(manager.activeRoutes().size(), 1U);
}

TEST(PluginManager, ServicesAreSharedThroughTheRegistry) {
    PluginManager manager;
    ServiceRegistry registry;
    ASSERT_TRUE(registry.provide(std::make_shared<Greeter>()));
    auto plugin = std::make_unique<FakePlugin>(descriptor("vendor.greet"));
    plugin->onRegister = [](ServiceRegistry& services) -> core::VoidOutcome {
        const auto greeter = services.find<Greeter>();
        if (!greeter) {
            return core::fail(core::Error::notFound("no greeter"));
        }
        return services.provide(std::make_shared<int>(static_cast<int>(greeter->text.size())));
    };
    addTo(manager, std::move(plugin));

    manager.activate(kUnknown, registry);

    ASSERT_TRUE(manager.isActive("vendor.greet"));
    ASSERT_NE(registry.find<int>(), nullptr);
    EXPECT_EQ(*registry.find<int>(), 5);
}

TEST(PluginManager, FailedRegistrationIsRolledBackAndRejected) {
    PluginManager manager;
    ServiceRegistry registry;
    auto plugin = std::make_unique<FakePlugin>(descriptor("vendor.broken"), std::vector{route("broken/home")});
    plugin->onRegister = [](ServiceRegistry& services) -> core::VoidOutcome {
        if (auto provided = services.provide(std::make_shared<Greeter>()); !provided) {
            return provided;
        }
        return core::fail(core::Error::unknown("boom"));
    };
    addTo(manager, std::move(plugin));

    manager.activate(kUnknown, registry);

    EXPECT_FALSE(manager.isActive("vendor.broken"));
    EXPECT_EQ(statusOf(manager.report(), "vendor.broken").state, PluginState::Rejected);
    EXPECT_FALSE(registry.contains<Greeter>()) << "a rejected plugin must leave nothing behind";
    EXPECT_TRUE(manager.activeRoutes().empty());
}

TEST(PluginManager, AThrowingPluginIsRejectedNotPropagated) {
    PluginManager manager;
    ServiceRegistry registry;
    auto plugin = std::make_unique<FakePlugin>(descriptor("vendor.throws"));
    plugin->onRegister = [](ServiceRegistry&) -> core::VoidOutcome { throw std::runtime_error("bad plugin"); };
    addTo(manager, std::move(plugin));
    addTo(manager, std::make_unique<FakePlugin>(descriptor("aedst.after")));

    EXPECT_NO_THROW(manager.activate(kUnknown, registry));

    EXPECT_EQ(statusOf(manager.report(), "vendor.throws").state, PluginState::Rejected);
    EXPECT_TRUE(manager.isActive("aedst.after")) << "one bad plugin must not stop the others";
}

} // namespace
} // namespace aedst::plugin
