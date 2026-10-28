#include "aedst/plugin/service_registry.hpp"

#include <gtest/gtest.h>

#include <memory>

namespace aedst::plugin {
namespace {

struct Clock {
    int ticks{7};
};

struct Mailer {
    int sent{0};
};

TEST(ServiceRegistry, ProvidesAndFindsByType) {
    ServiceRegistry registry;
    ASSERT_TRUE(registry.provide(std::make_shared<Clock>()));

    const auto clock = registry.find<Clock>();
    ASSERT_NE(clock, nullptr);
    EXPECT_EQ(clock->ticks, 7);
    EXPECT_TRUE(registry.contains<Clock>());
    EXPECT_FALSE(registry.contains<Mailer>());
    EXPECT_EQ(registry.find<Mailer>(), nullptr);
}

TEST(ServiceRegistry, RefusesToReplaceAService) {
    ServiceRegistry registry;
    const auto first = std::make_shared<Clock>();
    ASSERT_TRUE(registry.provide(first));

    EXPECT_FALSE(registry.provide(std::make_shared<Clock>()));
    EXPECT_EQ(registry.find<Clock>(), first);
}

TEST(ServiceRegistry, RefusesNull) {
    ServiceRegistry registry;
    EXPECT_FALSE(registry.provide(std::shared_ptr<Clock>{}));
    EXPECT_EQ(registry.size(), 0U);
}

TEST(ServiceRegistry, CopyIsAnIndependentSnapshot) {
    ServiceRegistry registry;
    ASSERT_TRUE(registry.provide(std::make_shared<Clock>()));
    const ServiceRegistry snapshot = registry;

    ASSERT_TRUE(registry.provide(std::make_shared<Mailer>()));
    EXPECT_TRUE(registry.contains<Mailer>());
    EXPECT_FALSE(snapshot.contains<Mailer>());
}

} // namespace
} // namespace aedst::plugin
