import SwiftUI

/// `.alert()`/`.confirmationDialog()` wrapper matching shadcn/ui
/// `AlertDialog` — a `ViewModifier` so call sites attach it like any native
/// modifier instead of managing presentation state themselves.
public struct AedstAlertDialogModifier: ViewModifier {
    @Binding private var isPresented: Bool
    private let title: String
    private let message: String?
    private let confirmTitle: String
    private let cancelTitle: String
    private let isDestructive: Bool
    private let onConfirm: () -> Void

    public init(
        isPresented: Binding<Bool>,
        title: String,
        message: String? = nil,
        confirmTitle: String = "Continue",
        cancelTitle: String = "Cancel",
        isDestructive: Bool = false,
        onConfirm: @escaping () -> Void
    ) {
        self._isPresented = isPresented
        self.title = title
        self.message = message
        self.confirmTitle = confirmTitle
        self.cancelTitle = cancelTitle
        self.isDestructive = isDestructive
        self.onConfirm = onConfirm
    }

    public func body(content: Content) -> some View {
        content.alert(title, isPresented: $isPresented) {
            Button(cancelTitle, role: .cancel) {}
            Button(confirmTitle, role: isDestructive ? .destructive : nil, action: onConfirm)
        } message: {
            if let message {
                Text(message)
            }
        }
    }
}

extension View {
    public func aedstAlertDialog(
        isPresented: Binding<Bool>,
        title: String,
        message: String? = nil,
        confirmTitle: String = "Continue",
        cancelTitle: String = "Cancel",
        isDestructive: Bool = false,
        onConfirm: @escaping () -> Void
    ) -> some View {
        modifier(
            AedstAlertDialogModifier(
                isPresented: isPresented,
                title: title,
                message: message,
                confirmTitle: confirmTitle,
                cancelTitle: cancelTitle,
                isDestructive: isDestructive,
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
