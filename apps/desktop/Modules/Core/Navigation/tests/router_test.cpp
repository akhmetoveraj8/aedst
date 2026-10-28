#include "aedst/navigation/deep_link_gate.hpp"
#include "aedst/navigation/router.hpp"
#include "aedst/testing/test_main.hpp"

#include <QUrl>
#include <QVariantMap>

#include <gtest/gtest.h>

#include <memory>
#include <string>
#include <vector>

namespace aedst::navigation {
namespace {

const QUrl kLoginView{QStringLiteral("qrc:/test/Login.qml")};
const QUrl kHomeView{QStringLiteral("qrc:/test/Home.qml")};
const QUrl kProfileView{QStringLiteral("qrc:/test/Profile.qml")};

// Router is generic and shouldn't depend on any real feature's routes, so
// this test registers its own made-up destinations rather than reusing
// aedst::navigation::routes:: constants (which only list routes real
// features actually navigate to).
constexpr std::string_view kHomeRoute = "test/home";
constexpr std::string_view kProfileRoute = "test/profile";

class RouterTest : public ::testing::Test {
protected:
    RouterTest() : router_(makeGraph()) {
        QObject::connect(&router_, &Router::pushRequested, [this](const QUrl& view, const QVariantMap& properties) {
            pushed_.push_back(view);
            lastProperties_ = properties;
        });
        QObject::connect(&router_, &Router::replaceAllRequested,
                         [this](const QUrl& view, const QVariantMap&) { replaced_.push_back(view); });
        QObject::connect(&router_, &Router::popRequested, [this]() { ++pops_; });
    }

    static std::shared_ptr<const NavGraph> makeGraph() {
        auto graph = std::make_shared<NavGraph>();
        graph->registerDestination(routes::kLogin, kLoginView);
        graph->registerDestination(kHomeRoute, kHomeView);
        graph->registerDestination(kProfileRoute, kProfileView);
        return graph;
    }

    static Route route(std::string_view name) { return Route{.name = std::string(name), .params = {}}; }

    Router router_;
    std::vector<QUrl> pushed_;
    std::vector<QUrl> replaced_;
    QVariantMap lastProperties_;
    int pops_{0};
};

TEST_F(RouterTest, PushEmitsResolvedViewAndGrowsBackStack) {
    ASSERT_TRUE(router_.resetTo(route(kHomeRoute)));
    ASSERT_TRUE(router_.push(route(kProfileRoute)));

    ASSERT_EQ(pushed_.size(), 1U);
    EXPECT_EQ(pushed_.front(), kProfileView);
    EXPECT_EQ(router_.depth(), 2);
    EXPECT_EQ(router_.currentRoute(), QStringLiteral("test/profile"));
}

TEST_F(RouterTest, UnknownRouteIsRejectedWithoutSignals) {
    EXPECT_FALSE(router_.push(route("nowhere")));

    EXPECT_TRUE(pushed_.empty());
    EXPECT_EQ(router_.depth(), 0);
}

TEST_F(RouterTest, ParamsBecomeViewProperties) {
    Route profile = route(kProfileRoute);
    profile.params.emplace(std::string(params::kUserId), "user-42");

    ASSERT_TRUE(router_.push(profile));

    EXPECT_EQ(lastProperties_.value(QStringLiteral("userId")).toString(), QStringLiteral("user-42"));
}

TEST_F(RouterTest, GoBackStopsAtRoot) {
    ASSERT_TRUE(router_.resetTo(route(kHomeRoute)));
    ASSERT_TRUE(router_.push(route(kProfileRoute)));

    EXPECT_TRUE(router_.goBack());
    EXPECT_FALSE(router_.goBack());
    EXPECT_EQ(pops_, 1);
    EXPECT_EQ(router_.depth(), 1);
}

TEST_F(RouterTest, ResetToClearsBackStack) {
    ASSERT_TRUE(router_.resetTo(route(kHomeRoute)));
    ASSERT_TRUE(router_.push(route(kProfileRoute)));

    ASSERT_TRUE(router_.replaceAll(QStringLiteral("auth/login")));

    EXPECT_EQ(router_.depth(), 1);
    ASSERT_FALSE(replaced_.empty());
    EXPECT_EQ(replaced_.back(), kLoginView);
}

TEST_F(RouterTest, LockToShowsTheRouteAndRefusesEveryWayOut) {
    ASSERT_TRUE(router_.resetTo(route(kHomeRoute)));
    ASSERT_TRUE(router_.push(route(kProfileRoute)));

    ASSERT_TRUE(router_.lockTo(route(kHomeRoute)));

    EXPECT_TRUE(router_.isLocked());
    EXPECT_EQ(router_.depth(), 1);
    EXPECT_EQ(router_.currentRoute(), QStringLiteral("test/home"));
    EXPECT_FALSE(router_.push(route(kProfileRoute)));
    EXPECT_FALSE(router_.resetTo(route(kProfileRoute)));
    EXPECT_FALSE(router_.replaceAll(QStringLiteral("auth/login")));
    EXPECT_FALSE(router_.goBack());
    EXPECT_FALSE(router_.openLink(QStringLiteral("/tasks")));
    EXPECT_EQ(router_.currentRoute(), QStringLiteral("test/home"));
    EXPECT_EQ(router_.depth(), 1);
}

TEST_F(RouterTest, LockToAnUnknownRouteLocksNothing) {
    ASSERT_TRUE(router_.resetTo(route(kHomeRoute)));

    EXPECT_FALSE(router_.lockTo(route("nowhere")));

    EXPECT_FALSE(router_.isLocked());
    EXPECT_TRUE(router_.push(route(kProfileRoute)));
}

const std::vector<std::string> kAllPrefixes{"media", "notifications", "tasks"};

TEST(RouteForLinkTest, OnlyPrefixesOfActiveRoutesOpen) {
    const std::vector<std::string> tasksOnly{"tasks"};
    EXPECT_TRUE(routeForLink("/tasks", tasksOnly).has_value());
    EXPECT_FALSE(routeForLink("/media/abc-123", tasksOnly).has_value());
    EXPECT_FALSE(routeForLink("/tasks", {}).has_value());
}

TEST(RouteForLinkTest, TypedHelpersMatchTheMapping) {
    EXPECT_EQ(routeForLink("/tasks/abc-1", kAllPrefixes), routes::taskDetail("abc-1"));
    EXPECT_EQ(routeForLink("/media/abc-1", kAllPrefixes), routes::mediaViewer("abc-1"));
    EXPECT_EQ(routeForLink("/media", kAllPrefixes), routes::media());
}

TEST(NavGraphTest, LinkPrefixesFollowRegisteredRoutes) {
    NavGraph graph;
    graph.registerDestination("a/home", QUrl(QStringLiteral("qrc:/a.qml")), {"tasks"});
    graph.registerDestination("a/detail", QUrl(QStringLiteral("qrc:/b.qml")));
    graph.registerDestination("m/home", QUrl(QStringLiteral("qrc:/m.qml")), {"media", "tasks"});
    EXPECT_EQ(graph.linkPrefixes(), (std::vector<std::string>{"media", "tasks"}));
}

TEST(RouteForLinkTest, MapsKnownRelativeLinks) {
    const auto task = routeForLink("/tasks/3f2b8c1e-0000-4000-8000-000000000001", kAllPrefixes);
    ASSERT_TRUE(task.has_value());
    EXPECT_EQ(task->name, routes::kTaskDetail);
    EXPECT_EQ(task->params.at(std::string(params::kTaskId)), "3f2b8c1e-0000-4000-8000-000000000001");
    EXPECT_EQ(routeForLink("/tasks", kAllPrefixes)->name, routes::kTasks);
    EXPECT_EQ(routeForLink("/notifications", kAllPrefixes)->name, routes::kNotifications);
    EXPECT_EQ(routeForLink("/media/abc-123", kAllPrefixes)->name, routes::kMediaViewer);
}

TEST(RouteForLinkTest, RejectsAnythingOutsideTheAllowList) {
    EXPECT_FALSE(routeForLink("", kAllPrefixes).has_value());
    EXPECT_FALSE(routeForLink("https://evil.example/tasks/1", kAllPrefixes).has_value());
    EXPECT_FALSE(routeForLink("//evil.example/tasks/1", kAllPrefixes).has_value());
    EXPECT_FALSE(routeForLink("/tasks/../admin", kAllPrefixes).has_value());
    EXPECT_FALSE(routeForLink("/tasks/1?x=y", kAllPrefixes).has_value());
    EXPECT_FALSE(routeForLink("/admin", kAllPrefixes).has_value());
}

TEST(NavGraphTest, RegisteringTheSameDestinationTwiceIsIdempotent) {
    NavGraph graph;
    graph.registerDestination("test/a", kHomeView, {"a"});
    graph.registerDestination("test/a", kHomeView, {"a"}); // a capabilities update re-runs plugin registration

    EXPECT_EQ(graph.resolve("test/a"), kHomeView);
    EXPECT_EQ(graph.linkPrefixes().size(), 1U);
}

TEST(NavGraphTest, ADifferentViewForAnExistingRouteReplacesIt) {
    NavGraph graph;
    graph.registerDestination("test/a", kHomeView);
    graph.registerDestination("test/a", kProfileView);

    EXPECT_EQ(graph.resolve("test/a"), kProfileView);
}

// --- DeepLinkGate: a cold-start link waits for the sign-in instead of being wiped by it ------------------------

class DeepLinkGateTest : public ::testing::Test {
protected:
    DeepLinkGateTest() : router_(makeGraph()), gate_(router_) {
        QObject::connect(&router_, &Router::pushRequested,
                         [this](const QUrl& view, const QVariantMap&) { pushed_.push_back(view); });
    }

    static std::shared_ptr<const NavGraph> makeGraph() {
        auto graph = std::make_shared<NavGraph>();
        graph->registerDestination(routes::kLogin, kLoginView);
        graph->registerDestination(routes::kTasks, kHomeView, {"tasks"});
        graph->registerDestination(routes::kTaskDetail, kProfileView);
        return graph;
    }

    Router router_;
    DeepLinkGate gate_;
    std::vector<QUrl> pushed_;
};

TEST_F(DeepLinkGateTest, ALinkBeforeSignInIsKeptNotOpened) {
    EXPECT_FALSE(gate_.submit(QStringLiteral("/tasks/abc-1")));

    EXPECT_TRUE(gate_.hasPending());
    EXPECT_TRUE(pushed_.empty());
}

TEST_F(DeepLinkGateTest, ThePendingLinkOpensOnTopOfTheHomeScreenAfterSignIn) {
    ASSERT_TRUE(router_.resetTo(Route{.name = std::string(routes::kLogin), .params = {}}));
    gate_.submit(QStringLiteral("/tasks/abc-1"));

    ASSERT_TRUE(router_.resetTo(routes::tasks())); // what onSignedIn() does first
    gate_.setSignedIn(true);

    EXPECT_FALSE(gate_.hasPending());
    ASSERT_EQ(pushed_.size(), 1U);
    EXPECT_EQ(pushed_.front(), kProfileView);
    EXPECT_EQ(router_.depth(), 2);
}

TEST_F(DeepLinkGateTest, WhileSignedInALinkOpensImmediately) {
    gate_.setSignedIn(true);

    EXPECT_TRUE(gate_.submit(QStringLiteral("/tasks/abc-1")));
    EXPECT_FALSE(gate_.hasPending());
}

TEST_F(DeepLinkGateTest, SigningOutDropsAPendingLink) {
    gate_.submit(QStringLiteral("/tasks/abc-1"));
    gate_.setSignedIn(false);

    EXPECT_FALSE(gate_.hasPending());
    gate_.setSignedIn(true);
    EXPECT_TRUE(pushed_.empty());
}

TEST_F(DeepLinkGateTest, APendingLinkOutsideTheAllowListIsStillRefused) {
    gate_.submit(QStringLiteral("https://evil.example/tasks/1"));
    gate_.setSignedIn(true);

    EXPECT_TRUE(pushed_.empty());
}

} // namespace
} // namespace aedst::navigation

AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION()
