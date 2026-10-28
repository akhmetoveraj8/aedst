#include "aedst/platform/toast_xml.hpp"

#include <QString>

#include <string_view>
#include <utility>

namespace aedst::platform {
namespace {

constexpr qsizetype kMaxTitleChars = 256;
constexpr qsizetype kMaxBodyChars = 2048;
constexpr qsizetype kMaxLabelChars = 64;

/// XML 1.0 allows tab, LF, CR and everything from U+0020 up (minus surrogates/U+FFFE/U+FFFF); a stray control
/// character makes the toast API reject the whole document.
[[nodiscard]] QString xmlSafe(QString text) {
    QString out;
    out.reserve(text.size());
    for (const QChar c : std::as_const(text)) {
        const char16_t u = c.unicode();
        if (u == 0x9 || u == 0xA || u == 0xD || (u >= 0x20 && u != 0xFFFE && u != 0xFFFF)) {
            out.append(c);
        }
    }
    return out;
}

[[nodiscard]] QString escaped(std::string_view text, qsizetype maxChars) {
    const QString decoded = QString::fromUtf8(text.data(), static_cast<qsizetype>(text.size())).left(maxChars);
    return xmlSafe(decoded).toHtmlEscaped(); // & < > "
}

} // namespace

bool isActivatableLink(const std::string& link) {
    if (link.empty() || link.size() > kMaxToastLinkChars || link.front() != '/') {
        return false;
    }
    if (link.size() > 1 && link[1] == '/') {
        return false; // protocol-relative URL
    }
    for (const char c : link) {
        const auto u = static_cast<unsigned char>(c);
        if (u < 0x20 || u == 0x7F || c == '"' || c == '\'' || c == '<' || c == '>' || c == '&' || c == '\\') {
            return false;
        }
    }
    return true;
}

std::wstring buildToastXml(const NotificationRequest& request) {
    const bool actionable = isActivatableLink(request.link);
    QString xml;
    xml += QStringLiteral("<toast");
    if (actionable) {
        xml += QStringLiteral(" activationType=\"foreground\" launch=\"") +
               QString::fromStdString(request.link).toHtmlEscaped() + QStringLiteral("\"");
    }
    xml += QStringLiteral("><visual><binding template=\"ToastGeneric\"><text>") +
           escaped(request.title, kMaxTitleChars) + QStringLiteral("</text>");
    if (!request.body.empty()) {
        xml += QStringLiteral("<text>") + escaped(request.body, kMaxBodyChars) + QStringLiteral("</text>");
    }
    xml += QStringLiteral("</binding></visual>");
    if (actionable) {
        const QString label =
            request.actionLabel.empty() ? QStringLiteral("Open") : escaped(request.actionLabel, kMaxLabelChars);
        xml += QStringLiteral("<actions><action activationType=\"foreground\" content=\"") + label +
               QStringLiteral("\" arguments=\"") + QString::fromStdString(request.link).toHtmlEscaped() +
               QStringLiteral("\"/></actions>");
    }
    xml += QStringLiteral("</toast>");
    return xml.toStdWString();
}

} // namespace aedst::platform
