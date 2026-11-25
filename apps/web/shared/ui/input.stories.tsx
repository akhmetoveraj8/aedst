import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent } from "storybook/test";

import { Input } from "@/shared/ui/input";

const meta = {
  title: "UI/Input",
  component: Input,
  args: {
    "aria-label": "Email",
    placeholder: "name@example.com",
    type: "email",
  },
  argTypes: {
    type: {
      control: "select",
      options: ["text", "email", "password", "number", "file"],
    },
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = { args: { defaultValue: "ada@example.com" } };

export const Disabled: Story = { args: { disabled: true } };

export const Invalid: Story = {
  args: { "aria-invalid": true, defaultValue: "not-an-email" },
};

export const File: Story = {
  args: { type: "file", "aria-label": "Upload file", placeholder: undefined },
};

/** Resolves a colour token the way the browser paints it. */
function tokenColor(name: string) {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** The keyboard focus ring is the solid `--ring` token (3:1 against the page). */
export const FocusRing: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const input = canvas.getByRole("textbox");
    await expect(input).toHaveFocus();
    await expect(getComputedStyle(input).boxShadow).toContain(
      tokenColor("--ring"),
    );
  },
};

/** An invalid field still shows a distinct, solid ring when it has focus. */
export const InvalidFocusRing: Story = {
  args: { "aria-invalid": true, defaultValue: "not-an-email" },
  play: async ({ canvas }) => {
    await userEvent.tab();
    const input = canvas.getByRole("textbox");
    await expect(input).toHaveFocus();
    await expect(getComputedStyle(input).boxShadow).toContain(
      tokenColor("--destructive"),
    );
  },
};

/**
 * On touch screens (pointer: coarse) fields are at least 44 CSS pixels tall
 * (WCAG 2.5.5). The test browser cannot emulate a coarse pointer, so this
 * checks that the rule the input relies on reaches the page.
 */
export const TouchMinHeightRule: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox");
    await expect(input).toHaveClass("pointer-coarse:min-h-11");
    const found: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (
          rule instanceof CSSMediaRule &&
          rule.conditionText.includes("coarse")
        ) {
          for (const inner of Array.from(rule.cssRules)) {
            if (
              inner instanceof CSSStyleRule &&
              inner.selectorText.includes(String.raw`pointer-coarse\:min-h-11`)
            ) {
              found.push(inner.style.minHeight);
            }
          }
        } else if ("cssRules" in rule) {
          walk((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
    await expect(found).toHaveLength(1);
    await expect(found[0]).toContain("11");
  },
};
