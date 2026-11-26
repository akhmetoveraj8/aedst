import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Pure rules of `AedstAiTerminal`, unit-tested.
enum AedstAiTerminalLogic {
    /// Controlled state first, then the user's choice; uncontrolled, it opens once output arrives while running.
    static func isOpen(controlled: Bool?, userChoice: Bool?, isStreaming: Bool, output: String) -> Bool {
        controlled ?? userChoice ?? (isStreaming && !output.isEmpty)
    }

    /// A caller status wins; otherwise the line spins while the command runs.
    static func status(explicit: AedstTraceStatus?, isStreaming: Bool) -> AedstTraceStatus? {
        explicit ?? (isStreaming ? .running : nil)
    }

    /// Keep the newest output in view only while streaming with auto-scroll on.
    static func followsOutput(autoScroll: Bool, isStreaming: Bool) -> Bool {
        autoScroll && isStreaming
    }

    /// Height of the output viewport: the content height, capped; a minimum line before the first layout pass.
    static func visibleHeight(content: CGFloat, cap: CGFloat) -> CGFloat {
        min(max(content, AedstSpacing.xxxl), cap)
    }
}

/// A shell command the agent runs, matching the web `AiTerminal`: a line with the command (`AedstAiTerminalTitle`)
/// and, beside it, a clear button (`AedstAiTerminalClearButton`, only with `onClear`), opening into the output
/// (`AedstAiTerminalContent`). Plain text output: ANSI escape codes are not interpreted (strip them on the server).
/// While running, the output is marked as updating frequently so VoiceOver does not read every chunk.
public struct AedstAiTerminal: View {
    private let title: String
    private let output: String
    private let isStreaming: Bool
    private let autoScroll: Bool
    private let status: AedstTraceStatus?
    private let systemImage: String
    private let controlled: Binding<Bool>?
    private let clearLabel: String?
    private let onClear: (() -> Void)?
    private let showsCopyButton: Bool
    @State private var userChoice: Bool?

    /// - Parameters:
    ///   - title: Worded by the caller: "Running pnpm build", "Ran pnpm build", "pnpm lint exited with code 1"
    ///     (pass `status: .error`).
    ///   - isStreaming: The command is running: the line spins and the output grows.
    ///   - autoScroll: Keep the newest output in view while streaming.
    ///   - isExpanded: Controlled open state.
    ///   - initiallyExpanded: Initial user choice; without it the panel opens once output arrives while running.
    ///   - clearLabel: Accessible name of the clear button ("Clear output"); shown only with `onClear`.
    public init(
        _ title: String,
        output: String,
        isStreaming: Bool = false,
        autoScroll: Bool = true,
        status: AedstTraceStatus? = nil,
        systemImage: String = "apple.terminal",
        isExpanded: Binding<Bool>? = nil,
        initiallyExpanded: Bool? = nil,
        clearLabel: String? = nil,
        onClear: (() -> Void)? = nil,
        showsCopyButton: Bool = true
    ) {
        self.title = title
        self.output = output
        self.isStreaming = isStreaming
        self.autoScroll = autoScroll
        self.status = status
        self.systemImage = systemImage
        self.controlled = isExpanded
        self.clearLabel = clearLabel
        self.onClear = onClear
        self.showsCopyButton = showsCopyButton
        self._userChoice = State(initialValue: initiallyExpanded)
    }

    private var openBinding: Binding<Bool> {
        Binding(
            get: {
                AedstAiTerminalLogic.isOpen(
                    controlled: controlled?.wrappedValue, userChoice: userChoice, isStreaming: isStreaming, output: output
                )
            },
            set: { next in
                userChoice = next
                controlled?.wrappedValue = next
            }
        )
    }

    public var body: some View {
        AedstAiChainOfThought(isExpanded: openBinding) {
            AedstAiTerminalTitle(
                title, status: AedstAiTerminalLogic.status(explicit: status, isStreaming: isStreaming),
                systemImage: systemImage
            )
        } actions: {
            if let onClear, let clearLabel {
                AedstAiTerminalClearButton(label: clearLabel, isDisabled: output.isEmpty, action: onClear)
            }
        } content: {
            AedstAiTerminalContent(
                output: output, isStreaming: isStreaming, autoScroll: autoScroll, showsCopyButton: showsCopyButton
            )
        }
    }
}

/// The command line of the terminal.
public struct AedstAiTerminalTitle: View {
    private let title: String
    private let status: AedstTraceStatus?
    private let systemImage: String

    public init(_ title: String, status: AedstTraceStatus? = nil, systemImage: String = "apple.terminal") {
        self.title = title
        self.status = status
        self.systemImage = systemImage
    }

    public var body: some View {
        AedstAiChainOfThoughtHeader(title, systemImage: systemImage, status: status)
    }
}

/// Icon-only clear button; disabled while there is no output.
public struct AedstAiTerminalClearButton: View {
    private let label: String
    private let isDisabled: Bool
    private let action: () -> Void

    public init(label: String, isDisabled: Bool = false, action: @escaping () -> Void) {
        self.label = label
        self.isDisabled = isDisabled
        self.action = action
    }

    public var body: some View {
        AedstIconButton(
            systemImage: "trash", accessibilityLabel: label, variant: .ghost, size: .iconSm, isDisabled: isDisabled,
            action: action
        )
    }
}

/// The output in a code block (wrapped, left-to-right, at most 16 rem high), following the newest line while
/// streaming with auto-scroll on.
public struct AedstAiTerminalContent: View {
    private let output: String
    private let isStreaming: Bool
    private let autoScroll: Bool
    private let showsCopyButton: Bool
    @State private var contentHeight: CGFloat = 0

    public init(output: String, isStreaming: Bool = false, autoScroll: Bool = true, showsCopyButton: Bool = true) {
        self.output = output
        self.isStreaming = isStreaming
        self.autoScroll = autoScroll
        self.showsCopyButton = showsCopyButton
    }

    public var body: some View {
        ScrollView {
            AedstCodeBlock(
                output,
                language: "Shell",
                wrapsByDefault: true,
                showsWrapToggle: false,
                showsCopyButton: showsCopyButton && !output.isEmpty,
                highlightsSyntax: false
            )
        }
        // As tall as the output, at most the cap (the content height comes from the scroll geometry).
        .onScrollGeometryChange(for: CGFloat.self, of: { $0.contentSize.height }, action: { _, height in
            contentHeight = height
        })
        .frame(height: AedstAiTerminalLogic.visibleHeight(content: contentHeight, cap: AedstAiToolLayout.maxCodeHeight))
        .defaultScrollAnchor(
            AedstAiTerminalLogic.followsOutput(autoScroll: autoScroll, isStreaming: isStreaming) ? .bottom : .top,
            for: .sizeChanges
        )
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(isStreaming ? .updatesFrequently : [])
    }
}

#Preview("AedstAiTerminal") {
    @Previewable @State var output = "> next build\n  Creating an optimized production build ...\n"
    VStack(alignment: .leading, spacing: AedstSpacing.md) {
        AedstAiTerminal(
            "Running pnpm build", output: output, isStreaming: true, clearLabel: "Clear output", onClear: { output = "" }
        )
        AedstAiTerminal("pnpm lint exited with code 1", output: "src/app.ts:3:1 lint/style", status: .error, initiallyExpanded: true)
    }
    .padding()
}

#endif
