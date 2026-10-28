import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/shared/ui/navigation-menu";

const meta = {
  title: "UI/NavigationMenu",
  component: NavigationMenu,
  parameters: { layout: "centered" },
} satisfies Meta<typeof NavigationMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

// axe rule "aria-hidden-focus": Base UI renders focusable aria-hidden focus
// guards while the popup is open (library behavior).
export const Default: Story = {
  parameters: { a11y: { test: "todo" } },
  render: (args) => (
    <div className="h-64">
      <NavigationMenu {...args} defaultValue="products" aria-label="Main">
        <NavigationMenuList>
          <NavigationMenuItem value="products">
            <NavigationMenuTrigger>Products</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="grid w-64 gap-1">
                <li>
                  <NavigationMenuLink href="#analytics">
                    Analytics
                  </NavigationMenuLink>
                </li>
                <li>
                  <NavigationMenuLink href="#automation">
                    Automation
                  </NavigationMenuLink>
                </li>
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink href="#docs">Docs</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </div>
  ),
};

export const LinksOnly: Story = {
  render: (args) => (
    <NavigationMenu {...args} aria-label="Primary">
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuLink href="#home" active>
            Home
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#pricing">Pricing</NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};
