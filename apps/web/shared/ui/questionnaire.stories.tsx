import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/shared/ui/questionnaire";

const meta = {
  title: "UI/Questionnaire",
  component: Questionnaire,
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Questionnaire>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Questionnaire {...args} aria-label="Onboarding survey">
      <QuestionnaireProgress />
      <QuestionnaireItem name="role" required>
        <QuestionnaireTitle>What best describes your role?</QuestionnaireTitle>
        <QuestionnaireDescription>Pick one option.</QuestionnaireDescription>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="engineer">
            Engineer
            <QuestionnaireChoiceDescription>
              Builds and ships software
            </QuestionnaireChoiceDescription>
          </QuestionnaireChoice>
          <QuestionnaireChoice value="designer">Designer</QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireItem name="notes">
        <QuestionnaireTitle>Anything else?</QuestionnaireTitle>
        <QuestionnaireInput aria-label="Additional notes" />
        <QuestionnaireError />
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireSkip />
        <QuestionnaireNext />
        <QuestionnaireSubmit />
      </QuestionnaireActions>
    </Questionnaire>
  ),
};

export const MultipleChoice: Story = {
  render: (args) => (
    <Questionnaire {...args} aria-label="Interests survey">
      <QuestionnaireItem name="interests" multiple>
        <QuestionnaireTitle>Which topics interest you?</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="web" defaultChecked>
            Web
          </QuestionnaireChoice>
          <QuestionnaireChoice value="mobile">Mobile</QuestionnaireChoice>
          <QuestionnaireChoice value="desktop" disabled>
            Desktop
          </QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnaireSubmit />
      </QuestionnaireActions>
    </Questionnaire>
  ),
};
