#if os(macOS)
import AedstDesignSystem
import AedstMedia
import MediaDomain
import MediaPresentation
import SwiftUI

/// All of the user's files as a grid, with upload.
public struct MediaLibraryView: View {
    @State private var viewModel: MediaCollectionViewModel
    @State private var isPickerPresented = false
    private let onOpen: (String) -> Void

    /// `onOpen` receives a media id.
    public init(viewModel: MediaCollectionViewModel, onOpen: @escaping (String) -> Void) {
        self._viewModel = State(wrappedValue: viewModel)
        self.onOpen = onOpen
    }

    public var body: some View {
        @Bindable var viewModel = viewModel

        ScrollView {
            VStack(alignment: .leading, spacing: AedstSpacing.md) {
                UploadProgressList(uploads: viewModel.uploads)
                if viewModel.hasLoaded, viewModel.items.isEmpty, viewModel.uploads.isEmpty {
                    Text(String(localized: "mediaEmpty", bundle: MediaStrings.bundle))
                        .foregroundStyle(AedstColor.mutedForeground)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: AedstSpacing.sm)], spacing: AedstSpacing.sm) {
                    ForEach(viewModel.items) { item in
                        Button {
                            onOpen(item.id)
                        } label: {
                            MediaThumbnailView(item: item, side: 104)
                        }
                        .buttonStyle(.plain)
                        .task { await viewModel.loadMoreIfNeeded(after: item) }
                    }
                }
            }
            .padding(AedstSpacing.lg)
        }
        // No pull-to-refresh on the Mac: Refresh is a toolbar button (Command-R).
        .navigationTitle(String(localized: "mediaTitle", bundle: MediaStrings.bundle))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    isPickerPresented = true
                } label: {
                    Label(String(localized: "mediaUpload", bundle: MediaStrings.bundle), systemImage: "square.and.arrow.up")
                }
            }
            ToolbarItem(placement: .secondaryAction) {
                Button {
                    Task { await viewModel.refresh() }
                } label: {
                    Label(String(localized: "mediaRefresh", bundle: MediaStrings.bundle), systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
            }
        }
        .mediaPicker(isPresented: $isPickerPresented) { files in
            Task { await viewModel.upload(files) }
        }
        .aedstErrorPresenter($viewModel.error)
        .task {
            if !viewModel.hasLoaded { await viewModel.refresh() }
        }
    }
}

/// Task-detail slot: the task's attachments plus an "Attach" button. Built by
/// the app target and handed to the Tasks detail view (features never import each other).
public struct TaskAttachmentsView: View {
    @State private var viewModel: MediaCollectionViewModel
    @State private var isPickerPresented = false
    private let onOpen: (String) -> Void

    /// `viewModel.taskID` must be set.
    public init(viewModel: MediaCollectionViewModel, onOpen: @escaping (String) -> Void) {
        self._viewModel = State(wrappedValue: viewModel)
        self.onOpen = onOpen
    }

    public var body: some View {
        @Bindable var viewModel = viewModel

        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            UploadProgressList(uploads: viewModel.uploads)
            if viewModel.hasLoaded, viewModel.items.isEmpty, viewModel.uploads.isEmpty {
                Text(String(localized: "mediaNoAttachments", bundle: MediaStrings.bundle))
                    .aedstFont(AedstTypography.caption)
                    .foregroundStyle(AedstColor.mutedForeground)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: AedstSpacing.sm) {
                    ForEach(viewModel.items) { item in
                        Button {
                            onOpen(item.id)
                        } label: {
                            MediaThumbnailView(item: item, side: 88)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            AedstButton(String(localized: "mediaAttach", bundle: MediaStrings.bundle), systemImage: "paperclip", variant: .outline, size: .sm) {
                isPickerPresented = true
            }
        }
        .mediaPicker(isPresented: $isPickerPresented) { files in
            Task { await viewModel.upload(files) }
        }
        .aedstErrorPresenter($viewModel.error)
        .task {
            if !viewModel.hasLoaded { await viewModel.refresh() }
        }
    }
}

private struct UploadProgressList: View {
    let uploads: [MediaCollectionViewModel.UploadProgress]

    var body: some View {
        ForEach(uploads) { upload in
            VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                Text(upload.filename)
                    .aedstFont(AedstTypography.caption)
                    .lineLimit(1)
                    .aedstSensitive()
                switch upload.phase {
                case .preparing:
                    AedstProgressView(label: String(localized: "mediaPreparing", bundle: MediaStrings.bundle))
                case .uploading(let fraction):
                    AedstProgressView(value: fraction, label: String(localized: "mediaUploading", bundle: MediaStrings.bundle))
                case .finishing:
                    AedstProgressView(label: String(localized: "mediaFinishing", bundle: MediaStrings.bundle))
                }
            }
        }
    }
}
#endif
