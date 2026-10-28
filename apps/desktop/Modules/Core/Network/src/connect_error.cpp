#include "aedst/network/connect_error.hpp"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QJsonValue>
#include <QString>

#include <utility>

namespace aedst::network {
namespace {

/// Reason of the first google.rpc.ErrorInfo in the Connect error `details`. connect-go renders each detail as
/// `{"type": "google.rpc.ErrorInfo", "value": "<unpadded base64 of the proto>", "debug": {"reason": ...}}`.
/// `debug` is optional in the protocol, so when it is absent the reason is looked for in the decoded bytes: it
/// is a plain proto string field and therefore appears verbatim. Only the one reason this client acts on is
/// recognised that way; any other reason is ignored (empty).
[[nodiscard]] std::string errorInfoReason(const QJsonValue& details) {
    if (!details.isArray()) {
        return {};
    }
    for (const QJsonValue& entry : details.toArray()) {
        const QJsonObject detail = entry.toObject();
        if (!detail.value(QStringLiteral("type")).toString().endsWith(QLatin1String("ErrorInfo"))) {
            continue;
        }
        const QString debugReason =
            detail.value(QStringLiteral("debug")).toObject().value(QStringLiteral("reason")).toString();
        if (!debugReason.isEmpty()) {
            return debugReason.toStdString();
        }
        const QByteArray bytes = QByteArray::fromBase64(detail.value(QStringLiteral("value")).toString().toLatin1(),
                                                        QByteArray::Base64Encoding | QByteArray::OmitTrailingEquals);
        const QByteArray known(ApiError::kUpgradeRequiredReason.data(),
                               static_cast<qsizetype>(ApiError::kUpgradeRequiredReason.size()));
        if (bytes.contains(known)) {
            return std::string(ApiError::kUpgradeRequiredReason);
        }
    }
    return {};
}

[[nodiscard]] ApiError fromErrorObject(int httpStatus, const QJsonObject& error, const std::string& fallbackMessage) {
    const std::string code = error.value(QStringLiteral("code")).toString().toStdString();
    std::string message = error.value(QStringLiteral("message")).toString().toStdString();
    if (message.empty()) {
        message = fallbackMessage.empty() ? code : fallbackMessage;
    }
    ApiError result = ApiError::fromConnectResponse(httpStatus, code, std::move(message));
    result.reason = errorInfoReason(error.value(QStringLiteral("details")));
    return result;
}

} // namespace

ApiError errorFromUnaryResponse(int httpStatus, const QByteArray& body, const std::string& fallbackMessage) {
    const QJsonDocument document = QJsonDocument::fromJson(body);
    if (document.isObject()) {
        return fromErrorObject(httpStatus, document.object(), fallbackMessage);
    }
    const std::string message = fallbackMessage.empty() ? "HTTP " + std::to_string(httpStatus) : fallbackMessage;
    return ApiError::fromConnectResponse(httpStatus, "", message);
}

std::expected<void, ApiError> parseEndStream(const QByteArray& payload) {
    if (payload.isEmpty()) {
        return {};
    }
    QJsonParseError parseError{};
    const QJsonDocument document = QJsonDocument::fromJson(payload, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        return std::unexpected(
            ApiError{.kind = ApiErrorKind::Decoding,
                     .httpStatus = 200,
                     .message = "Malformed end-of-stream message: " + parseError.errorString().toStdString()});
    }
    const QJsonValue error = document.object().value(QStringLiteral("error"));
    if (!error.isObject()) {
        return {};
    }
    // Streaming errors travel inside an HTTP 200; the code alone classifies them.
    return std::unexpected(fromErrorObject(200, error.toObject(), ""));
}

} // namespace aedst::network
