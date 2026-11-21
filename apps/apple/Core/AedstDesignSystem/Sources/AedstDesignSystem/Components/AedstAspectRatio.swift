import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Box with a fixed width-to-height ratio matching shadcn/ui `AspectRatio`. Unlike the bare
/// `aspectRatio(_:contentMode:)` modifier, which sizes the content itself, the box keeps the ratio and the
/// content fills it and is clipped to it (an image with `scaledToFill()`, a video, a map), which is how the
/// web component behaves.
public struct AedstAspectRatio<Content: View>: View {
    private let ratio: CGFloat
    private let content: Content

    /// - Parameters:
    ///   - ratio: Width divided by height (`16 / 9`, `1`).
    ///   - content: Fills the box; anything outside it is clipped.
    public init(_ ratio: CGFloat, @ViewBuilder content: () -> Content) {
        self.ratio = ratio
        self.content = content()
    }

    public var body: some View {
        Color.clear
            .aspectRatio(ratio, contentMode: .fit)
            .overlay {
                content
            }
            .clipped()
    }
}

#Preview("AedstAspectRatio") {
    AedstAspectRatio(16 / 9) {
        AedstColor.muted
            .overlay {
                Text(verbatim: "16:9")
                    .font(AedstTypography.headline)
            }
    }
    .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
    .padding()
}

#endif
