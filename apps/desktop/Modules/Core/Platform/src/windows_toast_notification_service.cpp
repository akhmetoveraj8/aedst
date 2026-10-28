#include "windows_toast_notification_service.hpp"

#include "aedst/logging/log_categories.hpp"
#include "aedst/platform/toast_xml.hpp"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QMetaObject>
#include <QPointer>
#include <QStandardPaths>
#include <QString>

#include <deque>
#include <string>
#include <utility>

// C++/WinRT must come after the Qt headers above only for readability; none of them includes <windows.h>
// without NOMINMAX / WIN32_LEAN_AND_MEAN, which the Platform target defines.
#include <propkey.h>
#include <propvarutil.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <winrt/Windows.Data.Xml.Dom.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.UI.Notifications.h>

namespace aedst::platform {
namespace {

namespace wn = winrt::Windows::UI::Notifications;
namespace wx = winrt::Windows::Data::Xml::Dom;

/// The AppUserModelID of the application. The installer's Start Menu shortcut must carry the same value.
constexpr wchar_t kAppUserModelId[] = L"com.aedst.Desktop";
constexpr std::size_t kMaxLiveToasts = 20;

/// True when the shortcut at `linkPath` carries System.AppUserModel.ID == kAppUserModelId.
bool shortcutCarriesAumid(const QString& linkPath) {
    winrt::com_ptr<IShellLinkW> link;
    if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(link.put())))) {
        return false;
    }
    const std::wstring target = QDir::toNativeSeparators(linkPath).toStdWString();
    if (FAILED(link.as<IPersistFile>()->Load(target.c_str(), STGM_READ))) {
        return false;
    }
    PROPVARIANT value{};
    PropVariantInit(&value);
    bool matches = false;
    if (SUCCEEDED(link.as<IPropertyStore>()->GetValue(PKEY_AppUserModel_ID, &value)) && value.vt == VT_LPWSTR &&
        value.pwszVal != nullptr) {
        matches = std::wstring(value.pwszVal) == kAppUserModelId;
    }
    PropVariantClear(&value);
    return matches;
}

/// Windows only shows toasts of unpackaged apps whose AUMID is bound to a Start Menu shortcut.
///
/// VERIFY first: the installer owns the shortcut (`Programs\AEDST\AEDST.lnk` or `Programs\AEDST.lnk`, per machine or
/// per user). If one of them carries the AUMID nothing is created. Only when none does, a per-user fallback
/// `Programs\AEDST.lnk` with the AUMID is written (self-healing for portable/ZIP installs and for an installer that
/// could not set the property); the uninstaller removes that fallback again (installer.nsi.in, Windows.cmake).
bool ensureStartMenuShortcut(const QString& displayName) {
    const QStringList programDirectories = QStandardPaths::standardLocations(QStandardPaths::ApplicationsLocation);
    for (const QString& directory : programDirectories) {
        for (const QString& candidate :
             {QDir(directory).filePath(displayName + QStringLiteral(".lnk")),
              QDir(directory).filePath(displayName + QStringLiteral("/") + displayName + QStringLiteral(".lnk"))}) {
            if (QFileInfo::exists(candidate) && shortcutCarriesAumid(candidate)) {
                return true; // the installer's shortcut is in order
            }
        }
    }
    const QString programs = QStandardPaths::writableLocation(QStandardPaths::ApplicationsLocation);
    if (programs.isEmpty()) {
        return false;
    }
    const QString linkPath = QDir(programs).filePath(displayName + QStringLiteral(".lnk"));
    qCWarning(lcNotifications, "No Start Menu shortcut with the AppUserModelID found; writing a per-user fallback");
    QDir().mkpath(programs);

    winrt::com_ptr<IShellLinkW> link;
    if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(link.put())))) {
        return false;
    }
    const std::wstring exe = QDir::toNativeSeparators(QCoreApplication::applicationFilePath()).toStdWString();
    if (FAILED(link->SetPath(exe.c_str()))) {
        return false;
    }
    const std::wstring workingDirectory =
        QDir::toNativeSeparators(QCoreApplication::applicationDirPath()).toStdWString();
    link->SetWorkingDirectory(workingDirectory.c_str());

    winrt::com_ptr<IPropertyStore> properties = link.as<IPropertyStore>();
    PROPVARIANT value{};
    if (FAILED(InitPropVariantFromString(kAppUserModelId, &value))) {
        return false;
    }
    const HRESULT stored = properties->SetValue(PKEY_AppUserModel_ID, value);
    PropVariantClear(&value);
    if (FAILED(stored) || FAILED(properties->Commit())) {
        return false;
    }
    winrt::com_ptr<IPersistFile> file = link.as<IPersistFile>();
    const std::wstring target = QDir::toNativeSeparators(linkPath).toStdWString();
    return SUCCEEDED(file->Save(target.c_str(), TRUE));
}

} // namespace

class WindowsToastNotificationService::Impl {
public:
    wn::ToastNotifier notifier{nullptr};
    std::deque<wn::ToastNotification> live; // keeps the toast objects (and their event handlers) alive
};

WindowsToastNotificationService::WindowsToastNotificationService(NotificationService& fallback, QObject* parent)
    : QObject(parent), impl_(std::make_unique<Impl>()), fallback_(fallback) {
    try {
        const QString name = QCoreApplication::applicationName().isEmpty() ? QStringLiteral("AEDST")
                                                                           : QCoreApplication::applicationName();
        if (FAILED(SetCurrentProcessExplicitAppUserModelID(kAppUserModelId))) {
            qCWarning(lcNotifications, "Could not set the AppUserModelID; native toasts are disabled");
            return;
        }
        if (!ensureStartMenuShortcut(name)) {
            qCWarning(lcNotifications, "No Start Menu shortcut with an AppUserModelID; native toasts are disabled");
            return;
        }
        // Qt initialised COM on this thread already (OleInitialize); C++/WinRT only needs it to be initialised.
        impl_->notifier = wn::ToastNotificationManager::CreateToastNotifier(kAppUserModelId);
        ready_ = true;
    } catch (const winrt::hresult_error& error) {
        qCWarning(lcNotifications, "Windows toast notifications are unavailable: %s",
                  qUtf8Printable(QString::fromStdWString(error.message().c_str())));
    }
}

WindowsToastNotificationService::~WindowsToastNotificationService() = default;

bool WindowsToastNotificationService::isAvailable() const {
    if (!ready_) {
        return false;
    }
    try {
        // Enabled unless the user, group policy or focus assist-by-app settings disabled this app's toasts.
        return impl_->notifier.Setting() == wn::NotificationSetting::Enabled;
    } catch (const winrt::hresult_error&) {
        return false;
    }
}

void WindowsToastNotificationService::show(std::string_view title, std::string_view body,
                                           NotificationSeverity severity) {
    showRequest(NotificationRequest{.title = std::string(title), .body = std::string(body), .severity = severity});
}

void WindowsToastNotificationService::showRequest(const NotificationRequest& request) {
    if (!isAvailable()) {
        fallback_.show(request.title, request.body, request.severity);
        return;
    }
    try {
        wx::XmlDocument document;
        document.LoadXml(winrt::hstring(buildToastXml(request)));
        wn::ToastNotification toast(document);

        if (!request.tag.empty()) {
            // Tag/Group identify a toast for replacement; the tag is limited to 64 characters.
            const QString tag = QString::fromStdString(request.tag).left(64);
            toast.Tag(winrt::hstring(tag.toStdWString()));
            toast.Group(L"aedst");
        }
        if (isActivatableLink(request.link)) {
            QPointer<WindowsToastNotificationService> self(this);
            toast.Activated([self](wn::ToastNotification const&, winrt::Windows::Foundation::IInspectable const& args) {
                std::string link;
                if (auto activated = args.try_as<wn::ToastActivatedEventArgs>()) {
                    link = winrt::to_string(activated.Arguments());
                }
                // Raised on a thread-pool thread: hand over to the GUI thread.
                if (self) {
                    QMetaObject::invokeMethod(
                        self.data(),
                        [self, link]() {
                            if (self && isActivatableLink(link)) {
                                self->notifyActivated(link);
                            }
                        },
                        Qt::QueuedConnection);
                }
            });
        }

        impl_->live.push_back(toast);
        while (impl_->live.size() > kMaxLiveToasts) {
            impl_->live.pop_front();
        }
        impl_->notifier.Show(toast);
    } catch (const winrt::hresult_error& error) {
        qCWarning(lcNotifications, "Showing a toast failed (%s); using the fallback",
                  qUtf8Printable(QString::fromStdWString(error.message().c_str())));
        fallback_.show(request.title, request.body, request.severity);
    }
}

} // namespace aedst::platform
