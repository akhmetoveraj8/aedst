#include "aedst/platform/autostart.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <system_error>

namespace aedst::platform {
namespace {

namespace fs = std::filesystem;

std::string readFile(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

class AutostartTest : public ::testing::Test {
protected:
    void SetUp() override {
        std::error_code ec;
        root_ = fs::temp_directory_path(ec) / ("aedst_autostart_" + std::to_string(counter_++) + "_" +
                                               ::testing::UnitTest::GetInstance()->current_test_info()->name());
        fs::remove_all(root_, ec);
        fs::create_directories(root_, ec);
    }

    void TearDown() override {
        std::error_code ec;
        fs::remove_all(root_, ec);
    }

    [[nodiscard]] AutostartConfig config() const {
        AutostartConfig cfg;
        cfg.executablePath = root_ / "bin" / "aedst";
        return cfg;
    }

    fs::path root_;
    static inline int counter_ = 0;
};

TEST(AutostartPathTest, XdgConfigHomeWinsWhenAbsolute) {
    const EnvironmentMap env{{"XDG_CONFIG_HOME", "/cfg"}, {"HOME", "/home/u"}};
    const auto path = xdgAutostartFilePath(env, "com.aedst.Desktop");
    ASSERT_TRUE(path.has_value());
    EXPECT_EQ(*path, fs::path{"/cfg"} / "autostart" / "com.aedst.Desktop.desktop");
}

TEST(AutostartPathTest, RelativeXdgConfigHomeFallsBackToHome) {
    const EnvironmentMap env{{"XDG_CONFIG_HOME", "relative/dir"}, {"HOME", "/home/u"}};
    const auto path = xdgAutostartFilePath(env, "com.aedst.Desktop");
    ASSERT_TRUE(path.has_value());
    EXPECT_EQ(*path, fs::path{"/home/u"} / ".config" / "autostart" / "com.aedst.Desktop.desktop");
}

TEST(AutostartPathTest, MissingHomeIsAnError) {
    EXPECT_FALSE(xdgAutostartFilePath({}, "com.aedst.Desktop").has_value());
}

TEST(AutostartPathTest, RejectsUnsafeAppIds) {
    for (const char* id : {"", "../evil", "a/b", ".hidden", "with space", "semi;colon"}) {
        EXPECT_FALSE(isValidAutostartId(id)) << id;
        EXPECT_FALSE(xdgAutostartFilePath({{"HOME", "/h"}}, id).has_value()) << id;
    }
    EXPECT_TRUE(isValidAutostartId("com.aedst.Desktop"));
}

TEST_F(AutostartTest, DesktopEntryQuotesExecAndEscapesSpecials) {
    AutostartConfig cfg = config();
    cfg.arguments = {"--autostart", "a b", "$HOME", "100%"};
    const auto entry = renderDesktopEntry(cfg);
    ASSERT_TRUE(entry.has_value());
    EXPECT_NE(entry->find("[Desktop Entry]\n"), std::string::npos);
    EXPECT_NE(entry->find("Type=Application\n"), std::string::npos);
    EXPECT_NE(entry->find("\"--autostart\" \"a b\" \"\\\\$HOME\" \"100%%\"\n"), std::string::npos) << *entry;
}

TEST_F(AutostartTest, RejectsRelativeExecutableAndControlCharacters) {
    AutostartConfig relative = config();
    relative.executablePath = "aedst";
    EXPECT_FALSE(renderDesktopEntry(relative).has_value());

    AutostartConfig injected = config();
    injected.arguments = {"--x\nExec=evil"};
    EXPECT_FALSE(renderDesktopEntry(injected).has_value());
    EXPECT_FALSE(renderWindowsRunCommand(injected).has_value());
}

TEST_F(AutostartTest, WindowsRunCommandQuotesExecutable) {
    AutostartConfig cfg = config();
    cfg.arguments = {"--autostart", "two words"};
    const auto command = renderWindowsRunCommand(cfg);
    ASSERT_TRUE(command.has_value());
    EXPECT_EQ(command->front(), '"');
    EXPECT_NE(command->find("\" --autostart \"two words\""), std::string::npos) << *command;

    cfg.arguments = {"bad\"quote"};
    EXPECT_FALSE(renderWindowsRunCommand(cfg).has_value());
}

TEST_F(AutostartTest, XdgManagerWritesAndRemovesEntry) {
    const fs::path file = root_ / "cfg" / "autostart" / "com.aedst.Desktop.desktop";
    XdgAutostartManager manager{config(), file};
    EXPECT_TRUE(manager.isAvailable());
    EXPECT_FALSE(manager.isEnabled());

    ASSERT_TRUE(manager.setEnabled(true).has_value());
    EXPECT_TRUE(manager.isEnabled());
    EXPECT_NE(readFile(file).find("Exec="), std::string::npos);

    // Idempotent overwrite.
    ASSERT_TRUE(manager.setEnabled(true).has_value());

    ASSERT_TRUE(manager.setEnabled(false).has_value());
    EXPECT_FALSE(manager.isEnabled());
    // Disabling twice is not an error.
    EXPECT_TRUE(manager.setEnabled(false).has_value());
}

#if !defined(_WIN32)
TEST_F(AutostartTest, FactoryDegradesInsideFlatpak) {
    PlatformProbe probe;
    probe.os = OperatingSystem::Linux;
    probe.flatpakInfoExists = true;
    probe.environment = {{"HOME", root_.generic_string()}};
    const auto manager = makeAutostartManager(config(), probe);
    EXPECT_FALSE(manager->isAvailable());
    EXPECT_FALSE(manager->setEnabled(true).has_value());
}

TEST_F(AutostartTest, FactoryUsesXdgConfigHomeOutsideFlatpak) {
    PlatformProbe probe;
    probe.os = OperatingSystem::Linux;
    probe.environment = {{"XDG_CONFIG_HOME", root_.generic_string()}};
    const auto manager = makeAutostartManager(config(), probe);
    ASSERT_TRUE(manager->isAvailable());
    ASSERT_TRUE(manager->setEnabled(true).has_value());
    EXPECT_TRUE(fs::exists(root_ / "autostart" / "com.aedst.Desktop.desktop"));
}
#endif

TEST(AutostartUnsupportedTest, NeverEnables) {
    UnsupportedAutostartManager manager{"because"};
    EXPECT_FALSE(manager.isAvailable());
    EXPECT_FALSE(manager.isEnabled());
    const auto result = manager.setEnabled(true);
    ASSERT_FALSE(result.has_value());
    EXPECT_NE(result.error().message.find("because"), std::string::npos);
}

} // namespace
} // namespace aedst::platform
