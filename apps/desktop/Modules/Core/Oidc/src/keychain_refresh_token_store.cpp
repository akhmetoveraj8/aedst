#include "aedst/core/guarded.hpp"
#include "aedst/oidc/refresh_token_store.hpp"

// QtKeychain installs its header as <qt6keychain/keychain.h>; when it is built as a CMake
// subproject the header sits at the top of the source tree as <keychain.h>.
#if __has_include(<qt6keychain/keychain.h>)
#include <qt6keychain/keychain.h>
#else
#include <keychain.h>
#endif

#include <QObject>
#include <QString>

#include <memory>
#include <utility>

namespace aedst::oidc {
namespace {

[[nodiscard]] core::Error storageError(const char* action, const QKeychain::Job& job) {
    std::string message =
        std::string("Secure credential storage is unavailable (") + action + "): " + job.errorString().toStdString();
    switch (job.error()) {
    case QKeychain::NoBackendAvailable:
        message += ". Install and unlock a Secret Service provider (GNOME Keyring or KWallet).";
        break;
    case QKeychain::AccessDenied:
    case QKeychain::AccessDeniedByUser:
        message += ". Access to the credential store was denied.";
        break;
    default:
        break;
    }
    return core::Error::storage(std::move(message));
}

class KeychainRefreshTokenStore final : public QObject, public RefreshTokenStore {
public:
    KeychainRefreshTokenStore(std::string service, std::string entry)
        : service_(QString::fromStdString(service)), entry_(QString::fromStdString(entry)) {}

    void load(core::Completion<std::optional<StoredIdentity>> done) override {
        auto* job = new QKeychain::ReadPasswordJob(service_, this);
        job->setKey(entry_);
        job->setAutoDelete(true);
        job->setInsecureFallback(false); // never fall back to plain QSettings storage
        QObject::connect(job, &QKeychain::Job::finished, this, [done = std::move(done)](QKeychain::Job* finished) {
            auto* read = static_cast<QKeychain::ReadPasswordJob*>(finished);
            if (read->error() == QKeychain::EntryNotFound) {
                core::invokeGuarded("OIDC completion", [&] { done(std::optional<StoredIdentity>{}); });
                return;
            }
            if (read->error() != QKeychain::NoError) {
                core::invokeGuarded("OIDC completion", [&] { done(core::fail(storageError("read", *read))); });
                return;
            }
            std::string text = read->textData().toStdString();
            auto identity = parseIdentity(text);
            core::secureWipe(text);
            if (!identity) {
                core::invokeGuarded("OIDC completion", [&] { done(core::fail(identity.error())); });
                return;
            }
            core::invokeGuarded("OIDC completion", [&] { done(std::optional<StoredIdentity>(std::move(*identity))); });
        });
        job->start();
    }

    void save(const StoredIdentity& identity, core::Completion<void> done) override {
        auto* job = new QKeychain::WritePasswordJob(service_, this);
        job->setKey(entry_);
        job->setAutoDelete(true);
        job->setInsecureFallback(false);
        std::string text = serializeIdentity(identity);
        job->setTextData(QString::fromStdString(text));
        core::secureWipe(text);
        QObject::connect(job, &QKeychain::Job::finished, this, [done = std::move(done)](QKeychain::Job* finished) {
            if (finished->error() != QKeychain::NoError) {
                core::invokeGuarded("OIDC completion", [&] { done(core::fail(storageError("write", *finished))); });
                return;
            }
            core::invokeGuarded("OIDC completion", [&] { done(core::ok()); });
        });
        job->start();
    }

    void clear(core::Completion<void> done) override {
        auto* job = new QKeychain::DeletePasswordJob(service_, this);
        job->setKey(entry_);
        job->setAutoDelete(true);
        QObject::connect(job, &QKeychain::Job::finished, this, [done = std::move(done)](QKeychain::Job* finished) {
            if (finished->error() != QKeychain::NoError && finished->error() != QKeychain::EntryNotFound) {
                core::invokeGuarded("OIDC completion", [&] { done(core::fail(storageError("delete", *finished))); });
                return;
            }
            core::invokeGuarded("OIDC completion", [&] { done(core::ok()); });
        });
        job->start();
    }

private:
    QString service_;
    QString entry_;
};

} // namespace

std::unique_ptr<RefreshTokenStore> makeKeychainRefreshTokenStore(std::string service, std::string entry) {
    return std::make_unique<KeychainRefreshTokenStore>(std::move(service), std::move(entry));
}

} // namespace aedst::oidc
