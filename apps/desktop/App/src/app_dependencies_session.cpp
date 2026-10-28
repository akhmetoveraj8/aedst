#include "Data/connect_admin_repository.hpp"
#include "Data/connect_auth_remote_data_source.hpp"
#include "Data/connect_notification_repository.hpp"
#include "Data/connect_notification_stream.hpp"
#include "Data/connect_search_repository.hpp"
#include "Data/connect_task_repository.hpp"
#include "Data/oidc_auth_repository.hpp"
#include "Domain/browser_sign_in_use_case.hpp"
#include "Domain/create_task_use_case.hpp"
#include "Domain/login_use_case.hpp"
#include "Domain/logout_use_case.hpp"
#include "Navigation/admin_destinations.hpp"
#include "Navigation/auth_destinations.hpp"
#include "Navigation/auth_route.hpp"
#include "Navigation/media_destinations.hpp"
#include "Navigation/notifications_destinations.hpp"
#include "Navigation/search_destinations.hpp"
#include "Navigation/tasks_destinations.hpp"
#include "Navigation/tasks_route.hpp"
#include "Presentation/admin_view_model.hpp"
#include "Presentation/media_library_view_model.hpp"
#include "Presentation/media_viewer_view_model.hpp"
#include "Presentation/notifications_view_model.hpp"
#include "Presentation/search_view_model.hpp"
#include "Presentation/task_detail_view_model.hpp"
#include "Presentation/task_list_view_model.hpp"
#include "aedst/logging/log_categories.hpp"
#include "aedst/media/media_remote_data_source.hpp"
#include "aedst/network/access_token_claims.hpp"
#include "aedst/network/transport_policy.hpp"
#include "aedst/oidc/oidc_session.hpp"
#include "aedst/oidc/refresh_token_store.hpp"
#include "aedst/persistence/master_key_provider.hpp"
#include "aedst/telemetry/sentry_reporter.hpp"
#include "app_dependencies.hpp"
#include "plugin_host.hpp"

#include <QCoreApplication>
#include <QMetaObject>
#include <QObject>

#include <functional>
#include <optional>
#include <utility>

// AppDependencies: session lifecycle (sign-in/out wiring, startup restore and refresh). Split out of
// app_dependencies.cpp without behaviour change.

namespace aedst::app {

namespace auth = feature::auth;
namespace tasks = feature::tasks;
namespace search = feature::search;
namespace notifications = feature::notifications;
namespace mediafeature = feature::media;
namespace admin = feature::admin;

void AppDependencies::wireSessionLifecycle() {
    // Signal connections use the ViewModel as context: they die with it.
    QObject::connect(loginViewModel_.get(), &auth::LoginViewModel::loginSucceeded, loginViewModel_.get(),
                     [this](const QString&) {
                         // An interactive sign-in starts clean: whatever the outbox still holds belongs to an earlier
                         // session (sign-out purges it, but a process that died first could not), and it must never be
                         // delivered under another account.
                         outbox_->purge();
                         onSignedIn();
                     });
    QObject::connect(loginViewModel_.get(), &auth::LoginViewModel::loggedOut, loginViewModel_.get(),
                     [this]() { onSignedOut(); });
    // OIDC: the provider rejected the refresh token (revoked, user disabled, expired). The session is
    // already wiped, so only the UI state has to follow.
    if (oidcSession_) {
        QObject::connect(oidcSession_.get(), &oidc::OidcSession::sessionExpired, loginViewModel_.get(), [this]() {
            qCInfo(lcApp, "The identity provider ended the session; returning to login");
            onSignedOut();
            router_->resetTo(auth::loginRoute());
        });
    }
    // Any feature hitting `unauthenticated` (refresh token revoked, session expired
    // server-side) ends the session the same way an explicit sign-out does.
    QObject::connect(errorCenter_.get(), &telemetry::ErrorCenter::sessionExpired, errorCenter_.get(), [this]() {
        // isLoading: a sign-out is already running (several in-flight calls can fail at once).
        if (session_->signedIn() && !loginViewModel_->isLoading()) {
            qCInfo(lcApp, "Session expired; signing out");
            loginViewModel_->logout(); // clears local tokens, emits loggedOut -> onSignedOut
        }
    });
}

void AppDependencies::onSignedIn() {
    updateSessionInfo();
    resumeSession();
    router_->resetTo(tasks::taskListRoute());
    // After the reset: a cold-start deep link that arrived while signed out opens on top of the home screen.
    deepLinks_->setSignedIn(true);
}

void AppDependencies::resumeSession() {
    if (const auto current = authRepository_->currentSession()) {
        telemetry::SentryReporter::setUser(current->userId); // opaque id only
        notificationsViewModel_->start();
        outbox_->start(); // deliver what an earlier run of this session left behind
    }
}

void AppDependencies::onUpgradeRequired() {
    if (router_->isLocked()) {
        return; // several in-flight calls can be refused at once
    }
    qCWarning(lcApp, "The server no longer supports this app version; showing the upgrade screen");
    notificationsViewModel_->stop();
    router_->lockTo(navigation::Route{.name = std::string(navigation::routes::kUpgradeRequired), .params = {}});
}

void AppDependencies::onSignedOut() {
    // Forget every user-specific bit of state so the next user starts clean.
    outbox_->purge(); // queued writes belong to the user who made them
    deepLinks_->setSignedIn(false);
    notificationsViewModel_->stop();
    taskListViewModel_->clear();
    taskDetailViewModel_->clear();
    searchViewModel_->clear();
    mediaLibraryViewModel_->clear();
    mediaViewerViewModel_->clear();
    adminViewModel_->clear();
    telemetry::SentryReporter::clearUser();
    updateSessionInfo();
    if (signedOutHook_) {
        signedOutHook_();
    }
    // LoginViewModel::logout() already reset the router to the login route.
}

void AppDependencies::setSignedOutHook(std::function<void()> hook) {
    signedOutHook_ = std::move(hook);
}

void AppDependencies::updateSessionInfo() {
    const auto current = authRepository_->currentSession();
    bool isAdmin = false;
    if (current) {
        if (const auto claims = network::parseAccessTokenClaims(current->accessToken.reveal(), rolesClaim_)) {
            isAdmin = claims->hasRole(admin::kAdminRole);
        }
    }
    session_->set(current.has_value(), isAdmin);
}

void AppDependencies::restoreOidcSession() {
    loginViewModel_->setRestoringSession(true);
    oidcSession_->restore([this](core::Outcome<std::optional<oidc::OidcUser>> restored) {
        loginViewModel_->setRestoringSession(false);
        if (!restored) {
            if (core::isRetryable(restored.error().code) && oidcSession_->isSignedIn()) {
                // Offline start: keep the identity and show the signed-in UI; requests refresh on demand.
                qCWarning(lcApp, "Restoring the session while offline: %s", restored.error().message.c_str());
                onSignedIn();
                return;
            }
            qCWarning(lcApp, "Could not restore the session: %s", restored.error().message.c_str());
            if (restored.error().code != core::ErrorCode::Unauthenticated) {
                loginViewModel_->showError(auth::LoginViewModel::messageFor(restored.error()));
            }
            return;
        }
        if (!restored->has_value()) {
            return; // nobody was signed in: the login screen stays
        }
        qCInfo(lcApp, "Session restored");
        onSignedIn();
    });
}

void AppDependencies::refreshSessionIfNeeded() {
    if (oidcSession_) {
        restoreOidcSession();
        return;
    }
    restoreFirstPartySession();
}

void AppDependencies::restoreFirstPartySession() {
    // The stored session is read from disk on the database thread; the login screen shows progress meanwhile.
    loginViewModel_->setRestoringSession(true);
    tokenAdapter_->preload([this](core::VoidOutcome loaded) {
        loginViewModel_->setRestoringSession(false);
        if (!loaded) {
            qCWarning(lcApp, "Could not read the stored session: %s", loaded.error().message.c_str());
            return; // stay on the login screen; signing in again recreates the session
        }
        if (!authRepository_->currentSession()) {
            return; // nobody was signed in
        }
        onSignedIn(); // updates the session info, resumes per-user work and opens the home screen
        refreshStoredSession();
    });
}

void AppDependencies::refreshStoredSession() {
    refreshToken_->execute(core::NoInput{}, [this](core::Outcome<auth::Session> result) {
        if (result) {
            updateSessionInfo(); // the rotated token may carry different roles
            return;
        }
        if (result.error().code == core::ErrorCode::Unauthenticated) {
            qCInfo(lcApp, "Stored session was rejected; returning to login");
            onSignedOut();
            router_->resetTo(auth::loginRoute());
            return;
        }
        qCWarning(lcApp, "Session refresh failed, keeping stored session: %s", result.error().message.c_str());
    });
}

} // namespace aedst::app
