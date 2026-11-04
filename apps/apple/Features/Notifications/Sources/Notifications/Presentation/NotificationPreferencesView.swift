import AedstCore
import AedstDesignSystem
import SwiftUI

/// Delivery preferences. Each toggle saves immediately and rolls back if the
/// server rejects it. Turning push on also asks for OS permission.
@MainActor
@Observable
public final class NotificationPreferencesViewModel {
    public private(set) var preferences: NotificationPreferences?
    public private(set) var isSaving = false
    /// Bound to `aedstErrorPresenter`.
    public var error: AedstError?

    private let repository: any NotificationsRepository
    private let push: PushCoordinator

    /// Uses `push` to request OS permission when push is enabled.
    public init(repository: any NotificationsRepository, push: PushCoordinator) {
        self.repository = repository
        self.push = push
    }

    /// Loads the current preferences.
    public func load() async {
        switch await repository.preferences() {
        case .success(let preferences):
            self.preferences = preferences
        case .failure(let failure):
            error = failure
        }
    }

    /// Applies one change.
    public func update(_ keyPath: WritableKeyPath<NotificationPreferences, Bool>, to value: Bool) async {
        guard var updated = preferences else { return }
        let previous = updated
        updated[keyPath: keyPath] = value
        preferences = updated
        if updated.pushEnabled, !previous.pushEnabled {
            await push.enablePush()
        }
        isSaving = true
        defer { isSaving = false }
        switch await repository.updatePreferences(updated) {
        case .success(let saved):
            preferences = saved
        case .failure(let failure):
            preferences = previous
            error = failure
        }
    }
}

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
                Section(String(localized: "notificationsPrefKinds", bundle: .module)) {
                    toggle("notificationsPrefTaskCompleted", preferences.taskCompleted, \.taskCompleted)
                    toggle("notificationsPrefTaskDueSoon", preferences.taskDueSoon, \.taskDueSoon)
                    toggle("notificationsPrefMediaReady", preferences.mediaReady, \.mediaReady)
                }
                .disabled(!preferences.pushEnabled)
            } else {
                AedstProgressView(style: .circular).frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(String(localized: "notificationsPreferences", bundle: .module))
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
            String(localized: key, bundle: .module),
            isOn: Binding(
                get: { value },
                set: { newValue in
                    Task { await viewModel.update(keyPath, to: newValue) }
                }
            )
        )
    }
}
