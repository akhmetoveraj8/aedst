#include "Presentation/media_library_view_model.hpp"
#include "Presentation/media_viewer_view_model.hpp"
#include "aedst/analytics/no_op_analytics_tracker.hpp"
#include "aedst/core/error_sink.hpp"
#include "aedst/media/media_remote_data_source.hpp"

#include <QNetworkAccessManager>
#include <QSignalSpy>
#include <QTest>

#include <expected>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

using namespace aedst::feature::media;
namespace network = aedst::network;
namespace core = aedst::core;
namespace mediav1 = aedst::media::v1;

namespace {

mediav1::Media mediaItem(const std::string& id, mediav1::MediaStatus status = mediav1::MEDIA_STATUS_READY) {
    mediav1::Media media;
    media.set_id(id);
    media.set_kind(mediav1::MEDIA_KIND_IMAGE);
    media.set_status(status);
    media.set_filename(id + ".png");
    return media;
}

/// Scripted data source. A completion is held (`hold`) so a test can answer out of order.
class FakeRemote final : public aedst::media::MediaRemoteDataSource {
public:
    void createUpload(const mediav1::CreateUploadRequest&,
                      network::ApiCompletion<mediav1::CreateUploadResponse> done) override {
        done(std::unexpected(network::ApiError{.kind = network::ApiErrorKind::Internal, .message = "not used"}));
    }

    void completeUpload(const mediav1::CompleteUploadRequest&,
                        network::ApiCompletion<mediav1::CompleteUploadResponse> done) override {
        done(std::unexpected(network::ApiError{.kind = network::ApiErrorKind::Internal, .message = "not used"}));
    }

    void getMedia(const mediav1::GetMediaRequest& request,
                  network::ApiCompletion<mediav1::GetMediaResponse> done) override {
        requestedIds.push_back(request.id());
        if (hold) {
            held.push_back(std::move(done));
            return;
        }
        if (failWith) {
            done(std::unexpected(*failWith));
            return;
        }
        mediav1::GetMediaResponse response;
        *response.mutable_media() = nextMedia;
        done(std::move(response));
    }

    void listMedia(const mediav1::ListMediaRequest& request,
                   network::ApiCompletion<mediav1::ListMediaResponse> done) override {
        listRequests.push_back(request);
        if (failWith) {
            done(std::unexpected(*failWith));
            return;
        }
        mediav1::ListMediaResponse response;
        for (const auto& item : listed) {
            *response.add_media() = item;
        }
        done(std::move(response));
    }

    void deleteMedia(const mediav1::DeleteMediaRequest& request, network::ApiCompletion<void> done) override {
        deletedIds.push_back(request.id());
        done({});
    }

    bool hold{false};
    std::optional<network::ApiError> failWith;
    mediav1::Media nextMedia = mediaItem("m-1");
    std::vector<mediav1::Media> listed;
    std::vector<std::string> requestedIds;
    std::vector<std::string> deletedIds;
    std::vector<mediav1::ListMediaRequest> listRequests;
    std::vector<network::ApiCompletion<mediav1::GetMediaResponse>> held;
};

} // namespace

class MediaViewModelsTest : public QObject {
    Q_OBJECT

private slots:

    void init() {
        remote_ = std::make_shared<FakeRemote>();
        errors_ = std::make_shared<core::NullErrorSink>();
    }

    void viewerLoadsTheRequestedItem() {
        MediaViewerViewModel viewModel(remote_, errors_);
        QSignalSpy changed(&viewModel, &MediaViewerViewModel::mediaChanged);

        viewModel.load(QStringLiteral("m-1"));

        QVERIFY(viewModel.hasMedia());
        QCOMPARE(viewModel.fileName(), QStringLiteral("m-1.png"));
        QCOMPARE(viewModel.kind(), QStringLiteral("image"));
        QVERIFY(!viewModel.isLoading());
        QVERIFY(changed.count() >= 1);
    }

    void viewerShowsAFailureWithoutMedia() {
        remote_->failWith =
            network::ApiError{.kind = network::ApiErrorKind::NotFound, .httpStatus = 404, .message = "gone"};
        MediaViewerViewModel viewModel(remote_, errors_);

        viewModel.load(QStringLiteral("m-9"));

        QVERIFY(!viewModel.hasMedia());
        QCOMPARE(viewModel.errorMessage(), QStringLiteral("gone"));
    }

    void viewerKeepsPollingWhileTheItemIsProcessing() {
        remote_->nextMedia = mediaItem("m-1", mediav1::MEDIA_STATUS_PROCESSING);
        MediaViewerViewModel viewModel(remote_, errors_);

        viewModel.load(QStringLiteral("m-1"));

        QCOMPARE(remote_->requestedIds.size(), std::size_t{1});
        QTRY_VERIFY_WITH_TIMEOUT(remote_->requestedIds.size() >= 2, 6000); // kPollMs = 3 s
        viewModel.clear();
    }

    void aResponseThatArrivesAfterClearIsIgnored() {
        remote_->hold = true;
        MediaViewerViewModel viewModel(remote_, errors_);
        viewModel.load(QStringLiteral("m-1"));
        QCOMPARE(remote_->held.size(), std::size_t{1});

        viewModel.clear(); // signed out / left the screen while the request was in flight
        mediav1::GetMediaResponse response;
        *response.mutable_media() = mediaItem("m-1");
        remote_->held.front()(std::move(response));

        QVERIFY(!viewModel.hasMedia()) << "a stale answer must not resurrect the cleared state";
    }

    void libraryReloadFillsTheGridAndSendsTheKindFilter() {
        remote_->listed = {mediaItem("a"), mediaItem("b")};
        QNetworkAccessManager network;
        MediaLibraryViewModel::Dependencies deps;
        deps.remote = remote_;
        deps.errors = errors_;
        deps.analytics = std::make_shared<aedst::analytics::NoOpAnalyticsTracker>();
        deps.upload = aedst::media::MediaUploadController::Dependencies{
            .remote = remote_, .network = &network, .errors = errors_};
        MediaLibraryViewModel viewModel(std::move(deps));

        viewModel.reload();
        QCOMPARE(viewModel.items()->count(), 2);
        QVERIFY(remote_->listRequests.back().kinds().empty());

        viewModel.setKindFilter(QStringLiteral("video"));
        QCOMPARE(remote_->listRequests.back().kinds_size(), 1);
        QCOMPARE(remote_->listRequests.back().kinds(0), mediav1::MEDIA_KIND_VIDEO);
    }

    void libraryRemoveDeletesOnTheServerAndInTheGrid() {
        remote_->listed = {mediaItem("a"), mediaItem("b")};
        QNetworkAccessManager network;
        MediaLibraryViewModel::Dependencies deps;
        deps.remote = remote_;
        deps.errors = errors_;
        deps.upload = aedst::media::MediaUploadController::Dependencies{
            .remote = remote_, .network = &network, .errors = errors_};
        MediaLibraryViewModel viewModel(std::move(deps));
        viewModel.reload();

        viewModel.remove(QStringLiteral("a"));

        QCOMPARE(remote_->deletedIds, std::vector<std::string>{"a"});
        QCOMPARE(viewModel.items()->count(), 1);
    }

    void libraryClearEmptiesTheGrid() {
        remote_->listed = {mediaItem("a")};
        QNetworkAccessManager network;
        MediaLibraryViewModel::Dependencies deps;
        deps.remote = remote_;
        deps.errors = errors_;
        deps.upload = aedst::media::MediaUploadController::Dependencies{
            .remote = remote_, .network = &network, .errors = errors_};
        MediaLibraryViewModel viewModel(std::move(deps));
        viewModel.reload();
        QCOMPARE(viewModel.items()->count(), 1);

        viewModel.clear();

        QCOMPARE(viewModel.items()->count(), 0);
        QVERIFY(!viewModel.isLoading());
    }

private:
    std::shared_ptr<FakeRemote> remote_;
    std::shared_ptr<core::ErrorSink> errors_;
};

QTEST_MAIN(MediaViewModelsTest)
#include "media_view_models_test.moc"
