import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Code display (AEDST kit component, web `code-block`): optional header (file name, language, wrap toggle,
/// copy button), line numbers and line emphasis. The code is always laid out left-to-right, also in
/// right-to-left locales, and scrolls horizontally unless wrapped. With a `language` the code is
/// syntax-highlighted in the `AedstColor.syntax*` tokens (HighlightSwift, computed off the main actor and cached
/// per code and language); an unknown language or a failure shows plain text.
///
/// Copying writes to the system pasteboard (`UIPasteboard` / `NSPasteboard`) and announces "Copied".
public struct AedstCodeBlock: View {
    /// One line of code with its 1-based number.
    struct Line: Identifiable, Equatable, Sendable {
        let number: Int
        let text: String
        var id: Int { number }
    }

    private let code: String
    private let filename: String?
    private let language: String?
    private let showsLineNumbers: Bool
    private let highlightedLines: Set<Int>
    private let showsWrapToggle: Bool
    private let showsCopyButton: Bool
    private let highlightsSyntax: Bool
    private let onCopy: (() -> Void)?
    @State private var highlighted: (code: String, lines: [AttributedString])?
    @State private var wraps: Bool
    @State private var copyCount = 0
    @State private var isCopied = false

    /// - Parameters:
    ///   - code: The source text.
    ///   - filename: Shown in the header, always left-to-right.
    ///   - language: Language label for the header; also selects the highlighter grammar ("Swift", "TypeScript").
    ///   - highlightedLines: 1-based numbers of the lines to emphasize.
    ///   - wrapsByDefault: Initial state of the wrap toggle.
    ///   - highlightsSyntax: Colors the code by token kind when `language` is known.
    ///   - onCopy: Called after the code was written to the pasteboard (analytics, a toast).
    public init(
        _ code: String,
        filename: String? = nil,
        language: String? = nil,
        showsLineNumbers: Bool = false,
        highlightedLines: Set<Int> = [],
        wrapsByDefault: Bool = false,
        showsWrapToggle: Bool = true,
        showsCopyButton: Bool = true,
        highlightsSyntax: Bool = true,
        onCopy: (() -> Void)? = nil
    ) {
        self.code = code
        self.filename = filename
        self.language = language
        self.showsLineNumbers = showsLineNumbers
        self.highlightedLines = highlightedLines
        self.showsWrapToggle = showsWrapToggle
        self.showsCopyButton = showsCopyButton
        self.highlightsSyntax = highlightsSyntax
        self.onCopy = onCopy
        self._wraps = State(initialValue: wrapsByDefault)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            if hasHeader {
                header
                AedstSeparator()
            }
            Group {
                if wraps {
                    lineStack
                } else {
                    ScrollView(.horizontal) {
                        lineStack
                    }
                    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                }
            }
            .padding(.vertical, AedstSpacing.md)
            // Code is left-to-right whatever the interface language is.
            .environment(\.layoutDirection, .leftToRight)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(filename ?? AedstStrings.code))
        }
        .background(AedstColor.card)
        .foregroundStyle(AedstColor.cardForeground)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.lg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AedstRadius.lg, style: .continuous)
                .strokeBorder(AedstColor.border, lineWidth: 1)
        }
        .task(id: copyCount) {
            // Show the check mark for two seconds after each copy; a new copy restarts the wait.
            guard copyCount > 0 else { return }
            isCopied = true
            try? await Task.sleep(for: .seconds(2))
            if !Task.isCancelled { isCopied = false }
        }
        .task(id: HighlightRequest(code: code, language: highlightsSyntax ? language : nil)) {
            highlighted = nil
            guard highlightsSyntax, let language else { return }
            let lines = await AedstSyntaxHighlighter.shared.highlightedLines(code: code, language: language)
            if !Task.isCancelled, let lines { highlighted = (code, lines) }
        }
    }

    /// Identity of one highlighting job: a new code or language restarts it.
    private struct HighlightRequest: Equatable {
        let code: String
        let language: String?
    }

    /// The highlighted line when the highlighter delivered one for every line, else the plain text.
    private func lineText(_ line: Line) -> Text {
        // Only lines of the code they were computed for: a new `code` shows plain text until its job finishes.
        if let highlighted, highlighted.code == code, highlighted.lines.indices.contains(line.number - 1), !line.text.isEmpty {
            return Text(highlighted.lines[line.number - 1])
        }
        // An empty line still needs the height of one line.
        return Text(verbatim: line.text.isEmpty ? " " : line.text)
    }

    private var hasHeader: Bool {
        filename != nil || language != nil || showsWrapToggle || showsCopyButton
    }

    private var codeFont: Font { AedstTypography.caption.monospaced() }

    private var header: some View {
        HStack(spacing: AedstSpacing.sm) {
            if let filename {
                Text(filename)
                    .font(codeFont.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .environment(\.layoutDirection, .leftToRight)
            }
            if let language {
                Text(language)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.mutedForeground)
            }
            Spacer(minLength: AedstSpacing.none)
            if showsWrapToggle {
                AedstIconButton(
                    systemImage: "text.word.spacing",
                    accessibilityLabel: AedstStrings.wrapLines,
                    variant: wraps ? .secondary : .ghost,
                    size: .iconSm
                ) {
                    wraps.toggle()
                }
                .accessibilityAddTraits(wraps ? .isSelected : [])
            }
            if showsCopyButton {
                AedstIconButton(
                    systemImage: isCopied ? "checkmark" : "doc.on.doc",
                    accessibilityLabel: AedstStrings.copy,
                    size: .iconSm,
                    action: { copy() }
                )
            }
        }
        .padding(.horizontal, AedstSpacing.md)
        .padding(.vertical, AedstSpacing.xs)
        .background(AedstColor.muted.opacity(0.5))
    }

    private var lineStack: some View {
        let lines = Self.lines(of: code)
        let widest = Text(verbatim: String(lines.count)).font(codeFont).monospacedDigit()
        return VStack(alignment: .leading, spacing: AedstSpacing.none) {
            ForEach(lines) { line in
                let isHighlighted = highlightedLines.contains(line.number)
                HStack(alignment: .firstTextBaseline, spacing: AedstSpacing.md) {
                    if showsLineNumbers {
                        // Sized by the widest number, so it follows Dynamic Type without a fixed width.
                        widest.hidden()
                            .overlay(alignment: .trailing) {
                                Text(verbatim: String(line.number))
                                    .font(codeFont)
                                    .monospacedDigit()
                                    .foregroundStyle(AedstColor.mutedForeground)
                            }
                            .accessibilityHidden(true)
                    }
                    lineText(line)
                        .font(codeFont)
                        .fixedSize(horizontal: !wraps, vertical: true)
                        .textSelection(.enabled)
                }
                .padding(.horizontal, AedstSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(isHighlighted ? AedstColor.muted : Color.clear)
                .overlay(alignment: .leading) {
                    if isHighlighted {
                        Rectangle().fill(AedstColor.primary).frame(width: AedstSpacing.xxs)
                    }
                }
                .accessibilityAddTraits(isHighlighted ? .isSelected : [])
            }
        }
    }

    private func copy() {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(code, forType: .string)
        #else
        UIPasteboard.general.string = code
        #endif
        copyCount += 1
        AedstAnnouncer.post(AedstStrings.copied)
        onCopy?()
    }

    /// Splits source text into numbered lines: Windows line endings are normalised, one trailing newline is
    /// dropped (a file's final newline is not an extra empty line), empty lines in the middle are kept.
    static func lines(of code: String) -> [Line] {
        var text = code.replacingOccurrences(of: "\r\n", with: "\n")
        if text.hasSuffix("\n") { text.removeLast() }
        return text
            .split(separator: "\n", omittingEmptySubsequences: false)
            .enumerated()
            .map { Line(number: $0.offset + 1, text: String($0.element)) }
    }
}

#Preview("AedstCodeBlock") {
    let code = """
    import SwiftUI

    struct ContentView: View {
        var body: some View {
            AedstButton(title) {}
        }
    }
    """
    return VStack(spacing: AedstSpacing.lg) {
        AedstCodeBlock(code, filename: "ContentView.swift", language: "Swift", showsLineNumbers: true, highlightedLines: [5])
        AedstCodeBlock("let total = items.reduce(0, +) // sum", language: "Swift", showsWrapToggle: false)
        AedstCodeBlock("pnpm --dir packages/design-tokens build", showsWrapToggle: false)
    }
    .padding()
}

#endif
