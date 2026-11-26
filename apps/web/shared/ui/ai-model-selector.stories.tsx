import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  AiModelSelector,
  AiModelSelectorContent,
  AiModelSelectorGroup,
  AiModelSelectorItem,
  AiModelSelectorList,
  AiModelSelectorLogo,
  AiModelSelectorName,
  AiModelSelectorSeparator,
  AiModelSelectorShortcut,
  AiModelSelectorTrigger,
} from "@/shared/ui/ai-model-selector";

const MODELS = [
  {
    group: "Provider A",
    items: [
      { id: "a-large", name: "Large" },
      { id: "a-small", name: "Small" },
    ],
  },
  {
    group: "Provider B",
    items: [
      { id: "b-pro", name: "Pro" },
      { id: "b-lite", name: "Lite" },
    ],
  },
];

const NAMES = Object.fromEntries(
  MODELS.flatMap((g) => g.items).map((m) => [m.id, m.name]),
);

function ModelSelectorDemo() {
  const [model, setModel] = useState("a-large");
  return (
    <AiModelSelector>
      <AiModelSelectorTrigger aria-label={`Model: ${NAMES[model]}`}>
        {NAMES[model]}
      </AiModelSelectorTrigger>
      <AiModelSelectorContent>
        <AiModelSelectorList value={model} onValueChange={setModel}>
          {MODELS.map((group, index) => (
            <div key={group.group}>
              {index > 0 ? <AiModelSelectorSeparator /> : null}
              <AiModelSelectorGroup heading={group.group}>
                {group.items.map((item, i) => (
                  <AiModelSelectorItem key={item.id} value={item.id}>
                    <AiModelSelectorLogo>
                      <span className="size-full rounded-full bg-muted-foreground" />
                    </AiModelSelectorLogo>
                    <AiModelSelectorName>{item.name}</AiModelSelectorName>
                    <AiModelSelectorShortcut>⌘{i + 1}</AiModelSelectorShortcut>
                  </AiModelSelectorItem>
                ))}
              </AiModelSelectorGroup>
            </div>
          ))}
        </AiModelSelectorList>
      </AiModelSelectorContent>
    </AiModelSelector>
  );
}

const meta = {
  title: "UI/AI/ModelSelector",
  component: AiModelSelector,
  render: () => <ModelSelectorDemo />,
} satisfies Meta<typeof AiModelSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PickModel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Model: Large" }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await body.findByRole("menuitemradio", { name: /Pro/ }),
    );
    await expect(
      await canvas.findByRole("button", { name: "Model: Pro" }),
    ).toBeInTheDocument();
    // Let the menu finish closing (its focus guards go with it).
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    await waitFor(() =>
      expect(
        canvasElement.ownerDocument.querySelector("[data-base-ui-focus-guard]"),
      ).toBeNull(),
    );
  },
};
