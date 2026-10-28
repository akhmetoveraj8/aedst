// Request/response helpers, completion plumbing and CallHandle/CallScope for ConnectClient.
// Split out of connect_client.cpp without behaviour change.

#include "aedst/core/correlation.hpp"
#include "aedst/logging/log_categories.hpp"
#include "aedst/network/client_identification.hpp"
#include "aedst/network/connect_error.hpp"
#include "connect_client_internal.hpp"

#include <QString>
#include <QTimer>

#include <algorithm>
#include <limits>

namespace aedst::network {

namespace detail {

std::optional<QByteArray> serialize(const google::protobuf::MessageLite& message) {
    const std::size_t size = message.ByteSizeLong();
    if (size > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return std::nullopt;
    }
    QByteArray bytes(static_cast<qsizetype>(size), Qt::Uninitialized);
    if (size > 0 && !message.SerializeToArray(bytes.data(), static_cast<int>(size))) {
        return std::nullopt;
    }
    return bytes;
}

} // namespace detail

namespace internal {

ApiError cancelledError() {
    return {.kind = ApiErrorKind::Cancelled, .httpStatus = 0, .message = "Call cancelled"};
}

/// Server-controlled or Qt-produced text, made safe for one log line: bounded,
/// no control characters (no forged records). Secrets are masked by the logger.
std::string loggable(std::string_view text) {
    constexpr std::size_t kMaxLoggedChars = 256;
    std::string out(text.substr(0, kMaxLoggedChars));
    for (char& c : out) {
        if (static_cast<unsigned char>(c) < 0x20 || c == 0x7F) {
            c = ' ';
        }
    }
    if (text.size() > kMaxLoggedChars) {
        out += "...";
    }
    return out;
}

/// One id per call: the caller's active CorrelationScope if it has one (so a use
/// case can tie several calls together), otherwise a fresh random id.
std::string callCorrelationId() {
    const std::string_view active = core::currentCorrelationId();
    if (core::isValidCorrelationId(active)) {
        return std::string(active);
    }
    return core::newCorrelationId();
}

std::unexpected<ApiError> invalidConfig(std::string message) {
    return std::unexpected(
        ApiError{.kind = ApiErrorKind::InvalidArgument, .httpStatus = 0, .message = std::move(message)});
}

void hardenRequest(QNetworkRequest& request, const QSslConfiguration& ssl, const std::string& correlationId,
                   const std::string& clientIdentifier) {
    request.setSslConfiguration(ssl);
    request.setRawHeader("X-Correlation-Id", QByteArray::fromStdString(correlationId));
    if (!clientIdentifier.empty()) {
        request.setRawHeader(QByteArray(kClientHeaderName.data(), static_cast<qsizetype>(kClientHeaderName.size())),
                             QByteArray::fromStdString(clientIdentifier));
    }
}

QUrl endpointUrl(const QUrl& base, std::string_view path) {
    QUrl url = base;
    QString basePath = base.path();
    while (basePath.endsWith(QLatin1Char('/'))) {
        basePath.chop(1);
    }
    url.setPath(basePath + QString::fromUtf8(path.data(), static_cast<qsizetype>(path.size())));
    return url;
}

/// Total deadline for one attempt. QNetworkRequest::setTransferTimeout is an
/// inactivity timer, which would let a slow-drip response outlive its deadline.
void armDeadline(QNetworkReply* reply, std::chrono::milliseconds timeout) {
    if (timeout.count() <= 0) {
        return;
    }
    auto* timer = new QTimer(reply); // child of the reply: dies with it
    timer->setSingleShot(true);
    QObject::connect(timer, &QTimer::timeout, reply, [reply]() {
        reply->setProperty(kTimedOutProperty, true);
        reply->abort();
    });
    timer->start(timeout);
}

bool hasContentType(const QNetworkReply& reply, const char* expected) {
    return reply.header(QNetworkRequest::ContentTypeHeader)
        .toString()
        .startsWith(QLatin1String(expected), Qt::CaseInsensitive);
}

/// Failures with no usable HTTP response, or an aborted transfer; nullopt when
/// the reply carries a real HTTP status to interpret.
std::optional<ApiError> transportError(const QNetworkReply& reply, int status) {
    const QNetworkReply::NetworkError netError = reply.error();
    // Before everything else: a pin violation aborts the reply, which Qt reports as
    // "operation canceled", and it must win over a body that happened to arrive.
    if (reply.property(kPinFailedProperty).toBool()) {
        return pinError();
    }
    if (reply.property(kTooLargeProperty).toBool()) {
        return ApiError{.kind = ApiErrorKind::Decoding, .httpStatus = status, .message = "Response body is too large"};
    }
    if (reply.property(kTimedOutProperty).toBool() || netError == QNetworkReply::TimeoutError) {
        return ApiError{.kind = ApiErrorKind::Timeout, .httpStatus = status, .message = "Request timed out"};
    }
    if (netError == QNetworkReply::OperationCanceledError) {
        return cancelledError();
    }
    if (netError == QNetworkReply::SslHandshakeFailedError) {
        // sslErrors() is never answered with ignoreSslErrors(), so an untrusted,
        // expired or mismatched certificate ends up here (details are logged).
        return ApiError{.kind = ApiErrorKind::Transport,
                        .httpStatus = 0,
                        .message = "TLS certificate validation failed: " + reply.errorString().toStdString()};
    }
    if (status == 0) {
        return ApiError{.kind = ApiErrorKind::Transport, .httpStatus = 0, .message = reply.errorString().toStdString()};
    }
    return std::nullopt;
}

RawResult parseUnaryReply(QNetworkReply& reply) {
    const int status = reply.attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (auto failure = transportError(reply, status)) {
        return std::unexpected(std::move(*failure));
    }

    const QByteArray payload = reply.readAll();
    if (status != 200) {
        return std::unexpected(errorFromUnaryResponse(status, payload, reply.errorString().toStdString()));
    }
    // A 200 that is not Protobuf is a captive portal / misrouted proxy, not our server.
    if (!hasContentType(reply, "application/proto")) {
        return std::unexpected(
            ApiError{.kind = ApiErrorKind::Decoding,
                     .httpStatus = status,
                     .message = "Unexpected response content-type: " +
                                reply.header(QNetworkRequest::ContentTypeHeader).toString().toStdString()});
    }
    if (reply.error() != QNetworkReply::NoError) {
        // Headers arrived but the body was cut off.
        return std::unexpected(ApiError{
            .kind = ApiErrorKind::Transport, .httpStatus = status, .message = reply.errorString().toStdString()});
    }
    return payload;
}

/// A Public method's request body carries the credential itself (login password, refresh token): overwrite it once the
/// call is over. Best effort - the bytes were implicitly shared with Qt's request, which is finished by now, so the
/// wipe is done in place on the shared buffer; the caller's own message object is the caller's to clear.
void wipeCredentialBody(AuthRequirement auth, QByteArray& body) {
    if (auth != AuthRequirement::Public || body.isEmpty()) {
        return;
    }
    core::secureWipe(const_cast<char*>(body.constData()), static_cast<std::size_t>(body.size()));
    body.clear();
}

void completeUnary(const std::shared_ptr<detail::CallState>& state, detail::UnaryCall& call, RawResult result) {
    if (state->finished) {
        return;
    }
    state->finished = true;
    state->fail = nullptr;
    wipeCredentialBody(call.auth, call.body);
    if (state->silent) {
        return;
    }
    invokeGuarded("call completion", [&] { call.done(std::move(result)); });
}

void completeStream(const std::shared_ptr<detail::CallState>& state, detail::StreamCall& stream,
                    ApiResult<void> result) {
    if (state->finished) {
        return;
    }
    state->finished = true;
    state->fail = nullptr;
    wipeCredentialBody(stream.auth, stream.body);
    if (state->silent) {
        return;
    }
    invokeGuarded("stream completion", [&] { stream.onDone(std::move(result)); });
}

/// Feeds bytes to the stream's reader and dispatches every complete frame.
/// Completes the call (and aborts the reply) on the end-of-stream frame or on
/// any protocol violation.
void consumeStreamBytes(const std::shared_ptr<detail::CallState>& state, detail::StreamCall& stream,
                        QNetworkReply& reply, const QByteArray& bytes) {
    stream.reader.feed(bytes);
    while (!state->finished) {
        auto frame = stream.reader.next();
        if (!frame) {
            completeStream(
                state, stream,
                std::unexpected(ApiError{.kind = ApiErrorKind::Decoding, .httpStatus = 200, .message = frame.error()}));
            reply.abort();
            return;
        }
        if (!*frame) {
            return; // need more bytes
        }
        if ((*frame)->isCompressed()) {
            completeStream(state, stream,
                           std::unexpected(ApiError{.kind = ApiErrorKind::Decoding,
                                                    .httpStatus = 200,
                                                    .message = "Compressed stream messages are not supported"}));
            reply.abort();
            return;
        }
        if ((*frame)->isEndStream()) {
            completeStream(state, stream, parseEndStream((*frame)->payload));
            return;
        }
        std::expected<void, ApiError> handled;
        invokeGuarded("stream message handler", [&] { handled = stream.onMessage(std::move((*frame)->payload)); });
        if (!handled) {
            completeStream(state, stream, std::unexpected(std::move(handled.error())));
            reply.abort();
            return;
        }
    }
}

} // namespace internal

using namespace internal;

// --- CallHandle ---------------------------------------------------------------

void CallHandle::cancel() const {
    if (!state_ || state_->finished || state_->cancelled) {
        return;
    }
    state_->cancelled = true;
    if (state_->reply) {
        state_->reply->abort(); // finished() fires synchronously and completes with Cancelled
        return;
    }
    if (state_->fail) {
        state_->fail(cancelledError());
    }
}

void CallHandle::cancelSilently() const {
    if (!state_ || state_->finished || state_->cancelled) {
        return;
    }
    state_->silent = true;
    cancel();
}

bool CallHandle::isActive() const noexcept {
    return state_ && !state_->finished;
}

// --- CallScope ----------------------------------------------------------------------------

void CallScope::add(CallHandle handle) {
    std::erase_if(handles_, [](const CallHandle& existing) { return !existing.isActive(); });
    if (handle.isActive()) {
        handles_.push_back(std::move(handle));
    }
}

void CallScope::cancelAll() {
    const auto pending = std::exchange(handles_, {});
    for (const CallHandle& handle : pending) {
        handle.cancelSilently();
    }
}

std::size_t CallScope::activeCount() const {
    return static_cast<std::size_t>(std::ranges::count_if(handles_, &CallHandle::isActive));
}

} // namespace aedst::network
