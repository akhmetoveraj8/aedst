import SwiftUI

/// Keyboard key cap matching shadcn/ui `Kbd`: shows a key or a shortcut such as `⌘K`.
///
/// Key names are symbols or identifiers, not prose, so they are shown verbatim and never localized. Pass
/// `accessibilityLabel` when the glyphs do not read well aloud ("Command K").
public struct AedstKbd: View {
    private let keys: [String]
    private let accessibilityLabel: String?

    /// One key cap.
    public init(_ key: String, accessibilityLabel: String? = nil) {
        self.keys = [key]
        self.accessibilityLabel = accessibilityLabel
    }

    /// A shortcut: one cap per key, in the order given (shadcn/ui `KbdGroup`).
    public init(keys: [String], accessibilityLabel: String? = nil) {
        self.keys = keys
        self.accessibilityLabel = accessibilityLabel
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            ForEach(Array(keys.enumerated()), id: \.offset) { _, key in
                Text(verbatim: key)
                    .font(Font.system(.caption, design: .monospaced).weight(.medium))
                    .foregroundStyle(AedstColor.mutedForeground)
                    .padding(.horizontal, AedstSpacing.xs)
                    .padding(.vertical, AedstSpacing.xxs)
                    .frame(minWidth: AedstSpacing.xl)
                    .background(AedstColor.muted)
                    .clipShape(RoundedRectangle(cornerRadius: AedstRadius.xs, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: AedstRadius.xs, style: .continuous)
                            .strokeBorder(AedstColor.border, lineWidth: 1)
                    }
            }
        }
        // Shortcuts are written left to right in every locale.
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityLabel ?? keys.joined(separator: " ")))
    }
}

#Preview("AedstKbd") {
    VStack(alignment: .leading, spacing: AedstSpacing.sm) {
        AedstKbd("Esc")
        AedstKbd(keys: ["\u{2318}", "K"], accessibilityLabel: "Command K")
        AedstKbd(keys: ["Ctrl", "Shift", "P"])
    }
    .padding()
}
