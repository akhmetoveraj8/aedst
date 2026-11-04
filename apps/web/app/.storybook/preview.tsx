import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { useEffect } from "react";

import { DirectionProvider } from "@/shared/ui/direction";
import { TooltipProvider } from "@/shared/ui/tooltip";

import "../src/app/styles/globals.css";

type Theme = "light" | "dark";
type Direction = "ltr" | "rtl";

/**
 * Toolbar-driven theme (`.dark` class, the same switch next-themes uses) and
 * text direction (`dir` on <html> plus Base UI's DirectionProvider, as in the
 * app's locale layout), so every story can be checked in light/dark and RTL.
 */
const withThemeAndDirection: Decorator = (Story, context) => {
  const theme = (context.globals.theme ?? "light") as Theme;
  const direction = (context.globals.direction ?? "ltr") as Direction;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    root.dir = direction;
  }, [theme, direction]);

  return (
    <DirectionProvider direction={direction}>
      <TooltipProvider>
        <div className="bg-background p-6 font-sans text-foreground">
          <Story />
        </div>
      </TooltipProvider>
    </DirectionProvider>
  );
};

const preview: Preview = {
  decorators: [withThemeAndDirection],
  globalTypes: {
    theme: {
      description: "Color theme",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
    direction: {
      description: "Text direction",
      toolbar: {
        title: "Direction",
        icon: "transfer",
        items: [
          { value: "ltr", title: "LTR" },
          { value: "rtl", title: "RTL" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light", direction: "ltr" },
  parameters: {
    layout: "centered",
    controls: { expanded: true },
    // Accessibility violations fail the story test (`pnpm test:stories`).
    a11y: { test: "error" },
  },
};

export default preview;
