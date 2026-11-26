import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif
#if canImport(HighlightSwift)
import HighlightSwift
#endif

/// Kind of a highlighted run, one per syntax color token (`AedstColor.syntax*`).
enum AedstSyntaxToken: Int, CaseIterable, Sendable {
    case comment = 1
    case keyword
    case string
    case number
    case function
    case type
    case punctuation

    /// Adaptive token color: the light/dark switch happens at draw time, so one highlight serves both schemes.
    var color: Color {
        switch self {
        case .comment: AedstColor.syntaxComment
        case .keyword: AedstColor.syntaxKeyword
        case .string: AedstColor.syntaxString
        case .number: AedstColor.syntaxNumber
        case .function: AedstColor.syntaxFunction
        case .type: AedstColor.syntaxType
        case .punctuation: AedstColor.syntaxPunctuation
        }
    }

    /// highlight.js scopes painted with this token (CSS selectors of its class names).
    var selectors: [String] {
        switch self {
        case .comment: [".hljs-comment", ".hljs-quote"]
        case .keyword: [".hljs-keyword", ".hljs-selector-tag", ".hljs-literal", ".hljs-meta", ".hljs-doctag"]
        case .string: [".hljs-string", ".hljs-regexp", ".hljs-symbol", ".hljs-addition", ".hljs-char"]
        case .number: [".hljs-number"]
        case .function: [".hljs-title.function_", ".hljs-function .hljs-title", ".hljs-section", ".hljs-attr", ".hljs-property"]
        case .type: [".hljs-type", ".hljs-built_in", ".hljs-title.class_", ".hljs-class .hljs-title", ".hljs-attribute"]
        case .punctuation: [".hljs-punctuation", ".hljs-operator", ".hljs-deletion"]
        }
    }

    /// The token is written into the CSS as a marker color (blue channel = raw value x 32) and read back from the
    /// imported runs. Markers never reach the screen: they are replaced by `color`.
    var markerBlue: Int { rawValue * Self.markerStep }

    static let markerStep = 32

    /// The token whose marker is nearest to a blue channel value (0...255); `nil` for plain text (marker 0).
    static func token(forMarkerBlue blue: Double) -> AedstSyntaxToken? {
        AedstSyntaxToken(rawValue: Int((blue / Double(markerStep)).rounded()))
    }

    /// Style sheet handed to highlight.js: plain text gets marker 0, each token its own marker.
    static var markerCSS: String {
        let rules = allCases.map { token in
            "\(token.selectors.joined(separator: ",")){color:rgb(0,0,\(token.markerBlue))}"
        }
        return ".hljs{color:rgb(0,0,0)}" + rules.joined()
    }
}

/// One highlighted run: `range` counts `Character`s of the normalised code.
struct AedstSyntaxSpan: Equatable, Sendable {
    let range: Range<Int>
    let token: AedstSyntaxToken
}

/// Syntax highlighting for `AedstCodeBlock`, backed by HighlightSwift (highlight.js in JavaScriptCore; see
/// docs/content/library-first/apple.md). Results are cached per code + language; work runs off the main actor
/// except the HTML-to-attributed-string import, which HighlightSwift itself performs on the main actor.
actor AedstSyntaxHighlighter {
    static let shared = AedstSyntaxHighlighter()

    private struct Key: Hashable {
        let code: String
        let language: String
    }

    private static let cacheLimit = 64
    private var cache: [Key: [AttributedString]] = [:]
    private var order: [Key] = []
    #if canImport(HighlightSwift)
    private let engine = Highlight()
    #endif

    /// One attributed string per line of `code` (same split as `AedstCodeBlock.lines(of:)`), or `nil` when the
    /// language is unknown, highlighting is unavailable or fails: the caller then shows plain text.
    func highlightedLines(code: String, language: String) async -> [AttributedString]? {
        let text = AedstSyntaxHighlighter.normalised(code)
        let key = Key(code: text, language: Self.alias(for: language))
        if let hit = cache[key] { return hit }
        guard let spans = await spans(text: text, alias: key.language) else { return nil }
        let lines = Self.lines(text: text, spans: spans)
        cache[key] = lines
        order.append(key)
        if order.count > Self.cacheLimit { cache[order.removeFirst()] = nil }
        return lines
    }

    private func spans(text: String, alias: String) async -> [AedstSyntaxSpan]? {
        #if canImport(HighlightSwift)
        guard !text.isEmpty,
              let result = try? await engine.request(
                  text,
                  mode: .languageAlias(alias),
                  colors: .custom(css: AedstSyntaxToken.markerCSS)
              ),
              !result.isUndefined
        else { return nil }
        return Self.spans(from: result.attributedText)
        #else
        return nil
        #endif
    }

    // MARK: - Pure helpers (unit-tested)

    /// The language label of the header ("Swift", "C++") as a highlight.js alias.
    static func alias(for language: String) -> String {
        let lowered = language.trimmingCharacters(in: .whitespaces).lowercased()
        let aliases = ["c++": "cpp", "c#": "csharp", "objective-c": "objectivec", "shell": "bash", "sh": "bash", "golang": "go"]
        return aliases[lowered] ?? lowered
    }

    /// Windows line endings normalised and one trailing newline dropped, as `AedstCodeBlock.lines(of:)` does.
    static func normalised(_ code: String) -> String {
        var text = code.replacingOccurrences(of: "\r\n", with: "\n")
        if text.hasSuffix("\n") { text.removeLast() }
        return text
    }

    /// Token runs of an imported attributed string, read from the marker colors.
    static func spans(from attributed: AttributedString) -> [AedstSyntaxSpan] {
        var spans: [AedstSyntaxSpan] = []
        var offset = 0
        for run in attributed.runs {
            let length = attributed.characters[run.range].count
            defer { offset += length }
            guard let blue = markerBlue(of: run), let token = AedstSyntaxToken.token(forMarkerBlue: blue) else { continue }
            spans.append(AedstSyntaxSpan(range: offset..<(offset + length), token: token))
        }
        return spans
    }

    /// Splits `text` into lines and colors each run with its token's adaptive color.
    static func lines(text: String, spans: [AedstSyntaxSpan]) -> [AttributedString] {
        var result: [AttributedString] = []
        var lineStart = 0
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let lineEnd = lineStart + line.count
            var attributed = AttributedString(line)
            for span in spans where span.range.upperBound > lineStart && span.range.lowerBound < lineEnd {
                let from = max(span.range.lowerBound, lineStart) - lineStart
                let to = min(span.range.upperBound, lineEnd) - lineStart
                let start = attributed.characters.index(attributed.startIndex, offsetBy: from)
                let end = attributed.characters.index(attributed.startIndex, offsetBy: to)
                attributed[start..<end].swiftUI.foregroundColor = span.token.color
            }
            result.append(attributed)
            lineStart = lineEnd + 1 // the newline
        }
        return result
    }

    private static func markerBlue(of run: AttributedString.Runs.Run) -> Double? {
        #if canImport(UIKit)
        guard let color = run[AttributeScopes.UIKitAttributes.ForegroundColorAttribute.self] else { return nil }
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return nil }
        return Double(blue) * 255
        #elseif canImport(AppKit)
        guard let color = run[AttributeScopes.AppKitAttributes.ForegroundColorAttribute.self],
              let srgb = color.usingColorSpace(.sRGB)
        else { return nil }
        return Double(srgb.blueComponent) * 255
        #else
        return nil
        #endif
    }
}
