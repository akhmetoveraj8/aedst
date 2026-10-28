#pragma once

#include "Domain/search_repository.hpp"

#include <aedst/search/v1/search.pb.h>
#include <memory>

namespace aedst::network {
class ConnectClient;
} // namespace aedst::network

namespace aedst::feature::search {

namespace searchv1 = ::aedst::search::v1;

/// SearchRepository over ConnectClient; maps SearchHit (parsing the highlight
/// markers once, here) and ApiError -> core::Error.
class ConnectSearchRepository final : public SearchRepository {
public:
    explicit ConnectSearchRepository(std::shared_ptr<network::ConnectClient> client);

    void search(const SearchQuery& query, core::Completion<SearchPage> done) override;
    void suggest(const std::string& prefix, int limit, core::Completion<std::vector<std::string>> done) override;

    [[nodiscard]] static SearchHit toDomain(const searchv1::SearchHit& hit);

private:
    std::shared_ptr<network::ConnectClient> client_;
};

} // namespace aedst::feature::search
