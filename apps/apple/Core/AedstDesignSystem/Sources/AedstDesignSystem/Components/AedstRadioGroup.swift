import SwiftUI

/// Custom radio group — SwiftUI has no native radio control, so this draws
/// a circle-dot per option, matching shadcn/ui `RadioGroup`. Generic over
/// any `Hashable & Identifiable` option.
public struct AedstRadioGroup<Option: Hashable & Identifiable>: View {
    private let options: [Option]
    private let label: (Option) -> String
    @Binding private var selection: Option

    public init(options: [Option], selection: Binding<Option>, label: @escaping (Option) -> String) {
        self.options = options
        self._selection = selection
        self.label = label
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            ForEach(options) { option in
                Button {
                    selection = option
                } label: {
                    HStack(spacing: AedstSpacing.xs) {
                        Circle()
                            .strokeBorder(selection == option ? AedstColor.primary : AedstColor.border, lineWidth: 1.5)
                            .frame(width: 20, height: 20)
                            .overlay {
                                if selection == option {
                                    Circle()
                                        .fill(AedstColor.primary)
                                        .frame(width: 10, height: 10)
                                }
                            }
                        Text(label(option))
                            .font(AedstTypography.body)
                            .foregroundStyle(AedstColor.foreground)
                    }
                }
                #if os(macOS)
                .buttonStyle(.plain)
                #endif
                .accessibilityAddTraits(selection == option ? [.isButton, .isSelected] : .isButton)
            }
        }
    }
}

#Preview("AedstRadioGroup") {
    struct Plan: Hashable, Identifiable { let id: String; let name: String }
    let plans = [Plan(id: "free", name: "Free"), Plan(id: "pro", name: "Pro")]
    return AedstRadioGroup(options: plans, selection: .constant(plans[1])) { $0.name }
        .padding()
}
