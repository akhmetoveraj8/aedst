#pragma once

#include "aedst/network/api_error.hpp"

#include <aedst/media/v1/media.pb.h>
#include <memory>

namespace aedst::network {
class ConnectClient;
} // namespace aedst::network

namespace aedst::media {

namespace mediav1 = ::aedst::media::v1;

/// aedst.media.v1.MediaService as the client uses it. Shared Core data source:
/// Features/Media (library), Features/Tasks (attachments) and the upload
/// controller all go through it, so no feature links another feature.
class MediaRemoteDataSource {
public:
    MediaRemoteDataSource() = default;
    MediaRemoteDataSource(const MediaRemoteDataSource&) = delete;
    MediaRemoteDataSource& operator=(const MediaRemoteDataSource&) = delete;
    MediaRemoteDataSource(MediaRemoteDataSource&&) = delete;
    MediaRemoteDataSource& operator=(MediaRemoteDataSource&&) = delete;
    virtual ~MediaRemoteDataSource() = default;

    virtual void createUpload(const mediav1::CreateUploadRequest& request,
                              network::ApiCompletion<mediav1::CreateUploadResponse> done) = 0;
    virtual void completeUpload(const mediav1::CompleteUploadRequest& request,
                                network::ApiCompletion<mediav1::CompleteUploadResponse> done) = 0;
    virtual void getMedia(const mediav1::GetMediaRequest& request,
                          network::ApiCompletion<mediav1::GetMediaResponse> done) = 0;
    virtual void listMedia(const mediav1::ListMediaRequest& request,
                           network::ApiCompletion<mediav1::ListMediaResponse> done) = 0;
    virtual void deleteMedia(const mediav1::DeleteMediaRequest& request, network::ApiCompletion<void> done) = 0;
};

/// MediaRemoteDataSource over ConnectClient + the method table in Aedst::Contract.
class ConnectMediaRemoteDataSource final : public MediaRemoteDataSource {
public:
    explicit ConnectMediaRemoteDataSource(std::shared_ptr<network::ConnectClient> client);

    void createUpload(const mediav1::CreateUploadRequest& request,
                      network::ApiCompletion<mediav1::CreateUploadResponse> done) override;
    void completeUpload(const mediav1::CompleteUploadRequest& request,
                        network::ApiCompletion<mediav1::CompleteUploadResponse> done) override;
    void getMedia(const mediav1::GetMediaRequest& request,
                  network::ApiCompletion<mediav1::GetMediaResponse> done) override;
    void listMedia(const mediav1::ListMediaRequest& request,
                   network::ApiCompletion<mediav1::ListMediaResponse> done) override;
    void deleteMedia(const mediav1::DeleteMediaRequest& request, network::ApiCompletion<void> done) override;

private:
    std::shared_ptr<network::ConnectClient> client_;
};

} // namespace aedst::media
