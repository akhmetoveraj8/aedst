// The component exists on iOS, macOS and visionOS only (see AedstAiQueue.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiQueue")
struct AedstAiQueueTests {
    @Test("todo states map to pending, running and success")
    func statuses() {
        #expect(AedstAiQueueItemStatus.pending.status == .pending)
        #expect(AedstAiQueueItemStatus.inProgress.status == .running)
        #expect(AedstAiQueueItemStatus.completed.status == .success)
    }

    @Test("actions are always shown on touch platforms")
    func touchShowsActions() {
        #expect(AedstAiQueueLogic.showsActions(precisePointer: false, isHovered: false, isFocused: false, voiceOverEnabled: false))
    }

    @Test("with a precise pointer actions appear on hover, focus or VoiceOver only")
    func pointerHidesActions() {
        #expect(!AedstAiQueueLogic.showsActions(precisePointer: true, isHovered: false, isFocused: false, voiceOverEnabled: false))
        #expect(AedstAiQueueLogic.showsActions(precisePointer: true, isHovered: true, isFocused: false, voiceOverEnabled: false))
        #expect(AedstAiQueueLogic.showsActions(precisePointer: true, isHovered: false, isFocused: true, voiceOverEnabled: false))
        #expect(AedstAiQueueLogic.showsActions(precisePointer: true, isHovered: false, isFocused: false, voiceOverEnabled: true))
    }

    @Test("the queue with sections, items and actions builds")
    @MainActor
    func builds() {
        _ = AedstAiQueue {
            AedstAiQueueSection("2 to do") {
                AedstAiQueueItem("Rename", status: .inProgress, statusLabel: "In progress")
                AedstAiQueueItem("Test") {
                    AedstAiQueueItemAction(label: "Remove", systemImage: "trash") {}
                }
            }
        }
        _ = AedstAiQueueSectionTrigger("Completed")
        _ = AedstAiQueueItemActions { AedstAiQueueItemAction(label: "Edit", systemImage: "pencil") {} }
    }
}
#endif
