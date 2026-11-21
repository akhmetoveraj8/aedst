import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Form container matching shadcn/ui `Form`.
///
/// On web `Form` is the glue to React Hook Form. SwiftUI needs no such glue (state lives in the screen's
/// `@Observable` view model, which also validates), so the Apple component is a thin container: a tokenized
/// vertical stack of fields, the keyboard's submit key (`.onSubmit`) wired to one action, and an optional
/// submit button at the end. It is deliberately not the native grouped `Form` list: kit fields draw their own
/// chrome.
public struct AedstForm<Content: View>: View {
    private let submitTitle: String?
    private let isSubmitting: Bool
    private let isSubmitDisabled: Bool
    private let onSubmit: () -> Void
    private let content: Content

    /// - Parameters:
    ///   - submitTitle: Already localized title of the submit button; `nil` draws no button (the keyboard's
    ///     submit key still calls `onSubmit`).
    ///   - isSubmitting: Shows the button's spinner and blocks a second submit.
    ///   - isSubmitDisabled: The form is not valid yet: the button is disabled and the submit key does nothing.
    ///   - onSubmit: Called by the submit button and by the keyboard's submit key.
    public init(
        submitTitle: String? = nil,
        isSubmitting: Bool = false,
        isSubmitDisabled: Bool = false,
        onSubmit: @escaping () -> Void = {},
        @ViewBuilder content: () -> Content
    ) {
        self.submitTitle = submitTitle
        self.isSubmitting = isSubmitting
        self.isSubmitDisabled = isSubmitDisabled
        self.onSubmit = onSubmit
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.lg) {
            content
            if let submitTitle {
                AedstButton(
                    submitTitle,
                    isLoading: isSubmitting,
                    isDisabled: isSubmitDisabled,
                    action: { submit() }
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onSubmit { submit() }
    }

    private func submit() {
        guard !isSubmitting, !isSubmitDisabled else { return }
        onSubmit()
    }
}

#Preview("AedstForm") {
    @Previewable @State var email = ""
    @Previewable @State var note = ""
    AedstForm(submitTitle: "Send invite", isSubmitDisabled: email.isEmpty) {
        AedstTextField("Email", text: $email, placeholder: "name@example.com")
        AedstTextarea("Note", text: $note, helperText: "Optional.")
    }
    .padding()
}

#endif
