import SwiftUI

/// Marks views that render personal or user-generated data (emails, names,
/// task titles/details, search hits, notification bodies, file names) so a
/// session recorder can redact them.
///
/// Why an environment value and not a direct SDK call: only
/// `Core/AedstTelemetry` may import PostHog/Sentry. The design system and the
/// features therefore only know this SDK-free seam; the composition root
/// (`AppDependencies`) injects the real masker, whose default is identity
/// (no recorder, no cost, no behaviour change). The closure takes and returns
/// `AnyView` because a recorder's masking modifier is an SDK-specific
/// `some View` that cannot be named here; the type erasure only affects the
/// small marked subtrees (a row, a detail block), never whole screens.
///
/// This is defence in depth: PostHog replay already masks every text, text
/// input and image it can recognise (deny by default). `aedstSensitive()`
/// adds an explicit region that does not depend on recognising SwiftUI's
/// private view classes, so it keeps working if a future OS changes how
/// `Text` is drawn.
public struct AedstSensitiveContentMasker: Sendable {
    private let transform: @MainActor @Sendable (AnyView) -> AnyView
    /// `true` for `.identity`: the modifier then returns the content itself, with no `AnyView`, so SwiftUI keeps
    /// the subtree's structural identity (state, animations, diffing) when nothing records.
    let isIdentity: Bool

    /// - Parameter transform: wraps a view in the recorder's redaction.
    public init(_ transform: @escaping @MainActor @Sendable (AnyView) -> AnyView) {
        self.transform = transform
        self.isIdentity = false
    }

    private init() {
        self.transform = { $0 }
        self.isIdentity = true
    }

    /// No recorder: views pass through unchanged.
    public static let identity = AedstSensitiveContentMasker()

    @MainActor
    func apply(_ view: AnyView) -> AnyView { transform(view) }
}

extension EnvironmentValues {
    /// The active masker (`.identity` unless the app composes a recorder).
    @Entry public var aedstSensitiveContent: AedstSensitiveContentMasker = .identity
}

private struct AedstSensitiveModifier: ViewModifier {
    @Environment(\.aedstSensitiveContent) private var masker

    @ViewBuilder
    func body(content: Content) -> some View {
        if masker.isIdentity {
            content
        } else {
            masker.apply(AnyView(content))
        }
    }
}

extension View {
    /// Redacts this view in session replay (no-op when no recorder is active).
    /// Apply it to every view that shows personal or user-generated data.
    /// Static copy (screen titles, buttons, labels) does not need it.
    public func aedstSensitive() -> some View {
        modifier(AedstSensitiveModifier())
    }
}
