import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/shared/ui/command";

const meta = {
  title: "UI/Command",
  component: Command,
  render: (args) => (
    <Command {...args} className="w-80 border">
      <CommandInput aria-label="Search commands" placeholder="Type a command" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>Calendar</CommandItem>
          <CommandItem>Search emoji</CommandItem>
          <CommandItem disabled>Calculator</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            Profile
            <CommandShortcut>Ctrl+P</CommandShortcut>
          </CommandItem>
          <CommandItem>
            Billing
            <CommandShortcut>Ctrl+B</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

// cmdk renders CommandSeparator (role=separator) as a direct child of the
// role=listbox list, which axe flags (aria-required-children). Upstream cmdk
// limitation; only this rule is disabled, and only for this story.
export const Default: Story = {
  parameters: {
    a11y: {
      config: { rules: [{ id: "aria-required-children", enabled: false }] },
    },
  },
};

export const Empty: Story = {
  render: (args) => (
    <Command {...args} className="w-80 border">
      <CommandInput
        aria-label="Search commands"
        defaultValue="zzzz"
        placeholder="Type a command"
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>Calendar</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};

export const InDialog: Story = {
  render: () => (
    <CommandDialog defaultOpen>
      <Command>
        <CommandInput aria-label="Search commands" placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            <CommandItem>Calendar</CommandItem>
            <CommandItem>Search emoji</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  ),
};
