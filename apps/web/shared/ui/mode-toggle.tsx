"use client";

import { Moon01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTheme } from "next-themes";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

export type ModeToggleLabels = {
  /** Accessible name of the trigger (it shows only an icon). */
  toggle: string;
  light: string;
  dark: string;
  system: string;
};

/**
 * Theme menu. The kit never hardcodes user-facing text: the host project
 * passes `labels` from its own catalogue, in the active locale.
 */
export function ModeToggle({ labels }: { labels: ModeToggleLabels }) {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      {/* `render`: the trigger IS the button. Wrapping a Button in the trigger
          nests two buttons (axe: nested-interactive). */}
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="icon" aria-label={labels.toggle} />
        }
      >
        <HugeiconsIcon
          icon={Sun01Icon}
          className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90"
        />
        <HugeiconsIcon
          icon={Moon01Icon}
          className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          {labels.light}
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => setTheme("dark")}>
          {labels.dark}
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => setTheme("system")}>
          {labels.system}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
