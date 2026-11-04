import AedstDesignSystem
import SwiftUI

/// Inbox screen. Tapping an entry marks it read and opens its link through
/// `onOpenLink` (resolved by `App/Shared`).
public struct NotificationInboxView: View {
    @State private var viewModel: NotificationInboxViewModel
    private let onOpenLink: (String) -> Void
    private let onOpenPreferences: () -> Void

    /// Creates the inbox.
    public init(
        viewModel: NotificationInboxViewModel,
        onOpenLink: @escaping (String) -> Void,
        onOpenPreferences: @escaping () -> Void
    ) {
        self._viewModel = State(wrappedValue: viewModel)
        self.onOpenLink = onOpenLink
        self.onOpenPreferences = onOpenPreferences
    }

    public var body: some View {
        @Bindable var viewModel = viewModel

        List {
            Picker(String(localized: "notificationsFilter", bundle: .module), selection: $viewModel.unreadOnly) {
                Text(String(localized: "notificationsFilterAll", bundle: .module)).tag(false)
                Text(String(localized: "notificationsFilterUnread", bundle: .module)).tag(true)
            }
            .pickerStyle(.segmented)

            if viewModel.hasLoaded, viewModel.notifications.isEmpty {
                Text(String(localized: "notificationsEmpty", bundle: .module))
                    .foregroundStyle(AedstColor.mutedForeground)
            }
            ForEach(viewModel.notifications) { notification in
                Button {
                    Task {
                        if let link = await viewModel.open(notification) { onOpenLink(link) }
                    }
                } label: {
                    NotificationRow(notification: notification)
                }
                .buttonStyle(.plain)
                .task { await viewModel.loadMoreIfNeeded(after: notification) }
            }
            if viewModel.isLoading {
                AedstProgressView(style: .circular).frame(maxWidth: .infinity)
            }
        }
        .refreshable { await viewModel.refresh() }
        .navigationTitle(String(localized: "notificationsTitle", bundle: .module))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button(String(localized: "notificationsMarkAllRead", bundle: .module)) {
                        Task { await viewModel.markAllRead() }
                    }
                    Button(String(localized: "notificationsPreferences", bundle: .module), action: onOpenPreferences)
                } label: {
                    Label(String(localized: "notificationsMore", bundle: .module), systemImage: "ellipsis.circle")
                }
            }
        }
        .aedstErrorPresenter($viewModel.error)
        .task {
            if !viewModel.hasLoaded { await viewModel.refresh() }
        }
    }
}

private struct NotificationRow: View {
    let notification: InboxNotification

    var body: some View {
        HStack(alignment: .top, spacing: AedstSpacing.md) {
            Circle()
                .fill(notification.isRead ? Color.clear : AedstColor.primary)
                .frame(width: 8, height: 8)
                .padding(.top, AedstSpacing.xs)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                Text(notification.title)
                    .aedstFont(notification.isRead ? AedstTypography.body : AedstTypography.headline)
                if !notification.body.isEmpty {
                    Text(notification.body)
                        .aedstFont(AedstTypography.caption)
                        .foregroundStyle(AedstColor.mutedForeground)
                }
                if let createdAt = notification.createdAt {
                    Text(createdAt.formatted(date: .abbreviated, time: .shortened))
                        .aedstFont(AedstTypography.caption)
                        .foregroundStyle(AedstColor.mutedForeground)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityValue(
            Text(notification.isRead ? "" : String(localized: "notificationsUnread", bundle: .module))
        )
        .aedstSensitive()
    }
}
