import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// A failed tool call, matching the web `AiStackTrace`: a line with the error (always the error status) that
/// opens, by default, into the full error (`AedstAiStackTraceError`) and the frames (`AedstAiStackTraceFrames`).
/// Parse `error.stack` with `AedstAiStackTraceParser.parse`.
public struct AedstAiStackTrace<Content: View>: View {
    private let title: String
    private let systemImage: String
    private let statusLabel: String?
    private let initiallyExpanded: Bool
    private let content: Content

    /// - Parameter title: The error as the title, e.g. "Failed: TypeError ..." (truncated on the line).
    public init(
        _ title: String,
        systemImage: String = "terminal",
        statusLabel: String? = AedstTraceStatusLabels.localized.error,
        initiallyExpanded: Bool = true,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.statusLabel = statusLabel
        self.initiallyExpanded = initiallyExpanded
        self.content = content()
    }

    public var body: some View {
        AedstAiChainOfThought(initiallyExpanded: initiallyExpanded) {
            AedstAiStackTraceHeader(title, systemImage: systemImage, statusLabel: statusLabel)
        } content: {
            content
        }
    }
}

/// The error line of the trace; always the error status.
public struct AedstAiStackTraceHeader: View {
    private let title: String
    private let systemImage: String
    private let statusLabel: String?

    public init(_ title: String, systemImage: String = "terminal", statusLabel: String? = nil) {
        self.title = title
        self.systemImage = systemImage
        self.statusLabel = statusLabel
    }

    public var body: some View {
        AedstAiChainOfThoughtHeader(title, systemImage: systemImage, status: .error, statusLabel: statusLabel)
    }
}

/// The full error line (the header truncates, this does not): monospaced, destructive, left-to-right, selectable.
public struct AedstAiStackTraceError: View {
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(AedstTypography.caption.monospaced())
            .foregroundStyle(AedstColor.destructive)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
            .environment(\.layoutDirection, .leftToRight)
    }
}

/// App frames first, each a link when `frameURL` returns one; dependency frames folded into one collapsible line
/// of their own with a code block (copyable).
public struct AedstAiStackTraceFrames: View {
    private let frames: [AedstAiStackFrame]
    private let internalFramesLabel: String
    private let frameURL: ((AedstAiStackFrame) -> URL?)?

    /// - Parameters:
    ///   - internalFramesLabel: Title of the folded dependency frames, e.g. "4 framework frames".
    ///   - frameURL: Turns an app frame into a link (open the file at the line).
    public init(
        frames: [AedstAiStackFrame],
        internalFramesLabel: String,
        frameURL: ((AedstAiStackFrame) -> URL?)? = nil
    ) {
        self.frames = frames
        self.internalFramesLabel = internalFramesLabel
        self.frameURL = frameURL
    }

    public var body: some View {
        let split = AedstAiStackTraceLogic.split(frames)
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            VStack(alignment: .leading, spacing: AedstSpacing.none) {
                // Frames can repeat (recursion), so the position is the identity.
                ForEach(Array(split.app.enumerated()), id: \.offset) { _, frame in
                    if let url = frameURL?(frame) {
                        Link(destination: url) { AedstAiStackFrameRow(frame: frame) }
                            .buttonStyle(.plain)
                    } else {
                        AedstAiStackFrameRow(frame: frame)
                    }
                }
            }
            .environment(\.layoutDirection, .leftToRight)
            if !split.dependency.isEmpty {
                AedstAiChainOfThought {
                    AedstAiChainOfThoughtHeader(internalFramesLabel, systemImage: "square.3.layers.3d")
                } content: {
                    AedstCodeBlock(
                        split.dependency.map(\.raw).joined(separator: "\n"), showsWrapToggle: false, highlightsSyntax: false
                    )
                    .frame(maxHeight: AedstAiToolLayout.maxCodeHeight)
                }
            }
        }
    }
}

/// One frame: icon, function name and `file:line`, read as one element.
private struct AedstAiStackFrameRow: View {
    let frame: AedstAiStackFrame

    var body: some View {
        HStack(spacing: AedstSpacing.sm) {
            Image(systemName: "doc.text")
                .accessibilityHidden(true)
            if let file = frame.file {
                if let functionName = frame.functionName {
                    Text(functionName)
                        .foregroundStyle(AedstColor.foreground)
                        .lineLimit(1)
                        .fixedSize()
                }
                Text(AedstAiStackTraceLogic.location(file: file, line: frame.line))
                    .lineLimit(1)
                    .truncationMode(.head)
            } else {
                Text(frame.raw)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: AedstSpacing.none)
        }
        .font(AedstTypography.caption.monospaced())
        .foregroundStyle(AedstColor.mutedForeground)
        .padding(.horizontal, AedstSpacing.sm)
        .padding(.vertical, AedstSpacing.xs + AedstSpacing.xxs)
        .frame(minHeight: AedstSpacing.xxxl)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Pure helpers of the frames list, unit-tested.
enum AedstAiStackTraceLogic {
    static func split(_ frames: [AedstAiStackFrame]) -> (app: [AedstAiStackFrame], dependency: [AedstAiStackFrame]) {
        (frames.filter { !$0.isInternal }, frames.filter(\.isInternal))
    }

    /// "src/app.ts:12", or the file alone without a line.
    static func location(file: String, line: Int?) -> String {
        guard let line else { return file }
        return "\(file):\(line)"
    }
}

#Preview("AedstAiStackTrace") {
    let parsed = AedstAiStackTraceParser.parse(
        """
        TypeError: Cannot read properties of undefined (reading 'map')
            at renderList (src/ui/list.tsx:42:17)
            at App (src/app.tsx:12:3)
            at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:16305:18)
            at node:internal/process/task_queues:95:5
        """
    )
    AedstAiStackTrace("Failed: \(parsed.error)") {
        AedstAiStackTraceError(parsed.error)
        AedstAiStackTraceFrames(frames: parsed.frames, internalFramesLabel: "2 framework frames")
    }
    .padding()
}

#endif
