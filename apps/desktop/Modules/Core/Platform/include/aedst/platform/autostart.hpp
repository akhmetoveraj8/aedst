#pragma once

#include "aedst/core/outcome.hpp"
#include "aedst/platform/platform_info.hpp"

#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace aedst::platform {

/// What gets launched at login.
struct AutostartConfig {
    /// Reverse-DNS id; also the .desktop file name and the
    /// Windows Run value name. Validated by isValidAutostartId().
    std::string appId{"com.aedst.Desktop"};
    std::string displayName{"AEDST"};
    /// Absolute path to the executable (QCoreApplication::applicationFilePath()).
    /// Caveat: an AppImage's path is a temporary mount; pass $APPIMAGE instead.
    std::filesystem::path executablePath;
    /// Lets the app start hidden/minimised when launched by the OS.
    std::vector<std::string> arguments{"--autostart"};
};

/// Launch-at-login switch. One implementation per OS, chosen by
/// makeAutostartManager(); isAvailable() is the runtime capability check so the
/// settings UI can grey the toggle out instead of failing on click.
class AutostartManager {
public:
    AutostartManager() = default;
    AutostartManager(const AutostartManager&) = delete;
    AutostartManager& operator=(const AutostartManager&) = delete;
    AutostartManager(AutostartManager&&) = delete;
    AutostartManager& operator=(AutostartManager&&) = delete;
    virtual ~AutostartManager() = default;

    [[nodiscard]] virtual bool isAvailable() const = 0;
    [[nodiscard]] virtual bool isEnabled() const = 0;
    [[nodiscard]] virtual core::VoidOutcome setEnabled(bool enabled) = 0;
};

// ---- Pure, Qt-free helpers (unit-tested) ----------------------------------

[[nodiscard]] bool isValidAutostartId(std::string_view appId);

/// `$XDG_CONFIG_HOME/autostart/<appId>.desktop` (XDG_CONFIG_HOME only when
/// absolute, per the basedir spec), else `$HOME/.config/autostart/...`.
[[nodiscard]] core::Outcome<std::filesystem::path> xdgAutostartFilePath(const EnvironmentMap& env,
                                                                        std::string_view appId);

/// Freedesktop Desktop Entry with a correctly quoted/escaped Exec line.
[[nodiscard]] core::Outcome<std::string> renderDesktopEntry(const AutostartConfig& config);

/// Command line stored under HKCU\...\Run: quoted exe followed by the args.
[[nodiscard]] core::Outcome<std::string> renderWindowsRunCommand(const AutostartConfig& config);

// ---- Implementations -------------------------------------------------------

/// Linux: XDG autostart entry written atomically (QSaveFile). Not usable inside
/// a Flatpak sandbox (the app's XDG_CONFIG_HOME is private and never read by the
/// session). The documented follow-up there is the Background portal
/// (org.freedesktop.portal.Background.RequestBackground with autostart=true);
/// it is deliberately NOT implemented here.
class XdgAutostartManager final : public AutostartManager {
public:
    XdgAutostartManager(AutostartConfig config, std::filesystem::path filePath);

    [[nodiscard]] bool isAvailable() const override;
    [[nodiscard]] bool isEnabled() const override;
    [[nodiscard]] core::VoidOutcome setEnabled(bool enabled) override;

private:
    AutostartConfig config_;
    std::filesystem::path filePath_;
};

#if defined(_WIN32)
/// Windows: HKCU\Software\Microsoft\Windows\CurrentVersion\Run via QSettings
/// (native format = the registry). Per-user, needs no elevation.
class WindowsRunKeyAutostartManager final : public AutostartManager {
public:
    explicit WindowsRunKeyAutostartManager(AutostartConfig config);

    [[nodiscard]] bool isAvailable() const override;
    [[nodiscard]] bool isEnabled() const override;
    [[nodiscard]] core::VoidOutcome setEnabled(bool enabled) override;

private:
    AutostartConfig config_;
};
#endif

/// Used when the platform (or sandbox) offers no supported mechanism.
class UnsupportedAutostartManager final : public AutostartManager {
public:
    explicit UnsupportedAutostartManager(std::string reason);

    [[nodiscard]] bool isAvailable() const override;
    [[nodiscard]] bool isEnabled() const override;
    [[nodiscard]] core::VoidOutcome setEnabled(bool enabled) override;

private:
    std::string reason_;
};

/// Picks the implementation at compile time (_WIN32 / else) and
/// degrades to UnsupportedAutostartManager at runtime when unusable (Flatpak,
/// missing HOME, invalid config).
[[nodiscard]] std::unique_ptr<AutostartManager> makeAutostartManager(AutostartConfig config);
[[nodiscard]] std::unique_ptr<AutostartManager> makeAutostartManager(AutostartConfig config,
                                                                     const PlatformProbe& probe);

} // namespace aedst::platform
