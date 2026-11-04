import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@/shared/ui/sidebar";

const meta = {
  title: "UI/Sidebar",
  component: Sidebar,
  decorators: [
    (Story) => (
      <SidebarProvider className="min-h-0">
        <div className="h-96 w-72 overflow-hidden rounded-md border">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const navItems = ["Dashboard", "Projects", "Settings"];

export const Default: Story = {
  args: { collapsible: "none" },
  render: (args) => (
    <Sidebar {...args}>
      <SidebarHeader>
        <span className="px-2 text-sm font-semibold">AEDST</span>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Application</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item, index) => (
                <SidebarMenuItem key={item}>
                  <SidebarMenuButton isActive={index === 0}>
                    {item}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>Sign out</SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  ),
};

export const SmallButtons: Story = {
  args: { collapsible: "none" },
  render: (args) => (
    <Sidebar {...args}>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Compact</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item}>
                  <SidebarMenuButton size="sm" variant="outline">
                    {item}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  ),
};
