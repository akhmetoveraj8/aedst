import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/shared/ui/menubar";

const meta = {
  title: "UI/Menubar",
  component: Menubar,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Menubar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="h-72 w-80">
      <Menubar {...args}>
        <MenubarMenu defaultOpen>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarGroup>
              <MenubarItem>
                New tab <MenubarShortcut>Ctrl T</MenubarShortcut>
              </MenubarItem>
              <MenubarItem disabled>New incognito window</MenubarItem>
            </MenubarGroup>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger>Share</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem>Email link</MenubarItem>
                <MenubarItem>Messages</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem variant="destructive">Quit</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>Undo</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  ),
};

export const CheckboxAndRadio: Story = {
  render: (args) => (
    <div className="h-72 w-80">
      <Menubar {...args}>
        <MenubarMenu defaultOpen>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarCheckboxItem checked>
              Always show bookmarks
            </MenubarCheckboxItem>
            <MenubarCheckboxItem>Show full URLs</MenubarCheckboxItem>
            <MenubarSeparator />
            <MenubarRadioGroup value="light">
              <MenubarLabel>Theme</MenubarLabel>
              <MenubarRadioItem value="light">Light</MenubarRadioItem>
              <MenubarRadioItem value="dark">Dark</MenubarRadioItem>
            </MenubarRadioGroup>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  ),
};
