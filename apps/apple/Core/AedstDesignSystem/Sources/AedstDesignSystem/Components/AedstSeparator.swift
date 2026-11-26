import SwiftUI

/// Thin rule matching the `border` token — a styled `Divider` so every
/// separator in the app shares one color/thickness instead of relying on
/// the system default.
public struct AedstSeparator: View {
    public enum Orientation {
        case horizontal
        case vertical
    }

    private let orientation: Orientation

    public init(_ orientation: Orientation = .horizontal) {
        self.orientation = orientation
    }

    public var body: some View {
        let size = Self.frame(for: orientation)
        Rectangle()
            .fill(AedstColor.border)
            .frame(width: size.width, height: size.height)
            .accessibilityHidden(true)
    }

    /// A 1 pt hairline across the main axis; the other dimension follows the container.
    static func frame(for orientation: Orientation) -> (width: CGFloat?, height: CGFloat?) {
        switch orientation {
        case .horizontal: (nil, 1)
        case .vertical: (1, nil)
        }
    }
}

#Preview("AedstSeparator") {
    VStack {
        Text("Above") // i18n-ok: preview
        AedstSeparator()
        Text("Below") // i18n-ok: preview
        HStack {
            Text("Left") // i18n-ok: preview
            AedstSeparator(.vertical).frame(height: 20)
            Text("Right") // i18n-ok: preview
        }
    }
    .padding()
}
