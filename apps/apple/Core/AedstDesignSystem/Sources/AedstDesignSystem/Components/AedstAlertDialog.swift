import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// shadcn/ui `AlertDialogContent` `size`.
///
/// - `default`: up to 384 pt wide; in a regular-width window the header is leading-aligned and the actions sit in
///   one end-aligned row; in a compact window everything is centred and the actions stack, confirm on top.
/// - `sm`: up to 320 pt wide, always centred, the two actions side by side in equal columns.
public enum AedstAlertDialogSize: Sendable, CaseIterable {
    case `default`
    case sm

    /// Widest the dialog card gets (web `max-w-sm` / `max-w-xs`).
    var maxWidth: CGFloat {
        switch self {
        case .default: 384
        case .sm: 320
        }
    }

    /// Alignment of the media, title and description.
    func headerAlignment(isCompact: Bool) -> HorizontalAlignment {
        self == .default && !isCompact ? .leading : .center
    }

    /// How the cancel and confirm buttons are laid out.
    func actionLayout(isCompact: Bool) -> AedstAlertDialogActionLayout {
        switch self {
        case .sm: .columns
        case .default: isCompact ? .stacked : .row
        }
    }
}

/// Arrangement of an alert dialog's two actions (derived from `AedstAlertDialogSize` and the window width).
enum AedstAlertDialogActionLayout: Sendable {
    /// Full-width buttons, confirm above cancel (web `flex-col-reverse`).
    case stacked
    /// One row at the trailing edge, cancel then confirm.
    case row
    /// Two equal columns, cancel then confirm.
    case columns
}

/// The card of an alert dialog: optional media symbol, title, description and the two actions on a muted footer.
private struct AedstAlertDialogCard: View {
    let size: AedstAlertDialogSize
    let systemImage: String?
    let title: String
    let message: String?
    let confirmTitle: String
    let cancelTitle: String
    let isDestructive: Bool
    let onCancel: () -> Void
    let onConfirm: () -> Void

    #if os(macOS)
    // A macOS window is never a phone-width layout.
    private var isCompact: Bool { false }
    #else
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var isCompact: Bool { sizeClass == .compact }
    #endif

    var body: some View {
        let alignment = size.headerAlignment(isCompact: isCompact)
        VStack(spacing: AedstSpacing.none) {
            VStack(alignment: alignment, spacing: AedstSpacing.xs) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(AedstTypography.title)
                        .frame(width: 40, height: 40)
                        .background(AedstColor.muted, in: RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(AedstTypography.headline)
                    .accessibilityAddTraits(.isHeader)
                if let message {
                    Text(message)
                        .font(AedstTypography.body)
                        .foregroundStyle(AedstColor.mutedForeground)
                }
            }
            .multilineTextAlignment(alignment == .leading ? .leading : .center)
            .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .center)
            .padding(AedstSpacing.lg)

            actions
                .padding(AedstSpacing.lg)
                .frame(maxWidth: .infinity)
                .background(AedstColor.muted.opacity(0.5))
                .overlay(alignment: .top) { AedstSeparator() }
        }
        .foregroundStyle(AedstColor.popoverForeground)
        .background(AedstColor.popover)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.xl, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AedstRadius.xl, style: .continuous)
                .strokeBorder(AedstColor.border, lineWidth: 1)
        }
        .frame(maxWidth: size.maxWidth)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }

    @ViewBuilder private var actions: some View {
        switch size.actionLayout(isCompact: isCompact) {
        case .stacked:
            VStack(spacing: AedstSpacing.sm) {
                confirmButton(fillsWidth: true)
                cancelButton(fillsWidth: true)
            }
        case .row:
            HStack(spacing: AedstSpacing.sm) {
                Spacer(minLength: AedstSpacing.none)
                cancelButton(fillsWidth: false)
                confirmButton(fillsWidth: false)
            }
        case .columns:
            HStack(spacing: AedstSpacing.sm) {
                cancelButton(fillsWidth: true)
                confirmButton(fillsWidth: true)
            }
        }
    }

    private func cancelButton(fillsWidth: Bool) -> some View {
        AedstButton(cancelTitle, variant: .outline, fillsWidth: fillsWidth, action: onCancel)
            .keyboardShortcut(.cancelAction)
    }

    private func confirmButton(fillsWidth: Bool) -> some View {
        AedstButton(confirmTitle, variant: isDestructive ? .destructive : .default, fillsWidth: fillsWidth, action: onConfirm)
            .keyboardShortcut(.defaultAction)
    }
}

/// Confirmation dialog matching shadcn/ui `AlertDialog` (with `AlertDialogMedia` as an optional SF Symbol): a
/// modal card that only closes through its two buttons (or Escape, which cancels). iOS and visionOS present it
/// centred over a blurred backdrop; macOS as a window-modal sheet.
public struct AedstAlertDialogModifier: ViewModifier {
    @Binding private var isPresented: Bool
    private let title: String
    private let message: String?
    private let systemImage: String?
    private let confirmTitle: String
    private let cancelTitle: String
    private let isDestructive: Bool
    private let size: AedstAlertDialogSize
    private let onConfirm: () -> Void

    public init(
        isPresented: Binding<Bool>,
        title: String,
        message: String? = nil,
        systemImage: String? = nil,
        confirmTitle: String = AedstCommonStrings.continueAction,
        cancelTitle: String = AedstCommonStrings.cancel,
        isDestructive: Bool = false,
        size: AedstAlertDialogSize = .default,
        onConfirm: @escaping () -> Void
    ) {
        self._isPresented = isPresented
        self.title = title
        self.message = message
        self.systemImage = systemImage
        self.confirmTitle = confirmTitle
        self.cancelTitle = cancelTitle
        self.isDestructive = isDestructive
        self.size = size
        self.onConfirm = onConfirm
    }

    private var card: some View {
        AedstAlertDialogCard(
            size: size,
            systemImage: systemImage,
            title: title,
            message: message,
            confirmTitle: confirmTitle,
            cancelTitle: cancelTitle,
            isDestructive: isDestructive,
            onCancel: { isPresented = false },
            onConfirm: {
                isPresented = false
                onConfirm()
            }
        )
        .interactiveDismissDisabled()
    }

    public func body(content: Content) -> some View {
        #if os(macOS)
        content.sheet(isPresented: $isPresented) {
            card.padding(AedstSpacing.lg).presentationSizing(.fitted)
        }
        #else
        content.fullScreenCover(isPresented: $isPresented) {
            card
                .padding(AedstSpacing.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.ultraThinMaterial)
                .presentationBackground(.clear)
        }
        #endif
    }
}

extension View {
    /// Presents a confirmation dialog with a cancel and a confirm action (see `AedstAlertDialogModifier`).
    public func aedstAlertDialog(
        isPresented: Binding<Bool>,
        title: String,
        message: String? = nil,
        systemImage: String? = nil,
        confirmTitle: String = AedstCommonStrings.continueAction,
        cancelTitle: String = AedstCommonStrings.cancel,
        isDestructive: Bool = false,
        size: AedstAlertDialogSize = .default,
        onConfirm: @escaping () -> Void
    ) -> some View {
        modifier(
            AedstAlertDialogModifier(
                isPresented: isPresented,
                title: title,
                message: message,
                systemImage: systemImage,
                confirmTitle: confirmTitle,
                cancelTitle: cancelTitle,
                isDestructive: isDestructive,
                size: size,
                onConfirm: onConfirm
            )
        )
    }
}

#Preview("AedstAlertDialog") {
    @Previewable @State var isPresented = true
    AedstButton("Delete account", variant: .destructive) { isPresented = true }
        .aedstAlertDialog(
            isPresented: $isPresented,
            title: "Are you sure?",
            message: "This action cannot be undone.",
            confirmTitle: "Delete",
            isDestructive: true
        ) {}
        .padding()
}

#Preview("AedstAlertDialog — Small") {
    @Previewable @State var isPresented = true
    AedstButton("Allow accessory") { isPresented = true }
        .aedstAlertDialog(
            isPresented: $isPresented,
            title: "Allow accessory to connect?",
            message: "Do you want to allow the USB accessory to connect to this device?",
            systemImage: "cable.connector",
            confirmTitle: "Allow",
            cancelTitle: "Don't allow",
            size: .sm
        ) {}
        .padding()
}

#endif
