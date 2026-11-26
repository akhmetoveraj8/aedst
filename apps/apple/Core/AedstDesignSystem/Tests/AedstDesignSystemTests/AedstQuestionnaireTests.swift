#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@MainActor
@Suite("AedstQuestionnaire")
struct AedstQuestionnaireTests {
    private let engineer = AedstQuestionnaireChoice(id: "engineer", title: "Engineer")
    private let designer = AedstQuestionnaireChoice(id: "designer", title: "Designer")
    private let desktop = AedstQuestionnaireChoice(id: "desktop", title: "Desktop", isDisabled: true)

    private func makeState() -> AedstQuestionnaireState {
        AedstQuestionnaireState(questions: [
            AedstQuestionnaireQuestion(id: "role", title: "Role", kind: .single([engineer, designer]), isRequired: true),
            AedstQuestionnaireQuestion(id: "topics", title: "Topics", kind: .multiple([engineer, designer, desktop])),
            AedstQuestionnaireQuestion(id: "notes", title: "Notes", kind: .text(prompt: ""), isRequired: true),
        ])
    }

    @Test("a required question blocks Next until it is answered")
    func required() {
        let state = makeState()
        #expect(!state.next())
        #expect(state.isShowingRequiredError)
        state.toggle(engineer)
        #expect(!state.isShowingRequiredError)
        #expect(state.next())
        #expect(state.currentIndex == 1)
    }

    @Test("a single choice replaces the selection; a multiple choice toggles; a disabled one is ignored")
    func choices() {
        let state = makeState()
        state.toggle(engineer)
        state.toggle(designer)
        #expect(state.answers["role"] == .choices(["designer"]))
        state.next()
        state.toggle(engineer)
        state.toggle(designer)
        state.toggle(engineer)
        state.toggle(desktop)
        #expect(state.answers["topics"] == .choices(["designer"]))
    }

    @Test("Skip is offered only for an optional question before the last, and clears its answer")
    func skip() {
        let state = makeState()
        #expect(!state.canSkip)
        state.toggle(engineer)
        state.next()
        #expect(state.canSkip)
        state.toggle(designer)
        state.skip()
        #expect(state.answers["topics"] == nil)
        #expect(state.isLast)
        #expect(!state.canSkip)
    }

    @Test("Submit refuses blank text and returns every answer otherwise")
    func submit() {
        let state = makeState()
        state.toggle(engineer)
        state.next()
        state.next()
        state.text = "   "
        #expect(state.submit() == nil)
        #expect(state.isShowingRequiredError)
        state.text = "Thanks"
        #expect(state.submit()?["notes"] == .text("Thanks"))
        #expect(state.submit()?["role"] == .choices(["engineer"]))
    }

    @Test("Previous goes back without validating and keeps the answers")
    func previous() {
        let state = makeState()
        state.previous()
        #expect(state.isFirst)
        state.toggle(engineer)
        state.next()
        state.previous()
        #expect(state.currentIndex == 0)
        #expect(state.isSelected(engineer))
    }

    @Test("the progress text counts from one")
    func progress() {
        #expect(AedstQuestionnaire.progressText(index: 1, count: 3) == AedstStrings.questionProgress("2", "3"))
    }
}
#endif
