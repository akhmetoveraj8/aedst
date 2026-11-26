import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// A step-by-step set of questions, matching shadcn/ui `Questionnaire` (`QuestionnaireProgress`, `QuestionnaireItem`,
/// `QuestionnaireChoices`, `QuestionnaireChoice`, `QuestionnaireInput`, `QuestionnaireError`, `QuestionnaireActions`
/// with Previous, Skip, Next and Submit). One question is shown at a time; the state lives in an
/// `AedstQuestionnaireState` the caller owns.
///
/// Accessibility: the progress reads "Question 2 of 5", the question title is a heading, single-choice options are
/// radio buttons and multiple-choice options checkboxes (selected state exposed), a refused step announces its
/// error, and choices with a `shortcut` are bound to that key on a hardware keyboard.
public struct AedstQuestionnaire: View {
    @Bindable private var state: AedstQuestionnaireState
    private let requiredMessage: String
    private let previousLabel: String
    private let skipLabel: String
    private let nextLabel: String
    private let submitLabel: String
    private let onSubmit: ([String: AedstQuestionnaireAnswer]) -> Void

    /// - Parameters:
    ///   - state: Questions, current step and answers.
    ///   - requiredMessage: Error shown when a required question is left empty; `nil` uses "Required".
    ///   - previousLabel, skipLabel, nextLabel, submitLabel: Button titles; `nil` uses the kit's localized defaults.
    ///   - onSubmit: Called with every answer, keyed by question id, when the last step is valid.
    public init(
        state: AedstQuestionnaireState,
        requiredMessage: String? = nil,
        previousLabel: String? = nil,
        skipLabel: String? = nil,
        nextLabel: String? = nil,
        submitLabel: String? = nil,
        onSubmit: @escaping ([String: AedstQuestionnaireAnswer]) -> Void
    ) {
        self.state = state
        self.requiredMessage = requiredMessage ?? AedstStrings.required
        self.previousLabel = previousLabel ?? AedstStrings.previous
        self.skipLabel = skipLabel ?? AedstStrings.skip
        self.nextLabel = nextLabel ?? AedstStrings.next
        self.submitLabel = submitLabel ?? AedstStrings.submit
        self.onSubmit = onSubmit
    }

    /// "Question 2 of 5".
    static func progressText(index: Int, count: Int) -> String {
        AedstStrings.questionProgress((index + 1).formatted(), count.formatted())
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.lg) {
            if state.questions.count > 1 {
                Text(Self.progressText(index: state.currentIndex, count: state.questions.count))
                    .font(AedstTypography.caption.weight(.medium).monospacedDigit())
                    .foregroundStyle(AedstColor.mutedForeground)
                    .accessibilityLabel(Text(AedstStrings.questionnaireProgress))
                    .accessibilityValue(Text(Self.progressText(index: state.currentIndex, count: state.questions.count)))
            }
            if let question = state.current {
                item(question)
                    .id(question.id)
            }
            actions
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: state.isShowingRequiredError) { _, isShowing in
            if isShowing { AedstAnnouncer.post(requiredMessage) }
        }
    }

    private func item(_ question: AedstQuestionnaireQuestion) -> some View {
        VStack(alignment: .leading, spacing: AedstSpacing.lg) {
            VStack(alignment: .leading, spacing: AedstSpacing.xs) {
                Text(question.title)
                    .font(AedstTypography.headline)
                    .accessibilityAddTraits(.isHeader)
                if let description = question.description {
                    Text(description)
                        .font(AedstTypography.body)
                        .foregroundStyle(AedstColor.mutedForeground)
                }
            }
            switch question.kind {
            case .single(let choices), .multiple(let choices):
                VStack(spacing: AedstSpacing.sm) {
                    ForEach(choices) { choice in
                        choiceRow(choice, multiple: question.allowsMultiple)
                    }
                }
            case .text(let prompt):
                AedstTextField(question.title, text: $state.text, placeholder: prompt)
            }
            if state.isShowingRequiredError {
                Text(requiredMessage)
                    .font(AedstTypography.body)
                    .foregroundStyle(AedstColor.destructive)
            }
        }
    }

    private func choiceRow(_ choice: AedstQuestionnaireChoice, multiple: Bool) -> some View {
        let isSelected = state.isSelected(choice)
        return Button {
            state.toggle(choice)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: AedstSpacing.sm + AedstSpacing.xxs) {
                AedstQuestionnaireIndicator(isSelected: isSelected, multiple: multiple)
                VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                    Text(choice.title).foregroundStyle(AedstColor.foreground)
                    if let description = choice.description {
                        Text(description).foregroundStyle(AedstColor.mutedForeground)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let shortcut = choice.shortcut {
                    AedstKbd(String(shortcut)).accessibilityHidden(true)
                }
            }
            .font(AedstTypography.body)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, AedstSpacing.md)
            .padding(.vertical, AedstSpacing.sm + AedstSpacing.xxs)
            .frame(minHeight: AedstHitTarget.minimum)
            .background(isSelected ? AedstColor.muted : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: AedstRadius.lg, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: AedstRadius.lg, style: .continuous)
                    .strokeBorder(borderColor(isSelected: isSelected), lineWidth: 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(choice.isDisabled)
        .opacity(choice.isDisabled ? 0.5 : 1)
        .keyboardShortcut(choice.shortcut.map { KeyboardShortcut(KeyEquivalent($0), modifiers: []) })
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityValue(Text(multiple ? (isSelected ? AedstStrings.checked : AedstStrings.unchecked) : ""))
    }

    private func borderColor(isSelected: Bool) -> Color {
        if state.isShowingRequiredError { return AedstColor.destructive }
        return isSelected ? AedstColor.primary.opacity(0.4) : AedstColor.input
    }

    private var actions: some View {
        HStack(spacing: AedstSpacing.sm) {
            if !state.isFirst {
                AedstButton(previousLabel, variant: .outline, fillsWidth: false) { state.previous() }
            }
            Spacer(minLength: AedstSpacing.none)
            if state.canSkip {
                AedstButton(skipLabel, variant: .outline, fillsWidth: false) { state.skip() }
            }
            if state.isLast {
                AedstButton(submitLabel, fillsWidth: false) {
                    if let answers = state.submit() { onSubmit(answers) }
                }
                .keyboardShortcut(.defaultAction)
            } else {
                AedstButton(nextLabel, fillsWidth: false) { state.next() }
                    .keyboardShortcut(.defaultAction)
            }
        }
    }
}

/// The radio dot or check box at the start of a choice.
private struct AedstQuestionnaireIndicator: View {
    let isSelected: Bool
    let multiple: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: multiple ? AedstRadius.xs : AedstRadius.full, style: .continuous)
        shape
            .fill(isSelected ? AedstColor.primary : Color.clear)
            .overlay { shape.strokeBorder(isSelected ? AedstColor.primary : AedstColor.input, lineWidth: 1) }
            .overlay {
                if isSelected {
                    if multiple {
                        Image(systemName: "checkmark").font(AedstTypography.caption.weight(.bold))
                    } else {
                        Circle().frame(width: AedstSpacing.sm, height: AedstSpacing.sm)
                    }
                }
            }
            .foregroundStyle(AedstColor.primaryForeground)
            .frame(width: AedstSpacing.lg, height: AedstSpacing.lg)
            .accessibilityHidden(true)
    }
}

#Preview("AedstQuestionnaire") {
    @Previewable @State var state = AedstQuestionnaireState(questions: [
        AedstQuestionnaireQuestion(
            id: "role",
            title: "What best describes your role?",
            description: "Pick one option.",
            kind: .single([
                AedstQuestionnaireChoice(id: "engineer", title: "Engineer", description: "Builds and ships software", shortcut: "1"),
                AedstQuestionnaireChoice(id: "designer", title: "Designer", shortcut: "2"),
            ]),
            isRequired: true
        ),
        AedstQuestionnaireQuestion(id: "topics", title: "Which topics interest you?", kind: .multiple([
            AedstQuestionnaireChoice(id: "web", title: "Web"),
            AedstQuestionnaireChoice(id: "desktop", title: "Desktop", isDisabled: true),
        ])),
        AedstQuestionnaireQuestion(id: "notes", title: "Anything else?", kind: .text(prompt: "Notes")),
    ])
    AedstQuestionnaire(state: state) { _ in }
        .padding()
}

#endif
