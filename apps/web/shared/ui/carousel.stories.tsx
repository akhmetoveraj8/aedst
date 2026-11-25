import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/shared/ui/carousel";

const slides = ["One", "Two", "Three", "Four"];

const meta = {
  title: "UI/Carousel",
  component: Carousel,
  decorators: [
    (Story) => (
      <div className="w-72 px-12 py-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Carousel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Carousel {...args}>
      <CarouselContent>
        {slides.map((slide) => (
          <CarouselItem key={slide}>
            <div className="flex aspect-square items-center justify-center rounded-lg bg-muted text-lg text-foreground">
              {slide}
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <Carousel {...args}>
      <CarouselContent className="h-48">
        {slides.map((slide) => (
          <CarouselItem key={slide}>
            <div className="flex h-full items-center justify-center rounded-lg bg-muted text-lg text-foreground">
              {slide}
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  ),
};

export const Looping: Story = {
  args: { opts: { loop: true } },
  render: (args) => (
    <Carousel {...args}>
      <CarouselContent>
        {slides.map((slide) => (
          <CarouselItem key={slide}>
            <div className="flex aspect-video items-center justify-center rounded-lg bg-secondary text-lg text-secondary-foreground">
              {slide}
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  ),
};

/** In RTL the next slide is on the left, so ArrowLeft moves forward. */
export const RightToLeftKeyboard: Story = {
  globals: { direction: "rtl" },
  render: Default.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const previous = canvas.getByRole("button", { name: "Previous slide" });
    const next = canvas.getByRole("button", { name: "Next slide" });
    await waitFor(() => expect(next).toBeEnabled());
    await expect(previous).toBeDisabled();
    next.focus();
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(previous).toBeEnabled());
    const viewport = canvasElement.querySelector<HTMLElement>(
      '[data-slot="carousel-content"]',
    );
    const second = canvas.getByText("Two");
    await waitFor(() => {
      const a = viewport?.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      expect(Math.abs((a?.right ?? 0) - b.right)).toBeLessThan(2);
    });
  },
};
