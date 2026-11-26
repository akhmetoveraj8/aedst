#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif
@testable import AedstDesignSystem

@MainActor
@Suite("AedstCodeBlock")
struct AedstCodeBlockTests {
    @Test("lines are numbered from 1 and empty lines are kept")
    func numbersLines() {
        let lines = AedstCodeBlock.lines(of: "a\n\nb")
        #expect(lines.map(\.number) == [1, 2, 3])
        #expect(lines.map(\.text) == ["a", "", "b"])
    }

    @Test("one trailing newline is not an extra line")
    func dropsFinalNewline() {
        #expect(AedstCodeBlock.lines(of: "a\nb\n").map(\.text) == ["a", "b"])
        #expect(AedstCodeBlock.lines(of: "a\n\n").map(\.text) == ["a", ""])
    }

    @Test("Windows line endings are normalised")
    func normalisesLineEndings() {
        #expect(AedstCodeBlock.lines(of: "a\r\nb\r\n").map(\.text) == ["a", "b"])
    }

    @Test("empty code is one empty line")
    func emptyCode() {
        #expect(AedstCodeBlock.lines(of: "") == [AedstCodeBlock.Line(number: 1, text: "")])
    }

    @Test("the highlighter normalises code exactly like the line split")
    func highlighterSplitMatches() {
        let code = "a\r\n\r\nb\n"
        let normalised = AedstSyntaxHighlighter.normalised(code)
        let lines = AedstSyntaxHighlighter.lines(text: normalised, spans: [])
        #expect(lines.map { String($0.characters) } == AedstCodeBlock.lines(of: code).map(\.text))
    }

    @Test("header language labels map to highlight.js aliases")
    func aliases() {
        #expect(AedstSyntaxHighlighter.alias(for: "Swift") == "swift")
        #expect(AedstSyntaxHighlighter.alias(for: "C++") == "cpp")
        #expect(AedstSyntaxHighlighter.alias(for: " TypeScript ") == "typescript")
        #expect(AedstSyntaxHighlighter.alias(for: "Shell") == "bash")
    }

    @Test("each token has its own marker, and markers decode back to the token")
    func markers() {
        let blues = AedstSyntaxToken.allCases.map(\.markerBlue)
        #expect(Set(blues).count == AedstSyntaxToken.allCases.count)
        #expect(blues.allSatisfy { $0 > 0 && $0 <= 255 })
        for token in AedstSyntaxToken.allCases {
            #expect(AedstSyntaxToken.token(forMarkerBlue: Double(token.markerBlue)) == token)
            // A colour-space round trip may move a channel by a few units; the nearest marker still wins.
            #expect(AedstSyntaxToken.token(forMarkerBlue: Double(token.markerBlue) + 5) == token)
        }
        #expect(AedstSyntaxToken.token(forMarkerBlue: 0) == nil)
        #expect(AedstSyntaxToken.markerCSS.contains(".hljs-keyword"))
    }

    @Test("spans crossing a line break are split across both lines and colored with the token")
    func spansAcrossLines() {
        // "/* a\nb */" is one comment run over characters 0..<9.
        let text = "/* a\nb */ x"
        let lines = AedstSyntaxHighlighter.lines(text: text, spans: [AedstSyntaxSpan(range: 0..<9, token: .comment)])
        #expect(lines.count == 2)
        let first = lines[0]
        #expect(first.runs.allSatisfy { first[$0.range].swiftUI.foregroundColor == AedstColor.syntaxComment })
        let second = lines[1]
        let colored = second.runs.filter { second[$0.range].swiftUI.foregroundColor == AedstColor.syntaxComment }
        #expect(colored.map { String(second[$0.range].characters) } == ["b */"])
    }

    @Test("an imported run's marker colour becomes a token span")
    func spansFromRuns() {
        var attributed = AttributedString("let x")
        let keyword = attributed.range(of: "let")!
        #if canImport(UIKit)
        attributed[keyword].uiKit.foregroundColor = UIColor(red: 0, green: 0, blue: CGFloat(AedstSyntaxToken.keyword.markerBlue) / 255, alpha: 1)
        #elseif canImport(AppKit)
        attributed[keyword].appKit.foregroundColor = NSColor(srgbRed: 0, green: 0, blue: CGFloat(AedstSyntaxToken.keyword.markerBlue) / 255, alpha: 1)
        #endif
        #expect(AedstSyntaxHighlighter.spans(from: attributed) == [AedstSyntaxSpan(range: 0..<3, token: .keyword)])
    }
}
#endif
