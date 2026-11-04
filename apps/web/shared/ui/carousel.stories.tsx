import type { Meta, StoryObj } from "@storybook/nextjs-vite";

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
