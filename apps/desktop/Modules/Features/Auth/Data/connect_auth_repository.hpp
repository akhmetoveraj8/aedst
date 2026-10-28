#pragma once

#include "Data/auth_remote_data_source.hpp"
#include "Data/local_token_store_adapter.hpp"
#include "Domain/auth_repository.hpp"
#include "aedst/core/clock.hpp"

#include <memory>
#include <string>

namespace aedst::feature::auth {

/// Remote is the source of truth for issuing/rotating tokens; the local store
/// is the source of truth for "am I signed in". Logout always clears local
/// state, even when the server can't be reached.
class ConnectAuthRepository final : public AuthRepository, public std::enable_shared_from_this<ConnectAuthRepository> {
public:
    ConnectAuthRepository(std::shared_ptr<AuthRemoteDataSource> remote, std::shared_ptr<LocalTokenStoreAdapter> local,
                          std::shared_ptr<const core::Clock> clock, std::string deviceId);

    void login(const Credentials& credentials, core::Completion<Session> done) override;
    void refreshToken(core::Completion<Session> done) override;
    void logout(core::Completion<void> done) override;
    [[nodiscard]] std::optional<Session> currentSession() const override;

private:
    [[nodiscard]] Session toSession(std::string userId, const authv1::TokenPair& tokens) const;
    void persistAndComplete(Session session, const core::Completion<Session>& done);

    std::shared_ptr<AuthRemoteDataSource> remote_;
    std::shared_ptr<LocalTokenStoreAdapter> local_;
    std::shared_ptr<const core::Clock> clock_;
    std::string deviceId_;
};

} // namespace aedst::feature::auth
