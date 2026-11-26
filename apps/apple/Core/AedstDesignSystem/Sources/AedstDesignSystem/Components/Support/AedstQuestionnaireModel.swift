import Foundation
import Observation

/// One answer option of an `AedstQuestionnaireQuestion` (shadcn/ui `QuestionnaireChoice`).
public struct AedstQuestionnaireChoice: Identifiable, Hashable, Sendable {
    /// Stable value stored in the answer.
    public let id: String
    /// Already localized label.
    public let title: String
    /// Optional second line (`QuestionnaireChoiceDescription`).
    public let description: String?
    public let isDisabled: Bool
    /// Optional single-key shortcut shown on the choice and bound on a hardware keyboard ("1", "a").
    public let shortcut: Character?

    public init(id: String, title: String, description: String? = nil, isDisabled: Bool = false, shortcut: Character? = nil) {
        self.id = id
        self.title = title
        self.description = description
        self.isDisabled = isDisabled
        self.shortcut = shortcut
    }
}

/// One step of a questionnaire (shadcn/ui `QuestionnaireItem` + `QuestionnaireTitle` + `QuestionnaireDescription`).
public struct AedstQuestionnaireQuestion: Identifiable, Sendable {
    /// What kind of answer the question takes.
    public enum Kind: Sendable {
        /// Exactly one choice (radio).
        case single([AedstQuestionnaireChoice])
        /// Any number of choices (checkboxes).
        case multiple([AedstQuestionnaireChoice])
        /// Free text; `prompt` is the placeholder.
        case text(prompt: String)
    }

    public let id: String
    public let title: String
    public let description: String?
    public let kind: Kind
    public let isRequired: Bool

    public init(id: String, title: String, description: String? = nil, kind: Kind, isRequired: Bool = false) {
        self.id = id
        self.title = title
        self.description = description
        self.kind = kind
        self.isRequired = isRequired
    }

    var choices: [AedstQuestionnaireChoice] {
        switch kind {
        case .single(let choices), .multiple(let choices): choices
        case .text: []
        }
    }

    var allowsMultiple: Bool {
        if case .multiple = kind { return true }
        return false
    }
}

/// The answer to one question: the chosen choice ids, or the typed text.
public enum AedstQuestionnaireAnswer: Hashable, Sendable {
    case choices(Set<String>)
    case text(String)

    /// Whether this answers a required question (at least one choice, or non-blank text).
    var isAnswered: Bool {
        switch self {
        case .choices(let ids): !ids.isEmpty
        case .text(let text): !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
}

/// State of an `AedstQuestionnaire`: the current step, the answers and the validation error. Owned by the screen
/// (or its view model) so answers survive navigation and can be pre-filled (web `defaultChecked`).
@MainActor
@Observable
public final class AedstQuestionnaireState {
    public let questions: [AedstQuestionnaireQuestion]
    public private(set) var currentIndex = 0
    public private(set) var answers: [String: AedstQuestionnaireAnswer]
    /// Set when Next or Submit is refused because a required question has no answer.
    public private(set) var isShowingRequiredError = false

    public init(questions: [AedstQuestionnaireQuestion], answers: [String: AedstQuestionnaireAnswer] = [:]) {
        self.questions = questions
        self.answers = answers
    }

    public var current: AedstQuestionnaireQuestion? {
        questions.indices.contains(currentIndex) ? questions[currentIndex] : nil
    }

    public var isFirst: Bool { currentIndex == 0 }
    public var isLast: Bool { currentIndex >= questions.count - 1 }

    /// Skip is offered for an optional question that is not the last one.
    public var canSkip: Bool { !isLast && current?.isRequired == false }

    /// Whether a choice of the current question is selected.
    public func isSelected(_ choice: AedstQuestionnaireChoice) -> Bool {
        guard let current, case .choices(let ids) = answers[current.id] else { return false }
        return ids.contains(choice.id)
    }

    /// Picks a choice: replaces the selection for a single-choice question, toggles it for a multiple one.
    public func toggle(_ choice: AedstQuestionnaireChoice) {
        guard let current, !choice.isDisabled else { return }
        var ids: Set<String> = if case .choices(let existing) = answers[current.id] { existing } else { [] }
        if current.allowsMultiple {
            if ids.contains(choice.id) { ids.remove(choice.id) } else { ids.insert(choice.id) }
        } else {
            ids = [choice.id]
        }
        answers[current.id] = .choices(ids)
        isShowingRequiredError = false
    }

    /// Text typed for the current question.
    public var text: String {
        get {
            guard let current, case .text(let value) = answers[current.id] else { return "" }
            return value
        }
        set {
            guard let current else { return }
            answers[current.id] = .text(newValue)
            isShowingRequiredError = false
        }
    }

    /// Moves to the next question; refused (and the error shown) when the current one is required and unanswered.
    @discardableResult
    public func next() -> Bool {
        guard validateCurrent(), !isLast else { return false }
        currentIndex += 1
        return true
    }

    public func previous() {
        guard !isFirst else { return }
        isShowingRequiredError = false
        currentIndex -= 1
    }

    /// Leaves an optional question unanswered and moves on.
    public func skip() {
        guard canSkip, let current else { return }
        answers[current.id] = nil
        currentIndex += 1
    }

    /// The answers when the last question is valid, else `nil` with the error shown.
    public func submit() -> [String: AedstQuestionnaireAnswer]? {
        validateCurrent() ? answers : nil
    }

    private func validateCurrent() -> Bool {
        guard let current else { return false }
        let ok = !current.isRequired || answers[current.id]?.isAnswered == true
        isShowingRequiredError = !ok
        return ok
    }
}
