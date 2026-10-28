// Server-streaming half of ConnectClient. Split out of connect_client.cpp without behaviour change.

#include "aedst/core/correlation.hpp"
#include "aedst/logging/log_categories.hpp"
#include "aedst/network/auth_interceptor.hpp"
#include "aedst/network/connect_envelope.hpp"
#include "aedst/network/connect_error.hpp"
#include "connect_client_internal.hpp"

#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QTimer>

namespace aedst::network {

using namespace internal;

CallHandle ConnectClient::serverStreamRaw(const MethodInfo& method, QByteArray body, const CallOptions& options,
                                          RawMessageHandler onMessage, ApiCompletion<void> onDone) {
    if (configError_) {
        return failAsync(*configError_, [onDone = std::move(onDone)](RawResult result) {
            onDone(std::unexpected(std::move(result.error())));
        });
    }
    auto state = std::make_shared<detail::CallState>();
    auto stream = std::make_shared<detail::StreamCall>();
    stream->onMessage = std::move(onMessage);
    stream->onDone = std::move(onDone);

    state->fail = [weak = std::weak_ptr<detail::CallState>(state), stream](ApiError error) {
        if (const auto locked = weak.lock()) {
            completeStream(locked, *stream, std::unexpected(std::move(error)));
        }
    };

    // No default deadline: a stream is expected to outlive the unary timeout.
    stream->timeout = options.timeout.value_or(std::chrono::milliseconds{0});
    stream->path = std::string(method.path);
    stream->url = endpointUrl(config_.baseUrl, method.path);
    stream->body = std::move(body);
    stream->auth = method.auth;
    stream->correlationId = callCorrelationId();

    track(state);
    openStream(state, stream);
    return CallHandle{state};
}

void ConnectClient::openStream(const std::shared_ptr<detail::CallState>& state,
                               const std::shared_ptr<detail::StreamCall>& stream) {
    if (state->finished) {
        return;
    }
    if (state->cancelled) {
        completeStream(state, *stream, std::unexpected(cancelledError()));
        return;
    }
    if (!interceptor_ || !interceptor_->canRefresh() || stream->auth == AuthRequirement::Public) {
        sendStream(state, stream);
        return;
    }
    QPointer<ConnectClient> self(this);
    interceptor_->prepare(stream->auth, [self, state, stream](std::optional<ApiError> failure) {
        if (!self || state->finished) {
            return;
        }
        if (state->cancelled) {
            completeStream(state, *stream, std::unexpected(cancelledError()));
            return;
        }
        if (failure) {
            QTimer::singleShot(0, self.data(), [state, stream, error = std::move(*failure)]() mutable {
                completeStream(state, *stream, std::unexpected(std::move(error)));
            });
            return;
        }
        self->sendStream(state, stream);
    });
}

void ConnectClient::sendStream(const std::shared_ptr<detail::CallState>& state,
                               const std::shared_ptr<detail::StreamCall>& stream) {
    if (state->finished) {
        return;
    }
    if (state->cancelled) {
        completeStream(state, *stream, std::unexpected(cancelledError()));
        return;
    }
    stream->reader = envelope::EnvelopeReader{};
    stream->contentTypeChecked = false;

    QNetworkRequest request(stream->url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/connect+proto"));
    request.setRawHeader("Connect-Protocol-Version", "1");
    request.setRawHeader("Connect-Accept-Encoding", "identity"); // no per-message compression
    request.setRawHeader("Accept-Encoding", "identity");         // and no intermediary re-encoding
    if (stream->timeout.count() > 0) {
        request.setRawHeader("Connect-Timeout-Ms", QByteArray::number(static_cast<qlonglong>(stream->timeout.count())));
    }
    if (interceptor_) {
        interceptor_->apply(request, stream->auth);
        const QByteArray authorization = request.rawHeader("Authorization");
        stream->sentToken = core::SecretString{authorization.startsWith("Bearer ") ? authorization.mid(7).toStdString()
                                                                                   : std::string{}};
    }
    hardenRequest(request, sslConfig_, stream->correlationId, config_.clientIdentifier);
    {
        const core::CorrelationScope scope(stream->correlationId);
        qCDebug(lcNetwork, "POST %s (server stream)", stream->path.c_str());
    }

    QNetworkReply* reply = network_.post(request, envelope::encode(0, stream->body));
    state->reply = reply;
    watchHandshake(reply, pinnedSpki_);
    armDeadline(reply, stream->timeout);

    connect(reply, &QNetworkReply::readyRead, this, [reply, state, stream, pins = pinnedSpki_]() {
        if (state->finished) {
            reply->readAll();
            return;
        }
        if (pinViolation(*reply, pins)) {
            return; // the abort inside completes the call through finished()
        }
        // Non-200 bodies are a plain JSON error, not envelopes: wait for finished().
        if (reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() != 200) {
            return;
        }
        if (!stream->contentTypeChecked) {
            stream->contentTypeChecked = true;
            if (!hasContentType(*reply, "application/connect+proto")) {
                completeStream(state, *stream,
                               std::unexpected(ApiError{.kind = ApiErrorKind::Decoding,
                                                        .httpStatus = 200,
                                                        .message = "Unexpected stream content-type"}));
                reply->abort();
                return;
            }
        }
        consumeStreamBytes(state, *stream, *reply, reply->readAll());
    });

    QPointer<ConnectClient> self(this);
    connect(reply, &QNetworkReply::finished, this, [self, reply, state, stream, pins = pinnedSpki_]() {
        state->reply.clear();
        if (state->finished) {
            return;
        }
        if (state->cancelled) {
            completeStream(state, *stream, std::unexpected(cancelledError()));
            return;
        }
        pinViolation(*reply, pins);
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (auto failure = transportError(*reply, status)) {
            completeStream(state, *stream, std::unexpected(std::move(*failure)));
            return;
        }
        const QByteArray rest = reply->readAll();
        if (status != 200) {
            ApiError error = errorFromUnaryResponse(status, rest, reply->errorString().toStdString());
            if (error.kind == ApiErrorKind::Unauthenticated && stream->auth == AuthRequirement::Required && self &&
                self->interceptor_ && self->interceptor_->canRefresh() && !stream->refreshedAfterRejection) {
                // Rejected before any message was delivered: refresh once, then open the stream again.
                stream->refreshedAfterRejection = true;
                self->interceptor_->refreshAfterRejection(
                    stream->sentToken.reveal(), [self, state, stream](std::optional<ApiError> refreshFailure) {
                        if (!self || state->finished) {
                            return;
                        }
                        if (state->cancelled) {
                            completeStream(state, *stream, std::unexpected(cancelledError()));
                            return;
                        }
                        if (refreshFailure) {
                            completeStream(state, *stream, std::unexpected(std::move(*refreshFailure)));
                            return;
                        }
                        self->openStream(state, stream);
                    });
                return;
            }
            completeStream(state, *stream, std::unexpected(std::move(error)));
            return;
        }
        if (!rest.isEmpty()) {
            consumeStreamBytes(state, *stream, *reply, rest);
        }
        completeStream(state, *stream,
                       std::unexpected(ApiError{.kind = ApiErrorKind::Transport,
                                                .httpStatus = status,
                                                .message = "Stream ended without an end-of-stream message"}));
    });
}

} // namespace aedst::network
