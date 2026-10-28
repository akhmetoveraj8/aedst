#include "aedst/network/transport_policy.hpp"

#include <QByteArray>
#include <QHostAddress>
#include <QLatin1String>
#include <QtGlobal>

#include <string>
#include <utility>

namespace aedst::network {
namespace {

[[nodiscard]] std::unexpected<ApiError> rejected(std::string message) {
    return std::unexpected(
        ApiError{.kind = ApiErrorKind::InvalidArgument, .httpStatus = 0, .message = std::move(message)});
}

} // namespace

bool isLoopbackHost(const QString& host) {
    QString name = host.toLower();
    if (name.startsWith(QLatin1Char('[')) && name.endsWith(QLatin1Char(']'))) {
        name = name.mid(1, name.size() - 2);
    }
    if (name.endsWith(QLatin1Char('.'))) {
        name.chop(1);
    }
    if (name.isEmpty()) {
        return false;
    }
    if (name == QLatin1String("localhost") || name.endsWith(QLatin1String(".localhost"))) {
        return true;
    }
    QHostAddress address;
    if (address.setAddress(name)) {
        return address.isLoopback();
    }
    return false;
}

bool insecureLoopbackAllowedByDefault() {
#ifndef NDEBUG
    return true;
#else
    const QByteArray value = qgetenv("AEDST_ALLOW_INSECURE_LOCALHOST").trimmed().toLower();
    return value == "1" || value == "true" || value == "yes" || value == "on";
#endif
}

ApiResult<void> validateEndpoint(const QUrl& baseUrl, bool allowInsecureLoopback) {
    if (baseUrl.isEmpty() || !baseUrl.isValid()) {
        return rejected("API endpoint URL is empty or malformed");
    }

    const QString scheme = baseUrl.scheme(); // QUrl normalises it to lower case
    const bool isHttps = scheme == QLatin1String("https");
    const bool isHttp = scheme == QLatin1String("http");
    if (!isHttps && !isHttp) {
        return rejected("API endpoint scheme must be https, got '" + scheme.toStdString() + "'");
    }
    if (baseUrl.host().isEmpty()) {
        return rejected("API endpoint URL has no host");
    }
    if (!baseUrl.userName().isEmpty() || !baseUrl.password().isEmpty() ||
        baseUrl.authority().contains(QLatin1Char('@'))) {
        return rejected("API endpoint URL must not contain credentials (user:password@host)");
    }
    if (baseUrl.hasFragment()) {
        return rejected("API endpoint URL must not contain a fragment");
    }
    if (baseUrl.hasQuery()) {
        return rejected("API endpoint URL must not contain a query string");
    }

    if (isHttps) {
        return {};
    }
    // Plain http from here on.
    if (!isLoopbackHost(baseUrl.host())) {
        return rejected("Plain http to '" + baseUrl.host().toStdString() +
                        "' is not allowed: use https (plain http is only permitted to loopback hosts)");
    }
    if (!allowInsecureLoopback) {
        return rejected("Plain http to a loopback host is disabled in this build: use https, or set "
                        "AEDST_ALLOW_INSECURE_LOCALHOST=1 for local development");
    }
    return {};
}

} // namespace aedst::network
