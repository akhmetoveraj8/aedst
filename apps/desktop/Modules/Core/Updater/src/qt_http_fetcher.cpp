#include "aedst/updater/qt_http_fetcher.hpp"

#include <QByteArray>
#include <QEventLoop>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>
#include <QUrl>

#include <memory>
#include <string>

namespace aedst::updater {

namespace {

/// One QNetworkAccessManager per calling thread, reused by every fetch on that thread (keep-alive, DNS and TLS session
/// reuse). A QNetworkAccessManager is thread-affine, so it is never shared across threads, and a thread_local is
/// destroyed on the thread that created it. UpdateService runs all its work on ONE never-expiring pool thread, so in
/// the app exactly one QNetworkAccessManager exists for the updater.
QNetworkAccessManager& networkForThisThread() {
    thread_local QNetworkAccessManager network;
    return network;
}

} // namespace

core::Outcome<std::string> QtHttpFetcher::fetch(std::string_view url, std::size_t maxBytes) {
    const QUrl target(QString::fromUtf8(url.data(), static_cast<qsizetype>(url.size())), QUrl::StrictMode);
    if (!target.isValid() || target.scheme() != QLatin1String("https") || target.host().isEmpty() ||
        !target.userInfo().isEmpty()) {
        return core::fail(core::Error::invalidInput("update: only plain https URLs can be fetched"));
    }

    QNetworkAccessManager& network = networkForThisThread();
    QNetworkRequest request(target);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    request.setRawHeader("Accept", "application/json");
    request.setHeader(QNetworkRequest::UserAgentHeader, QByteArrayLiteral("AEDST-Desktop-Updater"));

    QNetworkReply* reply = network.get(request);
    QEventLoop loop;
    bool tooLarge = false;
    bool timedOut = false;
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(reply, &QNetworkReply::downloadProgress, &loop, [&](qint64 received, qint64) {
        if (received > static_cast<qint64>(maxBytes)) {
            tooLarge = true;
            reply->abort();
        }
    });
    QTimer deadline;
    deadline.setSingleShot(true);
    QObject::connect(&deadline, &QTimer::timeout, &loop, [&]() {
        timedOut = true;
        reply->abort();
    });
    deadline.start(static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(timeout_).count()));
    loop.exec();

    const std::unique_ptr<QNetworkReply, void (*)(QNetworkReply*)> owned(reply,
                                                                         [](QNetworkReply* r) { r->deleteLater(); });
    if (tooLarge) {
        return core::fail(core::Error::invalidInput("update: response larger than allowed"));
    }
    if (timedOut) {
        return core::fail(core::Error::unavailable("update: the server did not answer in time"));
    }
    if (reply->error() != QNetworkReply::NoError) {
        return core::fail(core::Error::unavailable("update: " + reply->errorString().toStdString()));
    }
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (status != 200) {
        return core::fail(core::Error::unavailable("update: HTTP " + std::to_string(status)));
    }
    const QByteArray body = reply->readAll();
    if (static_cast<std::size_t>(body.size()) > maxBytes) {
        return core::fail(core::Error::invalidInput("update: response larger than allowed"));
    }
    return std::string(body.constData(), static_cast<std::size_t>(body.size()));
}

} // namespace aedst::updater
