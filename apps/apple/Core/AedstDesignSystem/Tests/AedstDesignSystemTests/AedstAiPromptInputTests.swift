#if os(iOS) || os(macOS) || os(visionOS)
import Foundation
import SwiftUI
import Testing
@testable import AedstDesignSystem

private struct AedstAiPromptTestError: Error {}

@MainActor
private final class AedstAiPromptRecorder {
    var messages: [AedstAiPromptMessage] = []
}

@Suite("AedstAiPromptInput")
@MainActor
struct AedstAiPromptInputTests {
    private let file = AedstAiPromptFile.document(URL(filePath: "/tmp/report.pdf"))

    @Test("submitted and streaming are busy; ready and error are not")
    func busyStatuses() {
        #expect(AedstAiPromptInputStatus.submitted.isBusy)
        #expect(AedstAiPromptInputStatus.streaming.isBusy)
        #expect(!AedstAiPromptInputStatus.ready.isBusy)
        #expect(!AedstAiPromptInputStatus.error.isBusy)
    }

    @Test("Return sends; Shift+Return and Option+Return add a line")
    func returnKey() {
        #expect(AedstAiPromptDraft.keyAction(for: []) == .submit)
        #expect(AedstAiPromptDraft.keyAction(for: .shift) == .newline)
        #expect(AedstAiPromptDraft.keyAction(for: .option) == .newline)
    }

    @Test("the send button follows the status; stop only while streaming with onStop")
    func submitMode() {
        #expect(AedstAiPromptSubmitMode(status: .ready, canStop: true) == .send)
        #expect(AedstAiPromptSubmitMode(status: .submitted, canStop: true) == .busy)
        #expect(AedstAiPromptSubmitMode(status: .streaming, canStop: true) == .stop)
        #expect(AedstAiPromptSubmitMode(status: .streaming, canStop: false) == .busy)
        #expect(AedstAiPromptSubmitMode(status: .error, canStop: false) == .retry)
        #expect(AedstAiPromptSubmitMode.stop.systemImage == "stop.fill")
    }

    @Test("blank text with no files cannot be sent; text or a file can, unless busy")
    func canSubmit() {
        let draft = AedstAiPromptDraft()
        draft.text = "   \n"
        #expect(!draft.canSubmit(status: .ready))
        draft.add([file])
        #expect(draft.canSubmit(status: .ready))
        #expect(!draft.canSubmit(status: .streaming))
    }

    @Test("a single-file prompt replaces the attachment; a multi-file one appends")
    func addAndRemove() {
        let single = AedstAiPromptDraft(allowsMultipleFiles: false)
        let other = AedstAiPromptFile.document(URL(filePath: "/tmp/notes.txt"))
        single.add([file])
        single.add([other, file])
        #expect(single.files == [other])
        let multi = AedstAiPromptDraft()
        multi.add([file, other])
        multi.remove(file)
        #expect(multi.files == [other])
        #expect(other.name == "notes.txt")
    }

    @Test("a successful send gets the trimmed text and files, then clears the draft")
    func submitClears() async {
        let draft = AedstAiPromptDraft()
        draft.text = "  hello  "
        draft.add([file])
        let recorder = AedstAiPromptRecorder()
        await draft.submit(status: .ready, action: AedstAiPromptSubmitAction { recorder.messages.append($0) })
        #expect(recorder.messages == [AedstAiPromptMessage(text: "hello", files: [file])])
        #expect(draft.text.isEmpty)
        #expect(draft.files.isEmpty)
        #expect(!draft.isSending)
    }

    @Test("a failed send keeps the draft for a retry")
    func submitKeepsOnError() async {
        let draft = AedstAiPromptDraft()
        draft.text = "hello"
        await draft.submit(status: .ready, action: AedstAiPromptSubmitAction { _ in throw AedstAiPromptTestError() })
        #expect(draft.text == "hello")
    }

    @Test("nothing is sent while a reply is busy")
    func submitBlockedWhileBusy() async {
        let draft = AedstAiPromptDraft()
        draft.text = "hello"
        let recorder = AedstAiPromptRecorder()
        await draft.submit(status: .streaming, action: AedstAiPromptSubmitAction { recorder.messages.append($0) })
        #expect(recorder.messages.isEmpty)
        #expect(draft.text == "hello")
    }
}
#endif
