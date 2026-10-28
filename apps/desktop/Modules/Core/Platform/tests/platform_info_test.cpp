#include "aedst/platform/platform_info.hpp"

#include <gtest/gtest.h>

#include <string>
#include <utility>

namespace aedst::platform {
namespace {

PlatformProbe linuxProbe(EnvironmentMap env) {
    PlatformProbe probe;
    probe.os = OperatingSystem::Linux;
    probe.osVersion = "24.04";
    probe.architecture = "x86_64";
    probe.environment = std::move(env);
    return probe;
}

TEST(PlatformInfoTest, DetectsWaylandGnome) {
    const PlatformInfo info =
        describePlatform(linuxProbe({{"XDG_SESSION_TYPE", "Wayland"}, {"XDG_CURRENT_DESKTOP", "ubuntu:GNOME"}}));
    EXPECT_EQ(info.os, OperatingSystem::Linux);
    EXPECT_EQ(info.osVersion, "24.04");
    EXPECT_EQ(info.architecture, "x86_64");
    EXPECT_EQ(info.displayServer, "wayland");
    EXPECT_EQ(info.desktopEnvironment, "ubuntu:GNOME");
    EXPECT_FALSE(info.isFlatpak);
    EXPECT_FALSE(info.isSandboxed);
}

TEST(PlatformInfoTest, FallsBackToDisplayVariablesWhenSessionTypeIsMissing) {
    EXPECT_EQ(describePlatform(linuxProbe({{"WAYLAND_DISPLAY", "wayland-0"}})).displayServer, "wayland");
    EXPECT_EQ(describePlatform(linuxProbe({{"DISPLAY", ":0"}})).displayServer, "x11");
    EXPECT_EQ(describePlatform(linuxProbe({})).displayServer, "unknown");
    EXPECT_EQ(describePlatform(linuxProbe({{"XDG_SESSION_TYPE", "bogus"}})).displayServer, "unknown");
}

TEST(PlatformInfoTest, SanitisesDesktopEnvironment) {
    EXPECT_EQ(describePlatform(linuxProbe({{"XDG_CURRENT_DESKTOP", "KDE"}})).desktopEnvironment, "KDE");
    EXPECT_TRUE(describePlatform(linuxProbe({{"XDG_CURRENT_DESKTOP", "KDE; rm -rf /"}})).desktopEnvironment.empty());
    EXPECT_TRUE(
        describePlatform(linuxProbe({{"XDG_CURRENT_DESKTOP", std::string(65, 'a')}})).desktopEnvironment.empty());
}

TEST(PlatformInfoTest, DetectsFlatpakAndSnapSandboxes) {
    PlatformProbe flatpak = linuxProbe({});
    flatpak.flatpakInfoExists = true;
    const PlatformInfo flatpakInfo = describePlatform(flatpak);
    EXPECT_TRUE(flatpakInfo.isFlatpak);
    EXPECT_TRUE(flatpakInfo.isSandboxed);

    const PlatformInfo snapInfo = describePlatform(linuxProbe({{"SNAP", "/snap/aedst/1"}}));
    EXPECT_FALSE(snapInfo.isFlatpak);
    EXPECT_TRUE(snapInfo.isSandboxed);
}

TEST(PlatformInfoTest, NonLinuxIgnoresLinuxSpecificSignals) {
    PlatformProbe windows;
    windows.os = OperatingSystem::Windows;
    windows.flatpakInfoExists = true;
    windows.environment = {{"XDG_SESSION_TYPE", "wayland"}, {"SNAP", "x"}};
    const PlatformInfo winInfo = describePlatform(windows);
    EXPECT_EQ(winInfo.displayServer, "win32");
    EXPECT_EQ(winInfo.desktopEnvironment, "windows");
    EXPECT_FALSE(winInfo.isFlatpak);
    EXPECT_FALSE(winInfo.isSandboxed);
}

TEST(PlatformInfoTest, CurrentProbeOnlyCopiesAllowListedVariables) {
    const PlatformProbe probe = currentPlatformProbe();
    for (const auto& entry : probe.environment) {
        const bool allowed = entry.first == "XDG_SESSION_TYPE" || entry.first == "XDG_CURRENT_DESKTOP" ||
                             entry.first == "WAYLAND_DISPLAY" || entry.first == "DISPLAY" || entry.first == "SNAP";
        EXPECT_TRUE(allowed) << entry.first;
    }
    EXPECT_FALSE(probe.architecture.empty());
}

} // namespace
} // namespace aedst::platform
