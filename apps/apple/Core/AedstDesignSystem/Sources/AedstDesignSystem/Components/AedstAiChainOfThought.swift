import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Collapsible reasoning trail matching the web `AiChainOfThought`: a header line (the disclosure, an
/// `AedstCollapsible` trigger) with optional actions beside it (never inside it), and an indented panel.
///
/// This file owns the line parts every AI Element shares (`AedstAiChainOfThoughtHeader`, `...Content`, `...Steps`,
/// `...Step`), as the web file does. Controlled (`isExpanded:`) or uncontrolled (`initiallyExpanded:`).
/// Adaptation: the disclosure chevron leads the line (the kit collapsible's anatomy) instead of trailing it.
public struct AedstAiChainOfThought<Header: View, Actions: View, Content: View>: View {
    @State private var localExpanded: Bool
    private let externalExpanded: Binding<Bool>?
    private let isDisabled: Bool
    private let header: Header
    private let actions: Actions
    private let content: Content

    /// Controlled: the caller owns the open state.
    public init(
        isExpanded: Binding<Bool>,
        isDisabled: Bool = false,
        @ViewBuilder header: () -> Header,
        @ViewBuilder actions: () -> Actions,
        @ViewBuilder content: () -> Content
    ) {
        self._localExpanded = State(initialValue: isExpanded.wrappedValue)
        self.externalExpanded = isExpanded
        self.isDisabled = isDisabled
        self.header = header()
        self.actions = actions()
        self.content = content()
    }

    /// Uncontrolled: the component keeps the open state itself.
    public init(
        initiallyExpanded: Bool = false,
        isDisabled: Bool = false,
        @ViewBuilder header: () -> Header,
        @ViewBuilder actions: () -> Actions,
        @ViewBuilder content: () -> Content
    ) {
        self._localExpanded = State(initialValue: initiallyExpanded)
        self.externalExpanded = nil
        self.isDisabled = isDisabled
        self.header = header()
        self.actions = actions()
        self.content = content()
    }

    private var expanded: Binding<Bool> { externalExpanded ?? $localExpanded }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            HStack(spacing: AedstSpacing.xs) {
                AedstCollapsible(isExpanded: expanded, isDisabled: isDisabled) {
                    header
                } content: {
                    EmptyView()
                }
                actions
            }
            if expanded.wrappedValue {
                AedstAiChainOfThoughtContent { content }
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .aedstAnimation(.easeInOut(duration: AedstMotion.durationNormal), value: expanded.wrappedValue)
    }
}

extension AedstAiChainOfThought where Actions == EmptyView {
    /// Controlled line without actions.
    public init(
        isExpanded: Binding<Bool>,
        isDisabled: Bool = false,
        @ViewBuilder header: () -> Header,
        @ViewBuilder content: () -> Content
    ) {
        self.init(isExpanded: isExpanded, isDisabled: isDisabled, header: header, actions: { EmptyView() }, content: content)
    }

    /// Uncontrolled line without actions.
    public init(
        initiallyExpanded: Bool = false,
        isDisabled: Bool = false,
        @ViewBuilder header: () -> Header,
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            initiallyExpanded: initiallyExpanded, isDisabled: isDisabled, header: header, actions: { EmptyView() },
            content: content
        )
    }
}

/// The label of a line: leading icon (a running or failed `status` replaces `systemImage`), the title (truncated)
/// and a short description ("2 of 5 done", a duration). Read as one sentence with the status in words.
public struct AedstAiChainOfThoughtHeader: View {
    private let title: String
    private let systemImage: String?
    private let status: AedstTraceStatus?
    private let statusLabel: String?
    private let description: String?

    /// - Parameters:
    ///   - title: Already localized title.
    ///   - statusLabel: The status in words for VoiceOver ("Running"); not drawn, as on web.
    public init(
        _ title: String,
        systemImage: String? = nil,
        status: AedstTraceStatus? = nil,
        statusLabel: String? = nil,
        description: String? = nil
    ) {
        self.title = title
        self.systemImage = systemImage
        self.status = status
        self.statusLabel = statusLabel
        self.description = description
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.sm) {
            if let symbol = AedstAiLineLogic.leadingSymbol(status: status, systemImage: systemImage) {
                AedstAiLeadingIcon(symbol: symbol)
            }
            Text(title)
                .font(AedstTypography.body.weight(.medium))
                .foregroundStyle(AedstColor.mutedForeground)
                .lineLimit(1)
                .truncationMode(.tail)
            if let description {
                Text(description)
                    .font(AedstTypography.caption)
                    .monospacedDigit()
                    .foregroundStyle(AedstColor.mutedForeground)
                    .fixedSize()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(AedstAiLineLogic.spokenLabel(title: title, statusLabel: statusLabel, description: description))
        )
    }
}

/// Indented panel under a header, with a rule down its leading edge (mirrored in right-to-left layouts).
public struct AedstAiChainOfThoughtContent<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, AedstSpacing.md)
        .overlay(alignment: .leading) {
            AedstSeparator(.vertical)
        }
        .padding(.leading, AedstSpacing.lg)
        .padding(.top, AedstSpacing.xs)
    }
}

/// The list that holds `AedstAiChainOfThoughtStep`s.
public struct AedstAiChainOfThoughtSteps<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One step: status icon, label (muted while pending or skipped), optional description and extra content
/// (search results, an image, a file). `status` defaults to success (done).
public struct AedstAiChainOfThoughtStep<Extra: View>: View {
    private let label: String
    private let description: String?
    private let status: AedstTraceStatus
    private let systemImage: String?
    private let statusLabel: String?
    private let strikesThrough: Bool
    private let extra: Extra

    /// - Parameters:
    ///   - statusLabel: The status in words for VoiceOver; not drawn.
    ///   - strikesThrough: Draws the label struck through and muted (a completed todo).
    public init(
        _ label: String,
        description: String? = nil,
        status: AedstTraceStatus = .success,
        systemImage: String? = nil,
        statusLabel: String? = nil,
        strikesThrough: Bool = false,
        @ViewBuilder extra: () -> Extra
    ) {
        self.label = label
        self.description = description
        self.status = status
        self.systemImage = systemImage
        self.statusLabel = statusLabel
        self.strikesThrough = strikesThrough
        self.extra = extra()
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: AedstSpacing.sm) {
            if let symbol = AedstAiLineLogic.leadingSymbol(status: status, systemImage: systemImage) {
                AedstAiLeadingIcon(symbol: symbol)
            }
            VStack(alignment: .leading, spacing: AedstSpacing.xs) {
                VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                    Text(label)
                        .font(AedstTypography.body)
                        .strikethrough(strikesThrough)
                        .foregroundStyle(
                            strikesThrough || AedstAiLineLogic.isMuted(status)
                                ? AedstColor.mutedForeground : AedstColor.foreground
                        )
                    if let description {
                        Text(description)
                            .font(AedstTypography.caption)
                            .foregroundStyle(AedstColor.mutedForeground)
                    }
                }
                .multilineTextAlignment(.leading)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(
                    Text(AedstAiLineLogic.spokenLabel(title: label, statusLabel: statusLabel, description: description))
                )
                extra
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, AedstSpacing.sm)
        .padding(.vertical, AedstSpacing.xs + AedstSpacing.xxs)
    }
}

extension AedstAiChainOfThoughtStep where Extra == EmptyView {
    /// A step with text only.
    public init(
        _ label: String,
        description: String? = nil,
        status: AedstTraceStatus = .success,
        systemImage: String? = nil,
        statusLabel: String? = nil,
        strikesThrough: Bool = false
    ) {
        self.init(
            label, description: description, status: status, systemImage: systemImage, statusLabel: statusLabel,
            strikesThrough: strikesThrough, extra: { EmptyView() }
        )
    }
}

#Preview("AedstAiChainOfThought") {
    AedstAiChainOfThought(initiallyExpanded: true) {
        AedstAiChainOfThoughtHeader("Chain of thought", systemImage: "brain", description: "3 steps")
    } content: {
        AedstAiChainOfThoughtSteps {
            AedstAiChainOfThoughtStep("Searched the web", description: "4 sources") {
                AedstAiChainOfThoughtSearchResults(["swift.org", "developer.apple.com"])
            }
            AedstAiChainOfThoughtStep("Reading the release notes", status: .running, statusLabel: "Running")
            AedstAiChainOfThoughtStep("Write the answer", status: .pending, statusLabel: "Pending")
        }
    }
    .padding()
}

#endif
