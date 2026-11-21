#if os(iOS)
import AedstCore
import AedstDesignSystem
import NotificationsDomain
import NotificationsPresentation
import SwiftUI

/// Preferences screen.
public struct NotificationPreferencesView: View {
    @State private var viewModel: NotificationPreferencesViewModel

    /// Creates the screen.
    public init(viewModel: NotificationPreferencesViewModel) {
        self._viewModel = State(wrappedValue: viewModel)
    }

    public var body: some View {
        @Bindable var viewModel = viewModel
        Form {
            if let preferences = viewModel.preferences {
                toggle("notificationsPrefPush", preferences.pushEnabled, \.pushEnabled)
                Section(String(localized: "notificationsPrefKinds", bundle: NotificationsStrings.bundle)) {
                    toggle("notificationsPrefTaskCompleted", preferences.taskCompleted, \.taskCompleted)
                    toggle("notificationsPrefTaskDueSoon", preferences.taskDueSoon, \.taskDueSoon)
                    toggle("notificationsPrefMediaReady", preferences.mediaReady, \.mediaReady)
                }
                .disabled(!preferences.pushEnabled)
            } else {
                AedstProgressView(style: .circular).frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(String(localized: "notificationsPreferences", bundle: NotificationsStrings.bundle))
        .aedstErrorPresenter($viewModel.error)
        .task { await viewModel.load() }
    }

    private func toggle(
        _ key: String.LocalizationValue,
        _ value: Bool,
        _ keyPath: WritableKeyPath<NotificationPreferences, Bool>
    ) -> some View {
        let viewModel = viewModel
        return Toggle(
            String(localized: key, bundle: NotificationsStrings.bundle),
            isOn: Binding(
                get: { value },
                set: { newValue in
                    Task { await viewModel.update(keyPath, to: newValue) }
                }
            )
        )
    }
}
#endif
