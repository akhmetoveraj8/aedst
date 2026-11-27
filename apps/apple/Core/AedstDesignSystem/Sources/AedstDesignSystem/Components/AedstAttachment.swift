import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// shadcn/ui `AttachmentMedia` `variant`: a symbol on a muted tile, or an image filling the tile.
public enum AedstAttachmentVariant: Sendable, CaseIterable {
    case icon
    case image
}

/// shadcn/ui `Attachment` `size`: tile, padding, gaps and text size.
public enum AedstAttachmentSize: Sendable, CaseIterable {
    case `default`
    case sm
    case xs

    /// Side of the media tile in the horizontal layout (web `w-10` / `w-8` / `w-7`).
    var mediaSide: CGFloat {
        switch self {
        case .default: 40
        case .sm: 32
        case .xs: 28
        }
    }

    var spacing: CGFloat {
        switch self {
        case .default: AedstSpacing.sm
        case .sm: AedstSpacing.sm + AedstSpacing.xxs
        case .xs: AedstSpacing.xs + AedstSpacing.xxs
        }
    }

    /// Padding around the content (horizontal, vertical); web `px-2.5 py-2`, `px-2 py-1.5`, `px-1.5 py-1`.
    var padding: (horizontal: CGFloat, vertical: CGFloat) {
        switch self {
        case .default: (AedstSpacing.sm + AedstSpacing.xxs, AedstSpacing.sm)
        case .sm: (AedstSpacing.sm, AedstSpacing.xs + AedstSpacing.xxs)
        case .xs: (AedstSpacing.xs + AedstSpacing.xxs, AedstSpacing.xs)
        }
    }

    var cornerRadius: CGFloat { self == .xs ? AedstRadius.lg : AedstRadius.xl }
    var mediaCornerRadius: CGFloat { self == .xs ? AedstRadius.sm : AedstRadius.md }
    var titleFont: Font { self == .default ? AedstTypography.body : AedstTypography.caption }
}

/// shadcn/ui `Attachment` `orientation`: a chip (tile beside the text) or a card (tile above the text).
public enum AedstAttachmentOrientation: Sendable, CaseIterable {
    case horizontal
    case vertical

    /// Width of the whole attachment: chips grow from 160 pt, cards are 96 pt (120 pt with text), as on web.
    func width(hasContent: Bool) -> (min: CGFloat?, fixed: CGFloat?) {
        switch self {
        case .horizontal: (160, nil)
        case .vertical: (nil, hasContent ? 120 : 96)
        }
    }
}

/// Upload state of an attachment (web `state`): drives the border, dimming and what VoiceOver says.
public enum AedstAttachmentState: Sendable, CaseIterable {
    case idle
    case uploading
    case processing
    case error
    case done

    /// The state as an accessibility value; `nil` when there is nothing to say (idle, done).
    var accessibilityValue: String? {
        switch self {
        case .uploading: AedstStrings.attachmentUploading
        case .processing: AedstStrings.attachmentProcessing
        case .error: AedstStrings.attachmentFailed
        case .idle, .done: nil
        }
    }

    /// Image media is dimmed while the file is not ready yet.
    func dimsMedia(_ variant: AedstAttachmentVariant) -> Bool {
        variant == .image && (self == .uploading || self == .processing || self == .error)
    }

    var isBusy: Bool { self == .uploading || self == .processing }
}

/// A file attached to a message or a prompt, matching shadcn/ui `Attachment` with `AttachmentMedia`,
/// `AttachmentContent` (`AttachmentTitle`, `AttachmentDescription`), `AttachmentActions` and `AttachmentTrigger`
/// (`onOpen`). The title, description and state are one accessibility element (a button when `onOpen` is set);
/// the actions stay separate buttons. A move to `.error` is announced.
public struct AedstAttachment<Media: View, Actions: View>: View {
    private let title: String?
    private let description: String?
    private let state: AedstAttachmentState
    private let variant: AedstAttachmentVariant
    private let size: AedstAttachmentSize
    private let orientation: AedstAttachmentOrientation
    private let onOpen: (() -> Void)?
    private let media: Media
    private let actions: Actions

    /// - Parameters:
    ///   - title: File name; `nil` for a media-only tile.
    ///   - description: Size, type or the error text.
    ///   - variant: `.icon` for a symbol tile, `.image` for a thumbnail (pass an `AedstRemoteImage` or `Image`).
    ///   - onOpen: Opens or previews the file (`AttachmentTrigger`).
    ///   - media: The tile's content (`AttachmentMedia`).
    ///   - actions: Small buttons such as remove or retry (`AttachmentActions`, use `AedstAttachmentAction`).
    public init(
        _ title: String?,
        description: String? = nil,
        state: AedstAttachmentState = .done,
        variant: AedstAttachmentVariant = .icon,
        size: AedstAttachmentSize = .default,
        orientation: AedstAttachmentOrientation = .horizontal,
        onOpen: (() -> Void)? = nil,
        @ViewBuilder media: () -> Media,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.description = description
        self.state = state
        self.variant = variant
        self.size = size
        self.orientation = orientation
        self.onOpen = onOpen
        self.media = media()
        self.actions = actions()
    }

    public var body: some View {
        let width = orientation.width(hasContent: title != nil)
        layout
            .padding(.horizontal, title == nil ? size.padding.vertical : size.padding.horizontal)
            .padding(.vertical, size.padding.vertical)
            .frame(minWidth: width.min, idealWidth: width.fixed, maxWidth: width.fixed, alignment: .leading)
            .background(AedstColor.card, in: RoundedRectangle(cornerRadius: size.cornerRadius, style: .continuous))
            .foregroundStyle(AedstColor.cardForeground)
            .overlay {
                RoundedRectangle(cornerRadius: size.cornerRadius, style: .continuous)
                    .strokeBorder(
                        state == .error ? AedstColor.destructive.opacity(0.3) : AedstColor.border,
                        style: StrokeStyle(lineWidth: 1, dash: state == .idle ? [4, 3] : [])
                    )
            }
            .onChange(of: state) { _, new in
                if new == .error { AedstAnnouncer.post(AedstStrings.attachmentFailed) }
            }
    }

    @ViewBuilder private var layout: some View {
        switch orientation {
        case .horizontal:
            HStack(spacing: size.spacing) {
                mediaTile.aedstScaledFrame(width: size.mediaSide, height: size.mediaSide)
                if title != nil { text.frame(maxWidth: .infinity, alignment: .leading) }
                actions
            }
        case .vertical:
            VStack(alignment: .leading, spacing: size.spacing) {
                mediaTile.aspectRatio(1, contentMode: .fit)
                if title != nil { text.padding(.horizontal, AedstSpacing.xs) }
            }
            .overlay(alignment: .topTrailing) {
                HStack(spacing: AedstSpacing.xs) { actions }.padding(AedstSpacing.xs)
            }
        }
    }

    private var mediaTile: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size.mediaCornerRadius, style: .continuous)
                .fill(state == .error ? AedstColor.destructive.opacity(0.1) : AedstColor.muted)
            if variant == .image {
                // A thumbnail fills the square tile; a symbol keeps its own size in the middle.
                media.scaledToFill()
            } else {
                media.foregroundStyle(state == .error ? AedstColor.destructive : AedstColor.foreground)
            }
            if state.isBusy && variant == .image {
                AedstSpinner()
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: size.mediaCornerRadius, style: .continuous))
        .opacity(state.dimsMedia(variant) ? 0.6 : 1)
        .accessibilityHidden(true)
    }

    private var text: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            if let title {
                Text(title)
                    .font(size.titleFont.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .opacity(state.isBusy ? 0.6 : 1)
            }
            if let description {
                Text(description)
                    .font(AedstTypography.caption)
                    .foregroundStyle(state == .error ? AedstColor.destructive : AedstColor.mutedForeground)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(state.accessibilityValue ?? ""))
        .accessibilityAddTraits(onOpen == nil ? [] : .isButton)
        .contentShape(Rectangle())
        .onTapGesture { onOpen?() }
    }
}

extension AedstAttachment where Actions == EmptyView {
    /// An attachment without actions.
    public init(
        _ title: String?,
        description: String? = nil,
        state: AedstAttachmentState = .done,
        variant: AedstAttachmentVariant = .icon,
        size: AedstAttachmentSize = .default,
        orientation: AedstAttachmentOrientation = .horizontal,
        onOpen: (() -> Void)? = nil,
        @ViewBuilder media: () -> Media
    ) {
        self.init(
            title, description: description, state: state, variant: variant, size: size,
            orientation: orientation, onOpen: onOpen, media: media, actions: { EmptyView() }
        )
    }
}

/// A small ghost icon button for an attachment (`AttachmentAction`): remove, retry, download.
public struct AedstAttachmentAction: View {
    private let systemImage: String
    private let accessibilityLabel: String
    private let action: () -> Void

    /// - Parameter accessibilityLabel: Already localized, e.g. "Remove photo.jpg".
    public init(systemImage: String, accessibilityLabel: String, action: @escaping () -> Void) {
        self.systemImage = systemImage
        self.accessibilityLabel = accessibilityLabel
        self.action = action
    }

    public var body: some View {
        AedstIconButton(systemImage: systemImage, accessibilityLabel: accessibilityLabel, size: .iconXs, action: action)
    }
}

/// A horizontally scrolling, snapping row of attachments (`AttachmentGroup`).
public struct AedstAttachmentGroup<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: AedstSpacing.md) { content }
                .scrollTargetLayout()
                .padding(.vertical, AedstSpacing.xs)
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.viewAligned)
    }
}

#Preview("AedstAttachment") {
    VStack(alignment: .leading, spacing: AedstSpacing.lg) {
        AedstAttachment("report.pdf", description: "2.4 MB") {
            Image(systemName: "doc.text")
        } actions: {
            AedstAttachmentAction(systemImage: "xmark", accessibilityLabel: "Remove report.pdf") {}
        }
        AedstAttachment("upload.zip", description: "Uploading", state: .uploading, size: .sm) {
            AedstSpinner()
        }
        AedstAttachment("broken.png", description: "Upload failed", state: .error, size: .xs) {
            Image(systemName: "exclamationmark.triangle")
        }
        AedstAttachmentGroup {
            ForEach(0..<4, id: \.self) { index in
                AedstAttachment("photo-\(index).jpg", variant: .image, orientation: .vertical) {
                    Image(systemName: "photo")
                }
            }
        }
    }
    .padding()
}

#endif
