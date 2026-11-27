import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Header, body and footer of a dialog, laid out like shadcn/ui `DialogContent` (`DialogHeader` with
/// `DialogTitle` / `DialogDescription`, the content, `DialogFooter`, and the close button in the top
/// trailing corner).
private struct AedstDialogLayout<DialogContent: View, Footer: View>: View {
    let title: String
    let description: String?
    let showsCloseButton: Bool
    let dialogContent: DialogContent
    let footer: Footer

    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.lg) {
            HStack(alignment: .top, spacing: AedstSpacing.sm) {
                VStack(alignment: .leading, spacing: AedstSpacing.xs) {
                    Text(title)
                        .font(AedstTypography.headline)
                        .accessibilityAddTraits(.isHeader)
                        // VoiceOver starts on the dialog's title when it opens.
                        .aedstInitialAccessibilityFocus()
                    if let description {
                        Text(description)
                            .font(AedstTypography.caption)
                            .foregroundStyle(AedstColor.mutedForeground)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if showsCloseButton {
                    AedstIconButton(systemImage: "xmark", accessibilityLabel: AedstStrings.close, size: .iconSm) {
                        dismiss()
                    }
                    .keyboardShortcut(.cancelAction)
                }
            }

            dialogContent
                .frame(maxWidth: .infinity, alignment: .leading)

            // Actions end-aligned, the confirming one last (trailing in LTR, leading edge in RTL).
            // At accessibility text sizes the actions stack instead of being cut off.
            if AedstLayoutPolicy.prefersStackedLayout(dynamicTypeSize) {
                VStack(alignment: .trailing, spacing: AedstSpacing.sm) {
                    footer
                }
            } else {
                HStack(spacing: AedstSpacing.sm) {
                    Spacer(minLength: 0)
                    footer
                }
            }
        }
        .padding(AedstSpacing.xxl)
        .foregroundStyle(AedstColor.foreground)
        #if os(macOS)
        // A macOS sheet has no width of its own.
        .frame(minWidth: 360, idealWidth: 440, maxWidth: 560)
        #else
        .frame(maxHeight: .infinity, alignment: .top)
        #endif
        .presentationBackground(AedstColor.background)
    }
}

/// Modal dialog matching shadcn/ui `Dialog`: a `ViewModifier` over the native sheet presentation, so focus
/// trapping, the dimmed backdrop, Escape and the swipe-to-dismiss gesture are the system's.
///
/// - iPhone: a sheet that rests at half height and can be pulled to full height.
/// - iPad, visionOS: a centred form-sized card.
/// - macOS: a window-modal sheet.
///
/// For a confirmation with two buttons and no custom content use `aedstAlertDialog`.
public struct AedstDialogModifier<DialogContent: View, Footer: View>: ViewModifier {
    @Binding private var isPresented: Bool
    private let title: String
    private let description: String?
    private let showsCloseButton: Bool
    private let isDismissDisabled: Bool
    private let returnFocus: AedstFocusReturn?
    private let dialogContent: DialogContent
    private let footer: Footer

    /// - Parameters:
    ///   - title: Already localized title; also the dialog's accessibility heading.
    ///   - description: Optional text under the title.
    ///   - showsCloseButton: Shows the close button (also bound to Escape / Command-period).
    ///   - isDismissDisabled: Blocks swipe and outside-click dismissal, for a form with unsaved input.
    ///   - returnFocus: Where focus goes when it closes (the caller's trigger); see `AedstFocusReturn`.
    ///   - content: Body of the dialog.
    ///   - footer: Action buttons, in reading order, confirming action last.
    public init(
        isPresented: Binding<Bool>,
        title: String,
        description: String? = nil,
        showsCloseButton: Bool = true,
        isDismissDisabled: Bool = false,
        returnFocus: AedstFocusReturn? = nil,
        @ViewBuilder content: () -> DialogContent,
        @ViewBuilder footer: () -> Footer
    ) {
        self._isPresented = isPresented
        self.title = title
        self.description = description
        self.showsCloseButton = showsCloseButton
        self.isDismissDisabled = isDismissDisabled
        self.returnFocus = returnFocus
        self.dialogContent = content()
        self.footer = footer()
    }

    public func body(content: Content) -> some View {
        content.aedstReturnsFocus(whenPresented: isPresented, to: returnFocus).sheet(isPresented: $isPresented) {
            AedstDialogLayout(
                title: title,
                description: description,
                showsCloseButton: showsCloseButton,
                dialogContent: dialogContent,
                footer: footer
            )
            .presentationSizing(.form)
            #if os(iOS)
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.hidden)
            #endif
            .interactiveDismissDisabled(isDismissDisabled)
        }
    }
}

extension View {
    /// Presents a modal dialog with a title, custom content and action buttons.
    public func aedstDialog<Content: View, Footer: View>(
        isPresented: Binding<Bool>,
        title: String,
        description: String? = nil,
        showsCloseButton: Bool = true,
        isDismissDisabled: Bool = false,
        returnFocus: AedstFocusReturn? = nil,
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder footer: @escaping () -> Footer
    ) -> some View {
        modifier(
            AedstDialogModifier(
                isPresented: isPresented,
                title: title,
                description: description,
                showsCloseButton: showsCloseButton,
                isDismissDisabled: isDismissDisabled,
                returnFocus: returnFocus,
                content: content,
                footer: footer
            )
        )
    }

    /// Presents a modal dialog without a footer (the close button is the only way out besides the content).
    public func aedstDialog<Content: View>(
        isPresented: Binding<Bool>,
        title: String,
        description: String? = nil,
        showsCloseButton: Bool = true,
        isDismissDisabled: Bool = false,
        returnFocus: AedstFocusReturn? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        aedstDialog(
            isPresented: isPresented,
            title: title,
            description: description,
            showsCloseButton: showsCloseButton,
            isDismissDisabled: isDismissDisabled,
            returnFocus: returnFocus,
            content: content,
            footer: { EmptyView() }
        )
    }
}

#Preview("AedstDialog") {
    @Previewable @State var isPresented = true
    @Previewable @State var name = "Ada Lovelace"
    AedstButton("Edit profile", variant: .outline, fillsWidth: false) { isPresented = true }
        .aedstDialog(
            isPresented: $isPresented,
            title: "Edit profile",
            description: "Make changes to your profile here."
        ) {
            AedstTextField("Name", text: $name)
        } footer: {
            AedstButton("Cancel", variant: .outline, fillsWidth: false) { isPresented = false }
            AedstButton("Save changes", fillsWidth: false) { isPresented = false }
        }
        .padding()
}

#endif
