#pragma once

#include "aedst/network/api_error.hpp"
#include "aedst/network/call_options.hpp"
#include "aedst/network/method.hpp"
#include "aedst/network/transport_policy.hpp"

#include <QByteArray>
#include <QList>
#include <QMetaObject>
#include <QNetworkAccessManager>
#include <QObject>
#include <QSslConfiguration>
#include <QUrl>

#include <chrono>
#include <cstddef>
#include <expected>
#include <functional>
#include <google/protobuf/message_lite.h>
#include <memory>
#include <optional>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

class QNetworkReply;

namespace aedst::network {

class AuthInterceptor;

namespace detail {
struct CallState;
struct UnaryCall;
struct StreamCall;
} // namespace detail

using RawResult = ApiResult<QByteArray>;
using RawCompletion = std::function<void(RawResult)>;
/// Receives one server-streamed message. Returning an error aborts the stream
/// and completes it with that error (e.g. the payload did not parse).
using RawMessageHandler = std::function<std::expected<void, ApiError>(QByteArray)>;

/// Cancels an in-flight call. Cheap to copy; safe to keep after the call
/// finished (then it does nothing). Call from the thread that owns the client.
class CallHandle final {
public:
    CallHandle() = default;

    /// The completion runs once, with ApiErrorKind::Cancelled, if the call was
    /// still in flight.
    void cancel() const;

    /// Cancels without running the completion at all. For owners that are going away: the
    /// completion would otherwise run while the owner is half destroyed.
    void cancelSilently() const;

    [[nodiscard]] bool isActive() const noexcept;

private:
    friend class ConnectClient;

    explicit CallHandle(std::shared_ptr<detail::CallState> state) noexcept : state_(std::move(state)) {}

    std::shared_ptr<detail::CallState> state_;
};

/// Cancels every call it holds when it is destroyed - put one in a QObject that starts calls and
/// the requests die with their caller. Cancellation is silent (no completion runs), so it is safe
/// to do from a destructor. Finished calls are forgotten on the next add().
class CallScope final {
public:
    CallScope() = default;
    CallScope(const CallScope&) = delete;
    CallScope& operator=(const CallScope&) = delete;
    CallScope(CallScope&&) = delete;
    CallScope& operator=(CallScope&&) = delete;

    ~CallScope() { cancelAll(); }

    void add(CallHandle handle);
    void cancelAll();
    [[nodiscard]] std::size_t activeCount() const;

private:
    std::vector<CallHandle> handles_;
};

struct ClientConfig {
    QUrl baseUrl;
    /// Per-attempt deadline unless CallOptions::timeout overrides it.
    std::chrono::milliseconds defaultTimeout{std::chrono::seconds{15}};
    RetryPolicy retry{};

    /// Permit plain http to a loopback host (see validateEndpoint). Defaults to
    /// insecureLoopbackAllowedByDefault(): Debug builds, or the runtime opt-in
    /// AEDST_ALLOW_INSECURE_LOCALHOST=1. Non-loopback http is never permitted.
    bool allowInsecureLoopback{insecureLoopbackAllowedByDefault()};

    /// Additional trusted CA certificates, PEM (one or more concatenated), added
    /// to the system store - for a corporate TLS-inspecting CA or a test CA. It
    /// extends trust; it never disables verification. Empty = system store only.
    QByteArray extraCaCertificatesPem{};

    /// Optional SPKI pinning: base64 of the SHA-256 of a certificate's
    /// SubjectPublicKeyInfo DER (the HPKP / `openssl ... | base64` format). When
    /// non-empty, a TLS connection is accepted only if at least one certificate in
    /// the peer's chain (leaf or intermediate/root as presented) matches. Pin at
    /// least one backup key. Empty = pinning disabled. Malformed entries make the
    /// whole config invalid (fail closed).
    std::vector<std::string> pinnedSpkiSha256{};

    /// Value of the `X-Aedst-Client` header sent with every request, `desktop/<semver>` (see
    /// makeClientIdentifier). Empty = no header.
    std::string clientIdentifier{};

    /// Upper bound for the body of a UNARY response. A reply that has delivered (or announces) more than this is
    /// aborted at once instead of being buffered into memory, and the call fails with ApiErrorKind::Decoding.
    /// Server-streaming calls are not bounded by it (they are unbounded by design; each frame is bounded by the
    /// envelope reader). 0 disables the limit.
    std::size_t maxResponseBytes{16U * 1024U * 1024U};
};

/// Checks everything the client will enforce at construction: the endpoint policy
/// (validateEndpoint), the extra CA PEM, the pin format and TLS availability.
/// Call it at startup to fail fast with a readable error instead of discovering
/// the problem on the first request; ConnectClient runs the same check itself.
[[nodiscard]] ApiResult<void> validateClientConfig(const ClientConfig& config);

/// Connect-protocol client over Qt Network with Protobuf messages.
///
/// Implements the subset of https://connectrpc.com/docs/protocol the app needs:
///  - unary RPCs: `POST <base>/<package.Service>/<Method>`, `application/proto`,
///    `Connect-Protocol-Version: 1`, `Connect-Timeout-Ms`, Connect error model;
///  - server-streaming RPCs: `application/connect+proto` envelope framing.
/// Not implemented (no server RPC needs them, and QNetworkAccessManager cannot do
/// full-duplex HTTP): client/bidi streaming, GET requests for side-effect-free
/// methods, per-message compression (HTTP-level gzip/deflate is negotiated and
/// decoded transparently by Qt).
///
/// TLS, HTTP/2 (ALPN), proxies and the OS certificate store are Qt Network's
/// job - nothing here reimplements them. What this class adds is policy: the
/// endpoint must pass validateEndpoint (https; http only to loopback in dev), every
/// request carries a QSslConfiguration with TLS >= 1.2 and VerifyPeer, certificate
/// errors are never ignored (the call fails with ApiErrorKind::Transport), and
/// optional SPKI pins are enforced. If the config is invalid the client is in a
/// failed state: every call completes asynchronously with that error and nothing
/// is sent. Each call carries an `X-Correlation-Id` header (16 hex chars, or the
/// caller's active CorrelationScope id) that also tags this class's log lines.
/// Everything runs on the owner thread's
/// event loop; completions are always delivered asynchronously, exactly once.
/// See docs/adr/0001-api-contract-client.md for why this is not gRPC C++.
class ConnectClient final : public QObject {
    Q_OBJECT

public:
    ConnectClient(ClientConfig config, std::shared_ptr<const AuthInterceptor> interceptor, QObject* parent = nullptr);
    /// Every call still in flight completes with ApiErrorKind::Cancelled before the client goes away (calls bound to a
    /// context or a CallScope were already cancelled silently and are not completed).
    ~ConnectClient() override;
    ConnectClient(const ConnectClient&) = delete;
    ConnectClient& operator=(const ConnectClient&) = delete;
    ConnectClient(ConnectClient&&) = delete;
    ConnectClient& operator=(ConnectClient&&) = delete;

    /// Typed unary call. Retried per the RetryPolicy only when `method` is Idempotent.
    template <typename Req, typename Res>
    CallHandle unary(const Method<Req, Res>& method, const Req& request, std::type_identity_t<ApiCompletion<Res>> done,
                     const CallOptions& options = {});

    /// Typed server-streaming call: `onMessage` per message, then `onDone` once
    /// (success = the server sent a clean end-of-stream). Never retried.
    template <typename Req, typename Res>
    CallHandle serverStream(const Method<Req, Res>& method, const Req& request,
                            std::type_identity_t<std::function<void(Res)>> onMessage,
                            std::type_identity_t<ApiCompletion<void>> onDone, const CallOptions& options = {});

    /// Same, bound to the lifetime of `context` (typically the QObject that issued the call): when
    /// the context is destroyed the call is cancelled silently and `done` never runs, so a closed
    /// window or a deleted view model cannot be called back. `done` runs on the context thread.
    template <typename Req, typename Res>
    CallHandle unary(const Method<Req, Res>& method, const Req& request, const QObject* context,
                     std::type_identity_t<ApiCompletion<Res>> done, const CallOptions& options = {});

    template <typename Req, typename Res>
    CallHandle serverStream(const Method<Req, Res>& method, const Req& request, const QObject* context,
                            std::type_identity_t<std::function<void(Res)>> onMessage,
                            std::type_identity_t<ApiCompletion<void>> onDone, const CallOptions& options = {});

    /// Untyped layer the templates sit on (already-serialized Protobuf bytes).
    CallHandle unaryRaw(const MethodInfo& method, QByteArray body, const CallOptions& options, RawCompletion done);
    CallHandle serverStreamRaw(const MethodInfo& method, QByteArray body, const CallOptions& options,
                               RawMessageHandler onMessage, ApiCompletion<void> onDone);

    /// Completes `done` with `error` on the next event-loop turn.
    CallHandle failAsync(ApiError error, RawCompletion done);

    /// Opens the TCP (+TLS, +HTTP/2 negotiation) connection ahead of the first call,
    /// so the login request does not pay the handshake. Best-effort, no callback.
    void prewarm();

    [[nodiscard]] const QUrl& baseUrl() const noexcept;

    /// The reason the client refuses to send anything, if the config was rejected.
    [[nodiscard]] const std::optional<ApiError>& configError() const noexcept { return configError_; }

signals:
    /// A unary call was refused by the server's client-version gate (failed_precondition +
    /// CLIENT_UPGRADE_REQUIRED). Emitted for every such answer, before the call's own completion; the app
    /// routes to its blocking upgrade screen on it.
    void clientUpgradeRequired();

private:
    /// Refreshes the token if needed (AuthInterceptor::prepare), then sends the attempt.
    void runUnaryAttempt(const std::shared_ptr<detail::CallState>& state,
                         const std::shared_ptr<detail::UnaryCall>& call, int attempt);
    void sendUnaryAttempt(const std::shared_ptr<detail::CallState>& state,
                          const std::shared_ptr<detail::UnaryCall>& call, int attempt);
    void openStream(const std::shared_ptr<detail::CallState>& state, const std::shared_ptr<detail::StreamCall>& stream);
    void sendStream(const std::shared_ptr<detail::CallState>& state, const std::shared_ptr<detail::StreamCall>& stream);
    /// Links a call to `context`: destroying the context cancels the call silently.
    [[nodiscard]] CallHandle bindToContext(CallHandle handle, const QObject* context,
                                           const std::shared_ptr<QMetaObject::Connection>& link);
    void onUnaryFinished(QNetworkReply& reply, const std::shared_ptr<detail::CallState>& state,
                         const std::shared_ptr<detail::UnaryCall>& call, int attempt);

    /// Remembers a call so ~ConnectClient can cancel it; forgets the ones that already ended.
    void track(const std::shared_ptr<detail::CallState>& state);

    QNetworkAccessManager network_;
    std::vector<std::weak_ptr<detail::CallState>> inFlight_;
    ClientConfig config_;
    std::shared_ptr<const AuthInterceptor> interceptor_;
    std::optional<ApiError> configError_;
    QSslConfiguration sslConfig_;
    QList<QByteArray> pinnedSpki_; // raw SHA-256 digests
};

namespace detail {

[[nodiscard]] std::optional<QByteArray> serialize(const google::protobuf::MessageLite& message);

template <typename Res>
[[nodiscard]] ApiResult<Res> parseMessage(const QByteArray& bytes) {
    Res message;
    if (!message.ParseFromArray(bytes.constData(), static_cast<int>(bytes.size()))) {
        return std::unexpected(ApiError{.kind = ApiErrorKind::Decoding,
                                        .httpStatus = 200,
                                        .message = std::string("Malformed ").append(message.GetTypeName())});
    }
    return message;
}

} // namespace detail

template <typename Req, typename Res>
CallHandle ConnectClient::unary(const Method<Req, Res>& method, const Req& request,
                                std::type_identity_t<ApiCompletion<Res>> done, const CallOptions& options) {
    static_assert(std::is_base_of_v<google::protobuf::MessageLite, Req>, "Req must be a generated Protobuf message");
    static_assert(std::is_base_of_v<google::protobuf::MessageLite, Res>, "Res must be a generated Protobuf message");

    auto body = detail::serialize(request);
    if (!body) {
        return failAsync(
            ApiError{.kind = ApiErrorKind::Internal,
                     .httpStatus = 0,
                     .message = std::string("Cannot serialize ").append(request.GetTypeName())},
            [done = std::move(done)](RawResult result) { done(std::unexpected(std::move(result.error()))); });
    }
    return unaryRaw(method.info, std::move(*body), options, [done = std::move(done)](RawResult raw) {
        if (!raw) {
            done(std::unexpected(std::move(raw.error())));
            return;
        }
        done(detail::parseMessage<Res>(*raw));
    });
}

template <typename Req, typename Res>
CallHandle ConnectClient::unary(const Method<Req, Res>& method, const Req& request, const QObject* context,
                                std::type_identity_t<ApiCompletion<Res>> done, const CallOptions& options) {
    auto link = std::make_shared<QMetaObject::Connection>();
    CallHandle handle = unary(
        method, request,
        [link, done = std::move(done)](ApiResult<Res> result) {
            QObject::disconnect(*link);
            done(std::move(result));
        },
        options);
    return bindToContext(std::move(handle), context, link);
}

template <typename Req, typename Res>
CallHandle ConnectClient::serverStream(const Method<Req, Res>& method, const Req& request, const QObject* context,
                                       std::type_identity_t<std::function<void(Res)>> onMessage,
                                       std::type_identity_t<ApiCompletion<void>> onDone, const CallOptions& options) {
    auto link = std::make_shared<QMetaObject::Connection>();
    CallHandle handle = serverStream(
        method, request, std::move(onMessage),
        [link, onDone = std::move(onDone)](ApiResult<void> result) {
            QObject::disconnect(*link);
            onDone(std::move(result));
        },
        options);
    return bindToContext(std::move(handle), context, link);
}

template <typename Req, typename Res>
CallHandle ConnectClient::serverStream(const Method<Req, Res>& method, const Req& request,
                                       std::type_identity_t<std::function<void(Res)>> onMessage,
                                       std::type_identity_t<ApiCompletion<void>> onDone, const CallOptions& options) {
    static_assert(std::is_base_of_v<google::protobuf::MessageLite, Req>, "Req must be a generated Protobuf message");
    static_assert(std::is_base_of_v<google::protobuf::MessageLite, Res>, "Res must be a generated Protobuf message");

    auto body = detail::serialize(request);
    if (!body) {
        return failAsync(
            ApiError{.kind = ApiErrorKind::Internal,
                     .httpStatus = 0,
                     .message = std::string("Cannot serialize ").append(request.GetTypeName())},
            [onDone = std::move(onDone)](RawResult result) { onDone(std::unexpected(std::move(result.error()))); });
    }
    return serverStreamRaw(
        method.info, std::move(*body), options,
        [onMessage = std::move(onMessage)](QByteArray raw) -> std::expected<void, ApiError> {
            auto message = detail::parseMessage<Res>(raw);
            if (!message) {
                return std::unexpected(std::move(message.error()));
            }
            onMessage(std::move(*message));
            return {};
        },
        std::move(onDone));
}

} // namespace aedst::network
