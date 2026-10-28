#include "aedst/core/redaction.hpp"

#include <array>
#include <cstddef>

namespace aedst::core {
namespace {

constexpr std::string_view kMask = "***";

constexpr bool isAlnum(char c) noexcept {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
}

/// Characters of an identifier-like key (`set-cookie`, `access_token`, `a.b`).
constexpr bool isKeyChar(char c) noexcept {
    return isAlnum(c) || c == '_' || c == '-' || c == '.';
}

constexpr bool isQuote(char c) noexcept {
    return c == '"' || c == '\'';
}

constexpr bool isBlank(char c) noexcept {
    return c == ' ' || c == '\t';
}

/// Characters of an opaque credential (base64, base64url, JWT, hex).
constexpr bool isCredentialChar(char c) noexcept {
    return isAlnum(c) || c == '-' || c == '.' || c == '_' || c == '~' || c == '+' || c == '/' || c == '=';
}

constexpr bool isLocalPartChar(char c) noexcept {
    return isAlnum(c) || c == '.' || c == '_' || c == '%' || c == '+' || c == '-';
}

constexpr bool isDomainChar(char c) noexcept {
    return isAlnum(c) || c == '.' || c == '-';
}

constexpr char lowerAscii(char c) noexcept {
    return (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c;
}

std::string lowered(std::string_view text) {
    std::string out(text);
    for (char& c : out) {
        c = lowerAscii(c);
    }
    return out;
}

template <typename Needles>
bool containsAny(const std::string& lower, const Needles& needles) {
    for (const std::string_view needle : needles) {
        if (lower.find(needle) != std::string::npos) {
            return true;
        }
    }
    return false;
}

constexpr std::array<std::string_view, 9> kSensitiveNeedles{"password", "passwd", "token",         "secret", "api_key",
                                                            "api-key",  "apikey", "authorization", "cookie"};
constexpr std::array<std::string_view, 2> kLineValueNeedles{"authorization", "cookie"};

bool endsUnquotedValue(char c, bool wholeLine) noexcept {
    if (c == '\r' || c == '\n' || c == '}' || c == ')') {
        return true;
    }
    if (wholeLine) {
        return false;
    }
    return isBlank(c) || c == ',' || c == ';' || c == '&' || c == ']' || isQuote(c);
}

/// key=value / key: value / "key":"value" for sensitive keys.
std::string maskKeyValues(std::string_view text) {
    std::string out;
    out.reserve(text.size());
    const std::size_t size = text.size();
    std::size_t i = 0;
    while (i < size) {
        if (!isKeyChar(text[i])) {
            out.push_back(text[i]);
            ++i;
            continue;
        }
        std::size_t keyEnd = i;
        while (keyEnd < size && isKeyChar(text[keyEnd])) {
            ++keyEnd;
        }
        const std::string_view key = text.substr(i, keyEnd - i);
        out.append(key);
        i = keyEnd;

        const std::string lowerKey = lowered(key);
        if (!containsAny(lowerKey, kSensitiveNeedles)) {
            continue;
        }

        std::size_t cursor = keyEnd;
        if (cursor < size && isQuote(text[cursor])) {
            ++cursor; // closing quote of a quoted key
        }
        if (cursor >= size || (text[cursor] != ':' && text[cursor] != '=')) {
            continue;
        }
        ++cursor;
        while (cursor < size && isBlank(text[cursor])) {
            ++cursor;
        }

        std::size_t valueStart = cursor;
        std::size_t valueEnd = cursor;
        if (cursor < size && isQuote(text[cursor])) {
            const char quote = text[cursor];
            valueStart = cursor + 1;
            valueEnd = valueStart;
            while (valueEnd < size && text[valueEnd] != quote) {
                valueEnd += (text[valueEnd] == '\\' && valueEnd + 1 < size) ? 2U : 1U;
            }
        } else {
            const bool wholeLine = containsAny(lowerKey, kLineValueNeedles);
            while (valueEnd < size && !endsUnquotedValue(text[valueEnd], wholeLine)) {
                ++valueEnd;
            }
        }
        if (valueEnd == valueStart) {
            continue; // empty value: nothing to hide
        }
        out.append(text.substr(i, valueStart - i)); // quote, separator, blanks
        out.append(kMask);
        i = valueEnd; // a closing quote, if any, is copied by the main loop
    }
    return out;
}

/// `Bearer <credential>` wherever it appears (headers echoed in error text, etc.).
std::string maskBearer(std::string_view text) {
    constexpr std::string_view kScheme = "bearer";
    const std::string lower = lowered(text);
    const std::size_t size = text.size();
    std::string out;
    out.reserve(size);
    std::size_t pos = 0;
    while (pos < size) {
        const std::size_t hit = lower.find(kScheme, pos);
        if (hit == std::string::npos) {
            break;
        }
        const std::size_t afterScheme = hit + kScheme.size();
        const bool boundaryBefore = hit == 0 || !isKeyChar(text[hit - 1]);
        std::size_t credentialStart = afterScheme;
        while (credentialStart < size && isBlank(text[credentialStart])) {
            ++credentialStart;
        }
        std::size_t credentialEnd = credentialStart;
        while (credentialEnd < size && isCredentialChar(text[credentialEnd])) {
            ++credentialEnd;
        }
        if (boundaryBefore && credentialStart > afterScheme && credentialEnd > credentialStart) {
            out.append(text.substr(pos, credentialStart - pos));
            out.append(kMask);
            pos = credentialEnd;
        } else {
            out.append(text.substr(pos, afterScheme - pos));
            pos = afterScheme;
        }
    }
    out.append(text.substr(pos));
    return out;
}

/// local@domain.tld -> l***@d***.tld
std::string maskEmails(std::string_view text) {
    const std::size_t size = text.size();
    std::string out;
    out.reserve(size);
    for (std::size_t i = 0; i < size; ++i) {
        if (text[i] != '@') {
            out.push_back(text[i]);
            continue;
        }
        // The local part has already been copied to `out`; walk back over it.
        std::size_t localStart = out.size();
        while (localStart > 0 && isLocalPartChar(out[localStart - 1])) {
            --localStart;
        }
        std::size_t domainEnd = i + 1;
        while (domainEnd < size && isDomainChar(text[domainEnd])) {
            ++domainEnd;
        }
        while (domainEnd > i + 1 && (text[domainEnd - 1] == '.' || text[domainEnd - 1] == '-')) {
            --domainEnd; // sentence punctuation, not part of the domain
        }
        const std::string_view domain = text.substr(i + 1, domainEnd - (i + 1));
        const std::size_t lastDot = domain.rfind('.');
        const bool looksLikeEmail =
            localStart < out.size() && lastDot != std::string_view::npos && lastDot > 0 && lastDot + 1 < domain.size();
        if (!looksLikeEmail) {
            out.push_back('@');
            continue;
        }
        const char localFirst = out[localStart];
        out.resize(localStart);
        out.push_back(localFirst);
        out.append(kMask);
        out.push_back('@');
        out.push_back(domain.front());
        out.append(kMask);
        out.push_back('.');
        out.append(domain.substr(lastDot + 1));
        i = domainEnd - 1; // the loop's ++i moves to the first character after the domain
    }
    return out;
}

constexpr std::string_view kUserPlaceholder = "<user>";

constexpr bool isPathSeparator(char c) noexcept {
    return c == '/' || c == '\\';
}

/// The account name that follows `Users` or `home` in a path -> <user>.
std::string maskProfilePaths(std::string_view text) {
    constexpr std::array<std::string_view, 2> kRoots{"users", "home"};
    const std::string lower = lowered(text);
    const std::size_t size = text.size();
    std::string out;
    out.reserve(size);
    std::size_t pos = 0;
    while (pos < size) {
        std::size_t best = std::string::npos;
        std::size_t bestLength = 0;
        for (const std::string_view root : kRoots) {
            for (std::size_t hit = lower.find(root, pos); hit != std::string::npos; hit = lower.find(root, hit + 1)) {
                const std::size_t after = hit + root.size();
                if (hit > 0 && isPathSeparator(text[hit - 1]) && after < size && isPathSeparator(text[after])) {
                    if (hit < best) {
                        best = hit;
                        bestLength = root.size();
                    }
                    break;
                }
            }
        }
        if (best == std::string::npos) {
            break;
        }
        const std::size_t nameStart = best + bestLength + 1;
        std::size_t nameEnd = nameStart;
        while (nameEnd < size && !isPathSeparator(text[nameEnd]) && !isBlank(text[nameEnd]) &&
               !isQuote(text[nameEnd]) && text[nameEnd] != '\r' && text[nameEnd] != '\n') {
            ++nameEnd;
        }
        out.append(text.substr(pos, nameStart - pos));
        if (nameEnd > nameStart) {
            out.append(kUserPlaceholder);
        }
        pos = nameEnd;
    }
    out.append(text.substr(pos));
    return out;
}

} // namespace

std::string scrubPii(std::string_view text) {
    return maskProfilePaths(redactSecrets(text));
}

std::string redactSecrets(std::string_view text) {
    const std::string keyed = maskKeyValues(text);
    const std::string bearer = maskBearer(keyed);
    return maskEmails(bearer);
}

} // namespace aedst::core
