// Unary half of ConnectClient (construction, config validation, retries, token refresh on rejection).
// Streaming lives in connect_client_stream.cpp, TLS policy in connect_client_tls.cpp, shared helpers
// in connect_client_support.cpp.

#include "aedst/core/correlation.hpp"
#include "aedst/logging/log_categories.hpp"
#include "aedst/network/auth_interceptor.hpp"
#include "aedst/network/connect_error.hpp"
#include "connect_client_internal.hpp"

#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QRandomGenerator>
#include <QSslError>
#include <QString>
#include <QTimer>

namespace aedst::network {

using namespace internal;

ConnectClient::ConnectClient(ClientConfig config, std::shared_ptr<const AuthInterceptor> interceptor, QObject* parent)
    : QObject(parent), config_(std::move(config)), interceptor_(std::move(interceptor)) {
    // Replies are deleteLater()'d after finished(), so the slots below may still read them.
    network_.setAutoDeleteReplies(true);
    // A redirect would replay the POST (and possibly the bearer token) somewhere the
    // caller did not name; surface it as an error instead.
    network_.setRedirectPolicy(QNetworkRequest::ManualRedirectPolicy);

    // Certificate errors are only logged, never answered with ignoreSslErrors():
    // Qt then fails the request (SslHandshakeFailedError -> ApiErrorKind::Transport).
    // Only error descriptions and the host are logged, no request data.
    connect(&network_, &QNetworkAccessManager::sslErrors, this,
            [](QNetworkReply* reply, const QList<QSslError>& errors) {
                const std::string host = reply != nullptr ? reply->url().host().toStdString() : std::string{};
                for (const QSslError& error : errors) {
                    qCCritical(lcNetwork, "TLS certificate validation failed for %s: %s", host.c_str(),
                               loggable(error.errorString().toStdString()).c_str());
                }
            });

    auto setup = buildTlsSetup(config_);
    if (!setup) {
        configError_ = std::move(setup.error());
        qCCritical(lcNetwork, "API client is disabled, every call will fail: %s",
                   loggable(configError_->message).c_str());
        return;
    }
    sslConfig_ = std::move(setup->ssl);
    pinnedSpki_ = std::move(setup->pins);
}

ApiResult<void> validateClientConfig(const ClientConfig& config) {
    if (auto setup = buildTlsSetup(config); !setup) {
        return std::unexpected(std::move(setup.error()));
    }
    return {};
}

const QUrl& ConnectClient::baseUrl() const noexcept {
    return config_.baseUrl;
}

void ConnectClient::prewarm() {
    if (configError_) {
        return;
    }
    const bool secure = config_.baseUrl.scheme() == QLatin1String("https");
    const auto port = static_cast<quint16>(config_.baseUrl.port(secure ? 443 : 80));
    if (secure) {
        network_.connectToHostEncrypted(config_.baseUrl.host(), port, sslConfig_);
    } else {
        network_.connectToHost(config_.baseUrl.host(), port);
    }
}

CallHandle ConnectClient::failAsync(ApiError error, RawCompletion done) {
    auto state = std::make_shared<detail::CallState>();
    QTimer::singleShot(0, this, [state, error = std::move(error), done = std::move(done)]() mutable {
        if (state->finished) {
            return;
        }
        state->finished = true;
        done(std::unexpected(std::move(error)));
    });
    return CallHandle{state};
}

CallHandle ConnectClient::unaryRaw(const MethodInfo& method, QByteArray body, const CallOptions& options,
                                   RawCompletion done) {
    if (configError_) {
        return failAsync(*configError_, std::move(done));
    }
    if (!options.idempotencyKey.empty() && !isValidIdempotencyKey(options.idempotencyKey)) {
        return failAsync(ApiError{.kind = ApiErrorKind::InvalidArgument,
                                  .httpStatus = 0,
                                  .message = "Idempotency-Key must be 1-128 printable ASCII characters"},
                         std::move(done));
    }
    auto state = std::make_shared<detail::CallState>();
    auto call = std::make_shared<detail::UnaryCall>();
    call->idempotencyKey = options.idempotencyKey;
    call->correlationId = callCorrelationId();
    call->url = endpointUrl(config_.baseUrl, method.path);
    call->path = std::string(method.path);
    call->body = std::move(body);
    call->auth = method.auth;
    call->retry =
        method.idempotency == Idempotency::Idempotent ? options.retry.value_or(config_.retry) : RetryPolicy::none();
    call->timeout = options.timeout.value_or(config_.defaultTimeout);
    call->done = std::move(done);

    state->fail = [weak = std::weak_ptr<detail::CallState>(state), call](ApiError error) {
        if (const auto locked = weak.lock()) {
            completeUnary(locked, *call, std::unexpected(std::move(error)));
        }
    };

    track(state);
    runUnaryAttempt(state, call, 1);
    return CallHandle{state};
}

ConnectClient::~ConnectClient() {
    // Still inside the destructor body: every member (network_, config_, ...) is alive, so a reply aborted here runs
    // its finished() slot normally and the call completes with Cancelled.
    const auto pending = std::exchange(inFlight_, {});
    for (const auto& weak : pending) {
        if (const auto state = weak.lock()) {
            CallHandle{state}.cancel();
        }
    }
}

void ConnectClient::track(const std::shared_ptr<detail::CallState>& state) {
    std::erase_if(inFlight_, [](const std::weak_ptr<detail::CallState>& weak) {
        const auto locked = weak.lock();
        return !locked || locked->finished;
    });
    inFlight_.push_back(state);
}

CallHandle ConnectClient::bindToContext(CallHandle handle, const QObject* context,
                                        const std::shared_ptr<QMetaObject::Connection>& link) {
    if (context != nullptr && handle.isActive()) {
        // The context is the receiver of nothing: this connection only exists to observe its destruction.
        *link = QObject::connect(context, &QObject::destroyed, this, [handle]() { handle.cancelSilently(); });
    }
    return handle;
}

void ConnectClient::runUnaryAttempt(const std::shared_ptr<detail::CallState>& state,
                                    const std::shared_ptr<detail::UnaryCall>& call, int attempt) {
    if (state->finished) {
        return;
    }
    if (state->cancelled) {
        completeUnary(state, *call, std::unexpected(cancelledError()));
        return;
    }
    if (!interceptor_ || !interceptor_->canRefresh() || call->auth == AuthRequirement::Public) {
        sendUnaryAttempt(state, call, attempt);
        return;
    }
    // Refresh the token first if it is about to expire (single flight inside the refresher).
    QPointer<ConnectClient> self(this);
    interceptor_->prepare(call->auth, [self, state, call, attempt](std::optional<ApiError> failure) {
        if (!self || state->finished) {
            return;
        }
        if (state->cancelled) {
            completeUnary(state, *call, std::unexpected(cancelledError()));
            return;
        }
        if (failure) {
            // Never complete inside unaryRaw(): the contract is an asynchronous completion.
            QTimer::singleShot(0, self.data(), [state, call, error = std::move(*failure)]() mutable {
                completeUnary(state, *call, std::unexpected(std::move(error)));
            });
            return;
        }
        self->sendUnaryAttempt(state, call, attempt);
    });
}

void ConnectClient::sendUnaryAttempt(const std::shared_ptr<detail::CallState>& state,
                                     const std::shared_ptr<detail::UnaryCall>& call, int attempt) {
    if (state->finished) {
        return;
    }
    if (state->cancelled) {
        completeUnary(state, *call, std::unexpected(cancelledError()));
        return;
    }

    QNetworkRequest request(call->url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/proto"));
    request.setRawHeader("Connect-Protocol-Version", "1");
    if (call->timeout.count() > 0) {
        request.setRawHeader("Connect-Timeout-Ms", QByteArray::number(static_cast<qlonglong>(call->timeout.count())));
    }
    if (interceptor_) {
        interceptor_->apply(request, call->auth); // per attempt: picks up a rotated token
        const QByteArray authorization = request.rawHeader("Authorization");
        call->sentToken = core::SecretString{authorization.startsWith("Bearer ") ? authorization.mid(7).toStdString()
                                                                                 : std::string{}};
    }
    hardenRequest(request, sslConfig_, call->correlationId, config_.clientIdentifier);
    if (!call->idempotencyKey.empty()) {
        request.setRawHeader("Idempotency-Key", QByteArray::fromStdString(call->idempotencyKey));
    }
    {
        const core::CorrelationScope scope(call->correlationId);
        qCDebug(lcNetwork, "POST %s (attempt %d/%d)", call->path.c_str(), static_cast<int>(attempt),
                static_cast<int>(call->retry.maxAttempts));
    }

    QNetworkReply* reply = network_.post(request, call->body);
    state->reply = reply;
    watchHandshake(reply, pinnedSpki_);
    armDeadline(reply, call->timeout);
    if (config_.maxResponseBytes > 0) {
        // Never buffer an unbounded body: abort as soon as the announced or received size exceeds the limit.
        const auto limit = static_cast<qint64>(config_.maxResponseBytes);
        connect(reply, &QNetworkReply::downloadProgress, reply, [reply, limit](qint64 received, qint64 total) {
            if (received > limit || total > limit) {
                reply->setProperty(kTooLargeProperty, true);
                reply->abort();
            }
        });
    }
    connect(reply, &QNetworkReply::finished, this,
            [this, reply, state, call, attempt]() { onUnaryFinished(*reply, state, call, attempt); });
}

void ConnectClient::onUnaryFinished(QNetworkReply& reply, const std::shared_ptr<detail::CallState>& state,
                                    const std::shared_ptr<detail::UnaryCall>& call, int attempt) {
    state->reply.clear();
    pinViolation(reply, pinnedSpki_);
    RawResult result = parseUnaryReply(reply);
    if (!result && result.error().isUpgradeRequired()) {
        emit clientUpgradeRequired();
    }

    if (state->cancelled) {
        completeUnary(state, *call, std::unexpected(cancelledError()));
        return;
    }
    if (!result && result.error().kind == ApiErrorKind::Unauthenticated && call->auth == AuthRequirement::Required &&
        interceptor_ && interceptor_->canRefresh() && !call->refreshedAfterRejection) {
        // The server rejected the token (revoked server-side, clock skew, rotated elsewhere): refresh
        // once and replay once. The rejected call never ran on the server, so replaying is safe even
        // for non-idempotent methods. A second rejection is final.
        call->refreshedAfterRejection = true;
        QPointer<ConnectClient> self(this);
        interceptor_->refreshAfterRejection(
            call->sentToken.reveal(), [self, state, call, attempt](std::optional<ApiError> failure) {
                if (!self || state->finished) {
                    return;
                }
                if (state->cancelled) {
                    completeUnary(state, *call, std::unexpected(cancelledError()));
                    return;
                }
                if (failure) {
                    completeUnary(state, *call, std::unexpected(std::move(*failure)));
                    return;
                }
                self->runUnaryAttempt(state, call, attempt); // same attempt number: the retry budget is untouched
            });
        return;
    }
    if (!result) {
        // A TLS failure is a verdict on the peer, not a blip: never retry it.
        const bool tlsFailure =
            reply.property(kPinFailedProperty).toBool() || reply.error() == QNetworkReply::SslHandshakeFailedError;
        const ApiError& error = result.error();
        // Logging only: the completion below must not run inside the scope, or
        // calls it starts would silently inherit this call's id.
        const core::CorrelationScope scope(call->correlationId);
        if (!tlsFailure && attempt < call->retry.maxAttempts && error.isRetryable()) {
            const auto delay = call->retry.delayBefore(attempt + 1, QRandomGenerator::global()->generateDouble());
            qCWarning(lcNetwork, "%s failed (http=%d code=%s message=%s); retrying in %lld ms", call->path.c_str(),
                      static_cast<int>(error.httpStatus), loggable(error.connectCode).c_str(),
                      loggable(error.message).c_str(), static_cast<long long>(delay.count()));
            QTimer::singleShot(delay, this,
                               [this, state, call, attempt]() { runUnaryAttempt(state, call, attempt + 1); });
            return;
        }
        qCWarning(lcNetwork, "%s failed: http=%d code=%s message=%s", call->path.c_str(),
                  static_cast<int>(error.httpStatus), loggable(error.connectCode).c_str(),
                  loggable(error.message).c_str());
    }
    completeUnary(state, *call, std::move(result));
}

} // namespace aedst::network
