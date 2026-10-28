#include "Domain/snippet.hpp"

#include <string>

namespace aedst::feature::search {
namespace {

void appendRun(std::vector<SnippetSegment>& out, std::string_view text, bool highlighted) {
    if (text.empty()) {
        return;
    }
    if (!out.empty() && out.back().highlighted == highlighted) {
        out.back().text.append(text);
        return;
    }
    out.push_back(SnippetSegment{.text = std::string(text), .highlighted = highlighted});
}

} // namespace

std::vector<SnippetSegment> parseSnippet(std::string_view marked) {
    std::vector<SnippetSegment> segments;
    bool highlighted = false;
    std::size_t runStart = 0;
    std::size_t pos = 0;
    while (pos < marked.size()) {
        const std::string_view rest = marked.substr(pos);
        const bool isStart = rest.starts_with(kHighlightStart);
        const bool isEnd = rest.starts_with(kHighlightEnd);
        if (!isStart && !isEnd) {
            ++pos;
            continue;
        }
        appendRun(segments, marked.substr(runStart, pos - runStart), highlighted);
        highlighted = isStart;         // start while open: stays open; end while closed: stays closed
        pos += kHighlightStart.size(); // both markers are 3 bytes
        runStart = pos;
    }
    appendRun(segments, marked.substr(runStart), highlighted);
    return segments;
}

std::string normalizeQuery(std::string_view raw) {
    constexpr std::string_view kWhitespace = " \t\r\n\v\f";
    const auto first = raw.find_first_not_of(kWhitespace);
    if (first == std::string_view::npos) {
        return {};
    }
    const auto last = raw.find_last_not_of(kWhitespace);
    std::string_view text = raw.substr(first, last - first + 1);

    std::size_t codePoints = 0;
    for (std::size_t i = 0; i < text.size(); ++i) {
        if ((static_cast<unsigned char>(text[i]) & 0xC0U) != 0x80U) {
            if (codePoints == kMaxQueryChars) {
                text = text.substr(0, i); // cut before the 201st character's lead byte
                break;
            }
            ++codePoints;
        }
    }
    return std::string(text);
}

std::size_t countCodePoints(std::string_view utf8) {
    std::size_t count = 0;
    for (const char c : utf8) {
        if ((static_cast<unsigned char>(c) & 0xC0U) != 0x80U) {
            ++count;
        }
    }
    return count;
}

} // namespace aedst::feature::search
