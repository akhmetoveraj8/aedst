// The component exists on iOS, macOS and visionOS only (see AedstAiChainOfThought.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiChainOfThought")
struct AedstAiChainOfThoughtTests {
    @Test("a caller icon wins unless the line is running or failed")
    func leadingSymbol() {
        #expect(AedstAiLineLogic.leadingSymbol(status: nil, systemImage: "brain") == .icon("brain"))
        #expect(AedstAiLineLogic.leadingSymbol(status: .success, systemImage: "brain") == .icon("brain"))
        #expect(AedstAiLineLogic.leadingSymbol(status: .pending, systemImage: "brain") == .icon("brain"))
        #expect(AedstAiLineLogic.leadingSymbol(status: .running, systemImage: "brain") == .status(.running))
        #expect(AedstAiLineLogic.leadingSymbol(status: .error, systemImage: "brain") == .status(.error))
    }

    @Test("without an icon the status icon shows, and nothing without either")
    func statusOnly() {
        #expect(AedstAiLineLogic.leadingSymbol(status: .skipped, systemImage: nil) == .status(.skipped))
        #expect(AedstAiLineLogic.leadingSymbol(status: nil, systemImage: nil) == nil)
    }

    @Test("the spoken label is title, status in words, then description, skipping empty parts")
    func spokenLabel() {
        #expect(
            AedstAiLineLogic.spokenLabel(title: "Search", statusLabel: "Running", description: "2 of 5")
                == "Search, Running, 2 of 5"
        )
        #expect(AedstAiLineLogic.spokenLabel(title: "Search", statusLabel: nil, description: "") == "Search")
    }

    @Test("pending and skipped steps are muted, the others are not")
    func muted() {
        let muted = AedstTraceStatus.allCases.filter(AedstAiLineLogic.isMuted)
        #expect(muted == [.pending, .skipped])
    }

    @Test("the line and its parts build with and without actions")
    @MainActor
    func builds() {
        _ = AedstAiChainOfThought(initiallyExpanded: true) {
            AedstAiChainOfThoughtHeader("Thinking", systemImage: "brain", status: .running, statusLabel: "Running")
        } content: {
            AedstAiChainOfThoughtSteps {
                AedstAiChainOfThoughtStep("Searched", description: "4 sources") {
                    AedstAiChainOfThoughtSearchResults(["swift.org"])
                }
            }
        }
        _ = AedstAiChainOfThought(isExpanded: .constant(false)) {
            AedstAiChainOfThoughtHeader("Plan")
        } actions: {
            AedstIconButton(systemImage: "doc.on.doc", accessibilityLabel: "Copy") {}
        } content: {
            AedstAiChainOfThoughtImage(caption: "Screenshot") { Color.clear }
        }
    }
}
#endif
