import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Scroll direction of an `AedstScrollArea`.
public enum AedstScrollAreaAxis: Sendable, CaseIterable {
    case vertical
    case horizontal
    case both

    var axes: Axis.Set {
        switch self {
        case .vertical: .vertical
        case .horizontal: .horizontal
        case .both: [.vertical, .horizontal]
        }
    }
}

/// Scrollable region matching shadcn/ui `ScrollArea`: a thin wrapper over the native `ScrollView`, so the
/// name exists on every platform and the kit's defaults are in one place. The scroll bars are the system's
/// (overlay on iOS, the user's "Show scroll bars" setting on the Mac); content shorter than the area does
/// not bounce.
public struct AedstScrollArea<Content: View>: View {
    private let axis: AedstScrollAreaAxis
    private let showsIndicators: Bool
    private let content: Content

    /// - Parameters:
    ///   - axis: Direction(s) the content scrolls in.
    ///   - showsIndicators: `false` hides the scroll bars (a horizontal chip row, a carousel).
    public init(
        _ axis: AedstScrollAreaAxis = .vertical,
        showsIndicators: Bool = true,
        @ViewBuilder content: () -> Content
    ) {
        self.axis = axis
        self.showsIndicators = showsIndicators
        self.content = content()
    }

    public var body: some View {
        ScrollView(axis.axes) {
            content
        }
        .scrollIndicators(showsIndicators ? .automatic : .hidden)
        .scrollBounceBehavior(.basedOnSize, axes: axis.axes)
    }
}

#Preview("AedstScrollArea") {
    AedstScrollArea {
        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            ForEach(1..<30) { index in
                Text(verbatim: "v1.2.0-beta.\(index)")
                    .font(AedstTypography.caption)
                AedstSeparator()
            }
        }
        .padding()
    }
    .frame(height: 200)
    .padding()
}

#endif
