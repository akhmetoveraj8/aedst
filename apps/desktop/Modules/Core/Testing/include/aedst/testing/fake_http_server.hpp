#pragma once

#include <QByteArray>
#include <QCoreApplication>
#include <QEventLoop>
#include <QHash>
#include <QHostAddress>
#include <QList>
#include <QObject>
#include <QPointer>
#include <QSslConfiguration>
#include <QSslServer>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTimer>
#include <QUrl>

#include <chrono>
#include <cstddef>
#include <functional>
#include <memory>
#include <utility>
#include <vector>

/// Loopback HTTP/1.1 server for exercising network::ConnectClient end to end
/// (real QNetworkAccessManager, real sockets, no mocks of Qt) inside one
/// QCoreApplication event loop - no threads, deterministic. Test-only; it speaks
/// just enough HTTP for a POST with Content-Length and closes after each response.
///
/// Use with AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION() (test_main.hpp) and waitUntil().
namespace aedst::testing {

struct RecordedRequest {
    QByteArray method;
    QByteArray target;
    /// Header names lower-cased.
    QHash<QByteArray, QByteArray> headers;
    QByteArray body;
};

struct FakeResponse {
    int status{200};
    QByteArray contentType{"application/proto"};
    QByteArray body;
    /// If non-empty, `body` is ignored and these pieces are written 25 ms apart
    /// (Content-Length is their total), so a streaming client sees partial data.
    std::vector<QByteArray> chunks;
    /// Wait this long before answering (drives client deadline tests).
    std::chrono::milliseconds delay{0};
    /// Close the connection without any response (transport failure).
    bool dropConnection{false};
    /// Extra response headers (e.g. Location for a redirect).
    std::vector<std::pair<QByteArray, QByteArray>> headers;

    [[nodiscard]] static FakeResponse proto(QByteArray body) {
        FakeResponse response;
        response.body = std::move(body);
        return response;
    }

    /// Streaming response: `application/connect+proto`, delivered in pieces.
    [[nodiscard]] static FakeResponse connectStream(std::vector<QByteArray> chunks) {
        FakeResponse response;
        response.contentType = "application/connect+proto";
        response.chunks = std::move(chunks);
        return response;
    }

    /// Connect error: `{"code": ..., "message": ...}` with the given HTTP status.
    [[nodiscard]] static FakeResponse connectError(int status, const QByteArray& code, const QByteArray& message) {
        FakeResponse response;
        response.status = status;
        response.contentType = "application/json";
        response.body = "{\"code\":\"" + code + "\",\"message\":\"" + message + "\"}";
        return response;
    }

    /// 302 to `location` (an OAuth authorization endpoint answering the browser).
    [[nodiscard]] static FakeResponse redirect(const QByteArray& location) {
        FakeResponse response;
        response.status = 302;
        response.contentType = "text/plain";
        response.headers.emplace_back("Location", location);
        return response;
    }

    [[nodiscard]] static FakeResponse json(QByteArray body, int status = 200) {
        FakeResponse response;
        response.status = status;
        response.contentType = "application/json";
        response.body = std::move(body);
        return response;
    }

    [[nodiscard]] static FakeResponse dropped() {
        FakeResponse response;
        response.dropConnection = true;
        return response;
    }
};

class FakeHttpServer final : public QObject {
public:
    explicit FakeHttpServer(QObject* parent = nullptr) : QObject(parent), server_(std::make_unique<QTcpServer>()) {
        start();
    }

    /// HTTPS: the same server behind TLS (QSslServer) with `tls` as its server configuration (certificate + key). A
    /// client that rejects the certificate never completes the handshake, so no request is recorded;
    /// tlsHandshakeAttempts() still counts the connection, which is how a test proves "no retry".
    explicit FakeHttpServer(const QSslConfiguration& tls, QObject* parent = nullptr) : QObject(parent), tls_(true) {
        auto sslServer = std::make_unique<QSslServer>();
        sslServer->setSslConfiguration(tls);
        connect(sslServer.get(), &QSslServer::startedEncryptionHandshake, this, [this]() { ++handshakeAttempts_; });
        server_ = std::move(sslServer);
        start();
    }

    [[nodiscard]] bool isListening() const { return server_->isListening(); }

    /// Connections for which a TLS handshake was started (HTTPS mode only).
    [[nodiscard]] int tlsHandshakeAttempts() const noexcept { return handshakeAttempts_; }

    [[nodiscard]] QUrl baseUrl() const {
        QUrl url;
        url.setScheme(tls_ ? QStringLiteral("https") : QStringLiteral("http"));
        url.setHost(QStringLiteral("127.0.0.1"));
        url.setPort(server_->serverPort());
        return url;
    }

    /// Responses are consumed in order, one per request; when none is left the
    /// server answers 500 so an unexpected extra call is visible.
    void enqueue(FakeResponse response) { responses_.push_back(std::move(response)); }

    /// Answers every request with `handler` instead of the queue (routing by method/target).
    using Handler = std::function<FakeResponse(const RecordedRequest&)>;

    void setHandler(Handler handler) { handler_ = std::move(handler); }

    [[nodiscard]] const std::vector<RecordedRequest>& requests() const { return requests_; }

private:
    void start() {
        connect(server_.get(), &QTcpServer::newConnection, this, [this]() {
            while (QTcpSocket* socket = server_->nextPendingConnection()) {
                accept(socket);
            }
        });
        static_cast<void>(server_->listen(QHostAddress::LocalHost, 0)); // isListening() reports failure
    }

    void accept(QTcpSocket* socket) {
        socket->setParent(this);
        auto buffer = std::make_shared<QByteArray>();
        auto handled = std::make_shared<bool>(false);
        connect(socket, &QTcpSocket::readyRead, this, [this, socket, buffer, handled]() {
            buffer->append(socket->readAll());
            if (!*handled && tryParse(*buffer, socket)) {
                *handled = true;
            }
        });
        connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
    }

    /// Returns true once a complete request was parsed and answered.
    bool tryParse(const QByteArray& buffer, QTcpSocket* socket) {
        const qsizetype headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
            return false;
        }
        const QList<QByteArray> lines = buffer.left(headerEnd).split('\n');
        RecordedRequest request;
        const QList<QByteArray> requestLine = lines.first().trimmed().split(' ');
        if (requestLine.size() < 2) {
            return false;
        }
        request.method = requestLine.at(0);
        request.target = requestLine.at(1);
        for (qsizetype i = 1; i < lines.size(); ++i) {
            const qsizetype colon = lines.at(i).indexOf(':');
            if (colon > 0) {
                request.headers.insert(lines.at(i).left(colon).trimmed().toLower(),
                                       lines.at(i).mid(colon + 1).trimmed());
            }
        }
        const qsizetype bodyLength = request.headers.value("content-length", "0").toLongLong();
        const qsizetype bodyStart = headerEnd + 4;
        if (buffer.size() - bodyStart < bodyLength) {
            return false;
        }
        request.body = buffer.mid(bodyStart, bodyLength);
        requests_.push_back(std::move(request));

        FakeResponse response = FakeResponse::connectError(500, "internal", "FakeHttpServer: no response queued");
        if (handler_) {
            response = handler_(requests_.back());
        } else if (!responses_.empty()) {
            response = std::move(responses_.front());
            responses_.erase(responses_.begin());
        }
        respond(socket, std::move(response));
        return true;
    }

    static void respond(QTcpSocket* rawSocket, FakeResponse queued) {
        QPointer<QTcpSocket> socket(rawSocket);
        const auto delay = queued.delay;
        QTimer::singleShot(delay, rawSocket, [socket, response = std::move(queued)]() {
            if (!socket) {
                return;
            }
            if (response.dropConnection) {
                socket->abort();
                return;
            }
            QByteArray payload = response.body;
            if (!response.chunks.empty()) {
                payload.clear();
                for (const QByteArray& chunk : response.chunks) {
                    payload.append(chunk);
                }
            }
            QByteArray head = "HTTP/1.1 " + QByteArray::number(response.status) + " Status\r\n";
            head += "Content-Type: " + response.contentType + "\r\n";
            for (const auto& header : response.headers) {
                head += header.first + ": " + header.second + "\r\n";
            }
            head += "Content-Length: " + QByteArray::number(payload.size()) + "\r\n";
            head += "Connection: close\r\n\r\n";
            socket->write(head);
            socket->flush();

            if (response.chunks.empty()) {
                socket->write(payload);
                socket->disconnectFromHost();
                return;
            }
            const std::size_t count = response.chunks.size();
            for (std::size_t i = 0; i < count; ++i) {
                QTimer::singleShot(std::chrono::milliseconds{25 * static_cast<int>(i)}, socket.data(),
                                   [socket, chunk = response.chunks[i], last = (i + 1 == count)]() {
                                       if (!socket) {
                                           return;
                                       }
                                       socket->write(chunk);
                                       socket->flush();
                                       if (last) {
                                           socket->disconnectFromHost();
                                       }
                                   });
            }
        });
    }

    std::unique_ptr<QTcpServer> server_;
    bool tls_{false};
    int handshakeAttempts_{0};
    std::vector<FakeResponse> responses_;
    std::vector<RecordedRequest> requests_;
    Handler handler_;
};

/// Spins the event loop until `done()` is true or `timeout` passes; returns done().
inline bool waitUntil(const std::function<bool()>& done, std::chrono::milliseconds timeout = std::chrono::seconds{5}) {
    if (done()) {
        return true;
    }
    QEventLoop loop;
    QTimer poll;
    QObject::connect(&poll, &QTimer::timeout, &loop, [&]() {
        if (done()) {
            loop.quit();
        }
    });
    poll.start(5);
    QTimer::singleShot(timeout, &loop, &QEventLoop::quit);
    loop.exec();
    return done();
}

} // namespace aedst::testing
