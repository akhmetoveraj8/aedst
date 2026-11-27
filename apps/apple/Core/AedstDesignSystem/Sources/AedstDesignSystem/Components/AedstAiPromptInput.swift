import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Where the request is (web `AiPromptInputStatus`): drives the send button's icon, label and enabled state.
public enum AedstAiPromptInputStatus: Sendable, CaseIterable {
    case ready
    case submitted
    case streaming
    case error

    /// A reply is on its way: sending is blocked.
    public var isBusy: Bool { self == .submitted || self == .streaming }
}

/// The field the person types into to message the agent, matching shadcn AI Elements `Prompt Input`: an
/// `AedstInputGroup` holding `AedstAiPromptInputHeader` (attachment chips), `AedstAiPromptInputTextarea` and
/// `AedstAiPromptInputFooter` (tools and the send button). No AI SDK: `onSubmit(message)` and `status` drive it.
///
/// Files come from the system file importer and, when the attach button offers it, the photo library
/// (`PhotosPicker`); the kit only passes references on (`AedstAiPromptFile`). `onSubmit` gets the trimmed text
/// and the files; throwing keeps the draft for a retry.
public struct AedstAiPromptInput<Content: View>: View {
    private let status: AedstAiPromptInputStatus
    private let allowedContentTypes: [UTType]
    private let onSubmit: AedstAiPromptSubmitAction
    private let content: Content
    @State private var draft: AedstAiPromptDraft
    @State private var photoSelection: [PhotosPickerItem] = []

    /// - Parameters:
    ///   - status: Request status (`ready`, `submitted`, `streaming`, `error`).
    ///   - allowedContentTypes: Types the file importer offers (web `accept`).
    ///   - allowsMultipleFiles: When false a new file replaces the attached one (web `multiple`).
    ///   - onSubmit: Receives the message; throw to keep the draft.
    ///   - content: The parts, top to bottom.
    public init(
        status: AedstAiPromptInputStatus = .ready,
        allowedContentTypes: [UTType] = [.item],
        allowsMultipleFiles: Bool = true,
        onSubmit: @escaping @MainActor @Sendable (AedstAiPromptMessage) async throws -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.status = status
        self.allowedContentTypes = allowedContentTypes
        self.onSubmit = AedstAiPromptSubmitAction(run: onSubmit)
        self.content = content()
        self._draft = State(initialValue: AedstAiPromptDraft(allowsMultipleFiles: allowsMultipleFiles))
    }

    public var body: some View {
        @Bindable var draft = self.draft
        AedstInputGroup(align: .blockStart) {
            VStack(alignment: .leading, spacing: AedstSpacing.xs) {
                content
            }
            .padding(.vertical, AedstSpacing.xs)
        } addon: {
            EmptyView()
        }
        .environment(draft)
        .environment(\.aedstAiPromptStatus, status)
        .environment(\.aedstAiPromptSubmit, onSubmit)
        .fileImporter(
            isPresented: $draft.isFileImporterPresented,
            allowedContentTypes: allowedContentTypes,
            allowsMultipleSelection: draft.allowsMultipleFiles
        ) { result in
            if case .success(let urls) = result {
                draft.add(urls.map(AedstAiPromptFile.document))
            }
        }
        .photosPicker(
            isPresented: $draft.isPhotosPickerPresented,
            selection: $photoSelection,
            maxSelectionCount: draft.allowsMultipleFiles ? nil : 1,
            matching: .images
        )
        .onChange(of: photoSelection) { _, picked in
            guard !picked.isEmpty else { return }
            draft.add(picked.map(AedstAiPromptFile.photo))
            photoSelection = []
        }
    }
}

/// Attachment chips above the text (`AiPromptInputHeader`): one small `AedstAttachment` per file with a remove
/// action; hidden while nothing is attached.
public struct AedstAiPromptInputHeader: View {
    private let removeLabel: (AedstAiPromptFile) -> String
    @Environment(AedstAiPromptDraft.self) private var draft

    /// - Parameter removeLabel: Accessible name of each chip's remove button, e.g. "Remove report.pdf".
    public init(removeLabel: @escaping (AedstAiPromptFile) -> String) {
        self.removeLabel = removeLabel
    }

    public var body: some View {
        if !draft.files.isEmpty {
            AedstAttachmentGroup {
                ForEach(draft.files) { file in
                    AedstAttachment(file.name, size: .sm) {
                        Image(systemName: file.isPhoto ? "photo" : "doc")
                    } actions: {
                        AedstAttachmentAction(systemImage: "xmark", accessibilityLabel: removeLabel(file)) {
                            draft.remove(file)
                        }
                    }
                }
            }
        }
    }
}

/// The multiline text (`AiPromptInputTextarea`): grows to `maxLines`, then scrolls. On a hardware keyboard Return
/// sends and Shift+Return or Option+Return adds a line; on the software keyboard Return adds a line and the send
/// button sends.
public struct AedstAiPromptInputTextarea: View {
    private let label: String
    private let placeholder: String
    private let maxLines: Int
    @Environment(AedstAiPromptDraft.self) private var draft
    @Environment(\.aedstAiPromptStatus) private var status
    @Environment(\.aedstAiPromptSubmit) private var submitAction

    /// - Parameters:
    ///   - label: Accessible name, e.g. "Message".
    ///   - placeholder: Hint shown while empty; defaults to `label`.
    ///   - maxLines: Lines shown before the field scrolls (web `max-h-48`).
    public init(_ label: String, placeholder: String = "", maxLines: Int = 8) {
        self.label = label
        self.placeholder = placeholder
        self.maxLines = maxLines
    }

    public var body: some View {
        @Bindable var draft = self.draft
        TextField(placeholder.isEmpty ? label : placeholder, text: $draft.text, axis: .vertical)
            .textFieldStyle(.plain)
            .font(AedstTypography.body)
            .lineLimit(2...max(2, maxLines))
            .padding(AedstSpacing.sm)
            .frame(maxWidth: .infinity, minHeight: AedstHitTarget.minimum, alignment: .topLeading)
            .accessibilityLabel(Text(label))
            .onKeyPress(.return, phases: .down) { press in
                switch AedstAiPromptDraft.keyAction(for: press.modifiers) {
                case .newline:
                    return .ignored
                case .submit:
                    send()
                    return .handled
                }
            }
            // macOS commits a vertical text field on Return when the key press above was not delivered.
            .onSubmit(send)
    }

    private func send() {
        let draft = draft
        let status = status
        let action = submitAction
        Task { await draft.submit(status: status, action: action) }
    }
}

/// Bottom row with the tools and the send button (`AiPromptInputFooter`).
public struct AedstAiPromptInputFooter<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Leading group of tools (`AiPromptInputTools`): the attach button, model selectors.
public struct AedstAiPromptInputTools<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            content
        }
        Spacer(minLength: AedstSpacing.none)
    }
}

/// The "+" button (`AiPromptInputAttachButton`). With `photosLabel` and `filesLabel` it opens a menu offering the
/// photo library and the file importer; without them it opens the file importer directly.
public struct AedstAiPromptInputAttachButton: View {
    private let label: String
    private let photosLabel: String?
    private let filesLabel: String?
    @Environment(AedstAiPromptDraft.self) private var draft

    /// - Parameters:
    ///   - label: Accessible name, e.g. "Attach files".
    ///   - photosLabel: Menu title for the photo library, e.g. "Photos".
    ///   - filesLabel: Menu title for the file importer, e.g. "Files".
    public init(_ label: String, photosLabel: String? = nil, filesLabel: String? = nil) {
        self.label = label
        self.photosLabel = photosLabel
        self.filesLabel = filesLabel
    }

    public var body: some View {
        if let photosLabel, let filesLabel {
            AedstDropdownMenu(items: [
                .action(photosLabel, systemImage: "photo.on.rectangle") { draft.openPhotosPicker() },
                .action(filesLabel, systemImage: "folder") { draft.openFileImporter() },
            ]) {
                Image(systemName: "plus")
                    .font(AedstTypography.caption.weight(.semibold))
                    .aedstScaledFrame(width: 32, height: 32)
                    .overlay { Circle().strokeBorder(AedstColor.border, lineWidth: 1) }
                    .accessibilityLabel(Text(label))
            }
        } else {
            AedstIconButton(systemImage: "plus", accessibilityLabel: label, variant: .outline, size: .iconSm) {
                draft.openFileImporter()
            }
        }
    }
}

/// The send button (`AiPromptInputSubmit`). Its icon follows `status`: an arrow when ready, a spinner while
/// submitted, a stop square while streaming (when `onStop` is set), a warning after an error.
public struct AedstAiPromptInputSubmit: View {
    private let label: String
    private let stopLabel: String?
    private let onStop: (() -> Void)?
    @Environment(AedstAiPromptDraft.self) private var draft
    @Environment(\.aedstAiPromptStatus) private var status
    @Environment(\.aedstAiPromptSubmit) private var submitAction

    /// - Parameters:
    ///   - label: Accessible name, e.g. "Send".
    ///   - stopLabel: Accessible name while it stops the reply, e.g. "Stop".
    ///   - onStop: Stops the reply; makes the button a stop button while streaming.
    public init(_ label: String, stopLabel: String? = nil, onStop: (() -> Void)? = nil) {
        self.label = label
        self.stopLabel = stopLabel
        self.onStop = onStop
    }

    public var body: some View {
        let mode = AedstAiPromptSubmitMode(status: status, canStop: onStop != nil)
        AedstButton(
            mode == .stop ? (stopLabel ?? label) : label,
            systemImage: mode.systemImage,
            variant: .default,
            size: .iconSm,
            isLoading: mode == .busy,
            isDisabled: !(mode == .stop || draft.canSubmit(status: status)),
            fillsWidth: false
        ) {
            if mode == .stop {
                onStop?()
            } else {
                let draft = draft
                let action = submitAction
                Task { await draft.submit(status: status, action: action) }
            }
        }
        .accessibilityValue(Text(mode == .busy ? AedstStrings.loading : ""))
    }
}

#Preview("AedstAiPromptInput") {
    @Previewable @State var status = AedstAiPromptInputStatus.ready
    AedstAiPromptInput(status: status, onSubmit: { _ in }) {
        AedstAiPromptInputHeader(removeLabel: { "Remove \($0.name)" }) // i18n-ok: preview
        AedstAiPromptInputTextarea("Message", placeholder: "Ask anything")
        AedstAiPromptInputFooter {
            AedstAiPromptInputTools {
                AedstAiPromptInputAttachButton("Attach", photosLabel: "Photos", filesLabel: "Files")
            }
            AedstAiPromptInputSubmit("Send", stopLabel: "Stop") { status = .ready }
        }
    }
    .padding()
}

#endif
