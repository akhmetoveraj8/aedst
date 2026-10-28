#include "aedst/oidc/refresh_token_store.hpp"

#include "aedst/core/guarded.hpp"

#include <QByteArray>
#include <QCryptographicHash>
#include <QJsonDocument>
#include <QJsonObject>
#include <QString>
#include <QTimer>

#include <utility>

namespace aedst::oidc {

namespace {
constexpr int kEnvelopeVersion = 1;
} // namespace

std::string serializeIdentity(const StoredIdentity& identity) {
    QJsonObject object;
    object.insert(QStringLiteral("v"), kEnvelopeVersion);
    object.insert(QStringLiteral("rt"), QString::fromStdString(identity.refreshToken.reveal()));
    object.insert(QStringLiteral("sub"), QString::fromStdString(identity.subject));
    const QByteArray bytes = QJsonDocument(object).toJson(QJsonDocument::Compact);
    return std::string(bytes.constData(), static_cast<std::size_t>(bytes.size()));
}

core::Outcome<StoredIdentity> parseIdentity(const std::string& text) {
    QJsonParseError parseError;
    const QJsonDocument document =
        QJsonDocument::fromJson(QByteArray(text.data(), static_cast<qsizetype>(text.size())), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        return core::fail(core::Error::storage("Stored sign-in data is corrupt"));
    }
    const QJsonObject object = document.object();
    if (object.value(QStringLiteral("v")).toInt(-1) != kEnvelopeVersion) {
        return core::fail(core::Error::storage("Stored sign-in data has an unknown version"));
    }
    StoredIdentity identity;
    identity.refreshToken = core::SecretString(object.value(QStringLiteral("rt")).toString().toStdString());
    identity.subject = object.value(QStringLiteral("sub")).toString().toStdString();
    if (identity.refreshToken.empty() || identity.subject.empty()) {
        return core::fail(core::Error::storage("Stored sign-in data is incomplete"));
    }
    return identity;
}

std::string keychainEntryName(const std::string& issuer, const std::string& clientId) {
    QCryptographicHash hash(QCryptographicHash::Sha256);
    hash.addData(QByteArrayView(issuer.data(), static_cast<qsizetype>(issuer.size())));
    hash.addData(QByteArrayView("\n", 1));
    hash.addData(QByteArrayView(clientId.data(), static_cast<qsizetype>(clientId.size())));
    const QByteArray digest = hash.result().toHex().left(24);
    return "oidc-" + std::string(digest.constData(), static_cast<std::size_t>(digest.size()));
}

// --- InMemoryRefreshTokenStore -------------------------------------------------------------

namespace {

/// Completions are delivered from the event loop, like the real keychain, so callers cannot
/// accidentally depend on synchronous behaviour.
template <typename T, typename Result>
void deliverLater(core::Completion<T> done, Result result) {
    QTimer::singleShot(0, [done = std::move(done), result = std::move(result)]() mutable {
        core::invokeGuarded("OIDC completion", [&] { done(std::move(result)); });
    });
}

core::Error unavailableError() {
    return core::Error::storage("Secure credential storage is unavailable");
}

} // namespace

void InMemoryRefreshTokenStore::load(core::Completion<std::optional<StoredIdentity>> done) {
    if (unavailable_) {
        deliverLater<std::optional<StoredIdentity>>(
            std::move(done), core::Outcome<std::optional<StoredIdentity>>(core::fail(unavailableError())));
        return;
    }
    deliverLater<std::optional<StoredIdentity>>(std::move(done),
                                                core::Outcome<std::optional<StoredIdentity>>(identity_));
}

void InMemoryRefreshTokenStore::save(const StoredIdentity& identity, core::Completion<void> done) {
    if (unavailable_) {
        deliverLater<void>(std::move(done), core::VoidOutcome(core::fail(unavailableError())));
        return;
    }
    identity_ = identity;
    deliverLater<void>(std::move(done), core::ok());
}

void InMemoryRefreshTokenStore::clear(core::Completion<void> done) {
    if (unavailable_) {
        deliverLater<void>(std::move(done), core::VoidOutcome(core::fail(unavailableError())));
        return;
    }
    identity_.reset();
    deliverLater<void>(std::move(done), core::ok());
}

} // namespace aedst::oidc
