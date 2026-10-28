#include "aedst/media/media_image_provider.hpp"
#include "aedst/testing/fake_http_server.hpp"
#include "aedst/testing/test_main.hpp"

#include <QTemporaryDir>

#include <gtest/gtest.h>

#include <chrono>

namespace aedst::media {
namespace {

using namespace std::chrono_literals;
using aedst::testing::FakeHttpServer;
using aedst::testing::FakeResponse;
using aedst::testing::waitUntil;

class MediaImageFetcherTest : public ::testing::Test {
protected:
    MediaImageFetcherTest() : fetcher(cacheDir.path(), 1024 * 1024) {}

    QTemporaryDir cacheDir;
    FakeHttpServer server;
    MediaImageFetcher fetcher;
};

TEST_F(MediaImageFetcherTest, ADownloadDeliversTheBytesOnce) {
    ASSERT_TRUE(server.isListening());
    FakeResponse response = FakeResponse::proto("image-bytes");
    response.contentType = "image/png";
    server.enqueue(response);

    int calls = 0;
    QByteArray received;
    QString error;
    fetcher.fetch(server.baseUrl(), [&](QByteArray bytes, QString err) {
        ++calls;
        received = std::move(bytes);
        error = std::move(err);
    });

    ASSERT_TRUE(waitUntil([&] { return calls > 0; }, 5s));
    EXPECT_EQ(received, QByteArray("image-bytes"));
    EXPECT_TRUE(error.isEmpty());
    EXPECT_EQ(calls, 1);
}

TEST_F(MediaImageFetcherTest, ARequestCancelledBeforeItStartsNeverReachesTheNetwork) {
    ASSERT_TRUE(server.isListening());
    int calls = 0;
    QString error;
    const auto ticket = fetcher.fetch(server.baseUrl(), [&](QByteArray, QString err) {
        ++calls;
        error = std::move(err);
    });
    fetcher.cancel(ticket); // before the queued start runs

    ASSERT_TRUE(waitUntil([&] { return calls > 0; }, 5s));
    EXPECT_FALSE(error.isEmpty());
    waitUntil([] { return false; }, 150ms);
    EXPECT_TRUE(server.requests().empty());
    EXPECT_EQ(calls, 1);
}

TEST_F(MediaImageFetcherTest, CancellingARunningDownloadEndsItPromptlyWithAnError) {
    ASSERT_TRUE(server.isListening());
    FakeResponse slow = FakeResponse::proto("late");
    slow.delay = 10s;
    server.enqueue(slow);

    int calls = 0;
    QString error;
    const auto ticket = fetcher.fetch(server.baseUrl(), [&](QByteArray, QString err) {
        ++calls;
        error = std::move(err);
    });
    ASSERT_TRUE(waitUntil([&] { return !server.requests().empty(); }, 5s));

    const auto started = std::chrono::steady_clock::now();
    fetcher.cancel(ticket);
    ASSERT_TRUE(waitUntil([&] { return calls > 0; }, 5s));
    EXPECT_LT(std::chrono::steady_clock::now() - started, 3s);
    EXPECT_FALSE(error.isEmpty());
    EXPECT_EQ(calls, 1);
}

} // namespace
} // namespace aedst::media

AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION()
