import Observation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// A file attached to a prompt: a document from the system file importer or an item from the photo library.
/// The kit never reads the bytes; the receiver of `onSubmit` loads them (a document URL is security-scoped:
/// call `startAccessingSecurityScopedResource()` around the read; a photo loads with `loadTransferable(type:)`).
public struct AedstAiPromptFile: Identifiable, Hashable, Sendable {
    public enum Source: Hashable, Sendable {
        case document(URL)
        case photo(PhotosPickerItem)
    }

    public let id: UUID
    /// Shown on the attachment chip.
    public let name: String
    public let source: Source

    public init(id: UUID = UUID(), name: String, source: Source) {
        self.id = id
        self.name = name
        self.source = source
    }

    /// A document picked with the file importer, named after its last path component.
    public static func document(_ url: URL) -> AedstAiPromptFile {
        AedstAiPromptFile(name: url.lastPathComponent, source: .document(url))
    }

    /// A photo-library item, named after its content type ("JPEG image"); the library gives no file name.
    public static func photo(_ item: PhotosPickerItem) -> AedstAiPromptFile {
        let name = item.supportedContentTypes.first?.localizedDescription ?? item.itemIdentifier ?? ""
        return AedstAiPromptFile(name: name, source: .photo(item))
    }

    var isPhoto: Bool {
        if case .photo = source { return true }
        return false
    }
}

/// What a prompt sends (web `PromptMessage`): the trimmed text and the attached files.
public struct AedstAiPromptMessage: Hashable, Sendable {
    public let text: String
    public let files: [AedstAiPromptFile]

    public init(text: String, files: [AedstAiPromptFile]) {
        self.text = text
        self.files = files
    }
}

/// What Return does in the prompt on a hardware keyboard.
enum AedstAiPromptKeyAction: Equatable {
    case submit
    /// Let the text field insert the line break itself.
    case newline
}

/// Draft state of `AedstAiPromptInput` (web `usePromptDraft`): text plus attached files, submitted once with the
/// trimmed text and cleared when the send succeeds; a thrown error keeps the draft so the person can retry.
/// Custom parts read it with `@Environment(AedstAiPromptDraft.self)`.
@MainActor
@Observable
public final class AedstAiPromptDraft {
    public var text = ""
    public private(set) var files: [AedstAiPromptFile] = []
    /// True while `onSubmit` runs; blocks a second send.
    public private(set) var isSending = false
    /// When false, a new file replaces the attached one.
    public let allowsMultipleFiles: Bool

    var isFileImporterPresented = false
    var isPhotosPickerPresented = false

    public init(allowsMultipleFiles: Bool = true) {
        self.allowsMultipleFiles = allowsMultipleFiles
    }

    /// Something to send and nothing in flight.
    public func canSubmit(status: AedstAiPromptInputStatus) -> Bool {
        !status.isBusy && !isSending && (!trimmedText.isEmpty || !files.isEmpty)
    }

    var trimmedText: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    public func add(_ incoming: [AedstAiPromptFile]) {
        guard !incoming.isEmpty else { return }
        files = allowsMultipleFiles ? files + incoming : Array(incoming.prefix(1))
    }

    public func remove(_ file: AedstAiPromptFile) {
        files.removeAll { $0.id == file.id }
    }

    public func openFileImporter() { isFileImporterPresented = true }
    public func openPhotosPicker() { isPhotosPickerPresented = true }

    /// Sends the draft through `action` when `canSubmit`; clears it only if `action` does not throw.
    func submit(status: AedstAiPromptInputStatus, action: AedstAiPromptSubmitAction) async {
        guard canSubmit(status: status) else { return }
        isSending = true
        defer { isSending = false }
        let message = AedstAiPromptMessage(text: trimmedText, files: files)
        do {
            try await action.run(message)
            text = ""
            files = []
        } catch {
            // Kept on purpose: the caller shows the error; the draft stays for a retry (web keeps it too).
        }
    }

    /// Return sends; Shift+Return or Option+Return inserts a line break.
    static func keyAction(for modifiers: EventModifiers) -> AedstAiPromptKeyAction {
        modifiers.contains(.shift) || modifiers.contains(.option) ? .newline : .submit
    }
}

/// The `onSubmit` closure of `AedstAiPromptInput`, carried to its parts through the environment.
struct AedstAiPromptSubmitAction: Sendable {
    let run: @MainActor @Sendable (AedstAiPromptMessage) async throws -> Void
}

extension EnvironmentValues {
    @Entry var aedstAiPromptStatus: AedstAiPromptInputStatus = .ready
    @Entry var aedstAiPromptSubmit: AedstAiPromptSubmitAction = AedstAiPromptSubmitAction { _ in }
}

/// What the send button is right now; a pure mapping so it is unit-tested.
enum AedstAiPromptSubmitMode: Equatable {
    case send
    case busy
    case stop
    case retry

    init(status: AedstAiPromptInputStatus, canStop: Bool) {
        switch status {
        case .ready: self = .send
        case .submitted: self = .busy
        case .streaming: self = canStop ? .stop : .busy
        case .error: self = .retry
        }
    }

    var systemImage: String {
        switch self {
        case .send, .busy: "arrow.up"
        case .stop: "stop.fill"
        case .retry: "exclamationmark.triangle"
        }
    }
}

#endif
