import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { Toaster } from "@/shared/ui/sonner";

const meta = {
  title: "UI/Sonner",
  component: Toaster,
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      <Toaster {...args} />
      <Button variant="outline" onClick={() => toast("Event created")}>
        Default
      </Button>
      <Button variant="outline" onClick={() => toast.success("Saved")}>
        Success
      </Button>
      <Button variant="outline" onClick={() => toast.error("Not saved")}>
        Error
      </Button>
    </div>
  ),
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const TopCenter: Story = { args: { position: "top-center" } };
