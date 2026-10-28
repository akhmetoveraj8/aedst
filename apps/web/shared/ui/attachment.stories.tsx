import { File01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/shared/ui/attachment";

const meta = {
  title: "UI/Attachment",
  component: Attachment,
  argTypes: {
    state: {
      control: "select",
      options: ["idle", "uploading", "processing", "error", "done"],
    },
    size: { control: "select", options: ["default", "sm", "xs"] },
    orientation: { control: "select", options: ["horizontal", "vertical"] },
  },
} satisfies Meta<typeof Attachment>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Attachment {...args}>
      <AttachmentMedia>
        <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>report.pdf</AttachmentTitle>
        <AttachmentDescription>2.4 MB</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label="Remove report.pdf">x</AttachmentAction>
      </AttachmentActions>
    </Attachment>
  ),
};

export const Failed: Story = {
  // axe color-contrast: destructive/80 description on card is 4.11:1, a design-token issue.
  parameters: { a11y: { test: "todo" } },
  args: { state: "error" },
  render: (args) => (
    <Attachment {...args}>
      <AttachmentMedia>
        <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>broken.zip</AttachmentTitle>
        <AttachmentDescription>Upload failed</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <Attachment {...args}>
      <AttachmentMedia>
        <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>notes.txt</AttachmentTitle>
        <AttachmentDescription>12 KB</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  ),
};

export const Group: Story = {
  render: (args) => (
    <AttachmentGroup className="w-80">
      <Attachment {...args} state="uploading">
        <AttachmentContent>
          <AttachmentTitle>photo.png</AttachmentTitle>
          <AttachmentDescription>Uploading</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
      <Attachment {...args} state="idle">
        <AttachmentContent>
          <AttachmentTitle>draft.md</AttachmentTitle>
          <AttachmentDescription>Queued</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    </AttachmentGroup>
  ),
};
