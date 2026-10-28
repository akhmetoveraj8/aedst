#include "aedst/persistence/async_token_store.hpp"

#include "aedst/core/secure_memory.hpp"
#include "aedst/persistence/secure_storage.hpp"

#include <utility>

namespace aedst::persistence {

/// Everything here is created and used on the database thread only.
struct AsyncTokenStore::WorkerState {
    KeyProviderFactory keyProvider;
    std::shared_ptr<SecureStorage> storage;

    /// First use creates the master key provider (this probes the OS keyring) and the storage on top of it.
    const std::shared_ptr<SecureStorage>& secureStorage() {
        if (!storage) {
            std::shared_ptr<MasterKeyProvider> provider(keyProvider());
            storage = std::make_shared<SecureStorage>(std::move(provider));
        }
        return storage;
    }
};

AsyncTokenStore::AsyncTokenStore(std::shared_ptr<DatabaseWorker> worker, KeyProviderFactory keyProvider,
                                 Dispatcher dispatcher)
    : worker_(std::move(worker)),
      dispatcher_(std::move(dispatcher)),
      state_(std::make_shared<WorkerState>(WorkerState{.keyProvider = std::move(keyProvider), .storage = nullptr})) {}

AsyncTokenStore::~AsyncTokenStore() = default;

void AsyncTokenStore::load(core::Completion<std::optional<StoredTokens>> done) {
    worker_->run<std::optional<StoredTokens>>(
        [state = state_](const std::shared_ptr<SqliteConnection>& connection) {
            return TokenStore(connection, state->secureStorage()).load();
        },
        dispatcher_, std::move(done));
}

void AsyncTokenStore::save(const StoredTokens& tokens, core::Completion<void> done) {
    worker_->run<void>(
        [state = state_, tokens](const std::shared_ptr<SqliteConnection>& connection) mutable {
            const core::VoidOutcome saved = TokenStore(connection, state->secureStorage()).save(tokens);
            core::secureWipe(tokens.accessToken);
            core::secureWipe(tokens.refreshToken);
            return saved;
        },
        dispatcher_, std::move(done));
}

void AsyncTokenStore::clear(core::Completion<void> done) {
    worker_->run<void>(
        [state = state_](const std::shared_ptr<SqliteConnection>& connection) {
            return TokenStore(connection, state->secureStorage()).clear();
        },
        dispatcher_, std::move(done));
}

} // namespace aedst::persistence
