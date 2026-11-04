import AedstCore
import AedstDesignSystem
import AedstMedia
import SwiftUI

/// One media item: always re-fetched on open, so presigned URLs are fresh.
@MainActor
@Observable
public final class MediaDetailViewModel {
    public let mediaID: String
    public private(set) var item: MediaItem?
    /// Bound to `aedstErrorPresenter`.
    public var error: AedstError?

    private let repository: any MediaRepository

    /// Loads `mediaID` from `repository`.
    public init(mediaID: String, repository: any MediaRepository) {
        self.mediaID = mediaID
        self.repository = repository
    }

    /// Fetches the item (fresh presigned URLs).
    public func load() async {
        switch await repository.get(id: mediaID) {
        case .success(let item):
            self.item = item
        case .failure(let failure):
            error = failure
        }
    }

    /// Deletes the item; `true` on success.
    public func delete() async -> Bool {
        switch await repository.delete(id: mediaID) {
        case .success:
            return true
        case .failure(let failure):
            error = failure
            return false
        }
    }
}

/// Full-size image or the system video player.
public struct MediaDetailView: View {
    @State private var viewModel: MediaDetailViewModel
    @State private var isConfirmingDelete = false
    private let onDeleted: () -> Void

    /// `onDeleted` pops the screen.
    public init(viewModel: MediaDetailViewModel, onDeleted: @escaping () -> Void) {
        self._viewModel = State(wrappedValue: viewModel)
        self.onDeleted = onDeleted
    }

    public var body: some View {
        @Bindable var viewModel = viewModel

        VStack(spacing: AedstSpacing.md) {
            if let item = viewModel.item {
                // Explicit mask: AVPlayer video frames are not covered by the recorder's
                // text/image heuristics, and file names and failure reasons are user data.
                content(for: item)
                    .aedstSensitive()
                Text(item.filename)
                    .aedstFont(AedstTypography.caption)
                    .foregroundStyle(AedstColor.mutedForeground)
                    .aedstSensitive()
            } else {
                AedstSkeleton()
            }
        }
        .padding(AedstSpacing.lg)
        .navigationTitle(viewModel.item?.filename ?? String(localized: "mediaTitle", bundle: .module))
        .toolbar {
            ToolbarItem(placement: .destructiveAction) {
                Button(role: .destructive) {
                    isConfirmingDelete = true
                } label: {
                    Label(String(localized: "mediaDelete", bundle: .module), systemImage: "trash")
                }
            }
        }
        .confirmationDialog(
            String(localized: "mediaDeleteConfirm", bundle: .module),
            isPresented: $isConfirmingDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "mediaDelete", bundle: .module), role: .destructive) {
                Task {
                    if await viewModel.delete() { onDeleted() }
                }
            }
        }
        .aedstErrorPresenter($viewModel.error) {
            Task { await viewModel.load() }
        }
        .task { await viewModel.load() }
    }

    @ViewBuilder
    private func content(for item: MediaItem) -> some View {
        switch item.status {
        case .ready:
            if item.kind == .video, let url = item.playbackURL {
                AedstVideoPlayer(url: url)
                    .aspectRatio(16 / 9, contentMode: .fit)
            } else if item.kind == .image, let url = item.url ?? item.imageVariant(.card400)?.url {
                // Presets are fixed boxes (most crop): the uncropped detail view shows the
                // sanitized original, falling back to `card400` only without a URL.
                AedstRemoteImage(
                    url: url,
                    cacheKey: "\(item.id)/\(item.url == nil ? "card400" : "original")",
                    maxPointSize: 1_600,
                    contentMode: .fit,
                    accessibilityLabel: item.filename
                )
            } else {
                MediaThumbnailView(item: item, side: 160)
            }
        case .failed:
            AedstAlert(
                String(localized: "mediaFailed", bundle: .module),
                message: item.failureReason,
                severity: .destructive
            )
        case .pendingUpload, .processing, .unknown:
            AedstAlert(String(localized: "mediaProcessing", bundle: .module), severity: .info)
        }
    }
}
