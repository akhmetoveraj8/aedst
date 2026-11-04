import SwiftUI

/// Shimmering placeholder matching shadcn/ui `Skeleton` — SwiftUI has no
/// native equivalent, so this animates a gradient sweep over a muted block.
public struct AedstSkeleton: View {
    private let cornerRadius: CGFloat
    @State private var isAnimating = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(cornerRadius: CGFloat = AedstRadius.sm) {
        self.cornerRadius = cornerRadius
    }

    public var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(AedstColor.muted)
            .overlay {
                LinearGradient(
                    colors: [.clear, AedstColor.background.opacity(0.4), .clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .offset(x: isAnimating ? 200 : -200)
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            }
            .onAppear {
                // Reduce Motion: a static placeholder instead of an endless shimmer.
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    isAnimating = true
                }
            }
            .accessibilityHidden(true)
    }
}

#Preview("AedstSkeleton") {
    VStack(alignment: .leading, spacing: AedstSpacing.sm) {
        AedstSkeleton(cornerRadius: AedstRadius.full).frame(width: 48, height: 48)
        AedstSkeleton().frame(width: 200, height: 16)
        AedstSkeleton().frame(width: 140, height: 16)
    }
    .padding()
}
