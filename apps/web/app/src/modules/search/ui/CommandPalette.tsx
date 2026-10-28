"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useCommandPalette } from "@/modules/search/lib/command-palette-store";
import { track } from "@/shared/lib/analytics/analytics";
import { useFeatureFlag } from "@/shared/lib/analytics/use-feature-flag";
import { Button } from "@/shared/ui/button";
import { Kbd } from "@/shared/ui/kbd";

// cmdk and the dialog load on first open, keeping them out of every page's
// first-load JS (this component is mounted in the signed-in layout).
const CommandPaletteDialog = dynamic(
  () => import("@/modules/search/ui/CommandPaletteDialog"),
  { ssr: false },
);

/**
 * ⌘K / Ctrl+K palette: owns the shortcut and mounts the dialog lazily once
 * it has been opened. Behind the `command-palette` flag (default on) as the
 * reference flag-gated feature.
 */
export function CommandPalette() {
  const enabled = useFeatureFlag("command-palette");
  const { open, toggle } = useCommandPalette();
  const hasOpened = useHasOpened(open);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // An IME composition owns its key presses.
      if (event.isComposing) {
        return;
      }
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!useCommandPalette.getState().open) {
          track("command_palette_opened", { via: "shortcut" });
        }
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, toggle]);

  if (!enabled || !hasOpened) {
    return null;
  }
  return <CommandPaletteDialog />;
}

/** True from the first time `open` is true on, so the dialog stays mounted. */
function useHasOpened(open: boolean): boolean {
  const [hasOpened, setHasOpened] = useState(open);
  useEffect(() => {
    if (open) {
      setHasOpened(true);
    }
  }, [open]);
  return hasOpened;
}

/** Header button that opens the palette, showing the shortcut. */
export function CommandPaletteTrigger() {
  const t = useTranslations("search.palette");
  const enabled = useFeatureFlag("command-palette");
  const setOpen = useCommandPalette((state) => state.setOpen);
  const apple = useIsApplePlatform();
  if (!enabled) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        track("command_palette_opened", { via: "button" });
        setOpen(true);
      }}
      aria-keyshortcuts="Control+K Meta+K"
      className="gap-2 rounded-md px-3 py-1.5 font-normal text-muted-foreground hover:bg-muted"
    >
      {t("open")}
      {/* text-foreground: the default muted-on-muted Kbd fails WCAG contrast. */}
      <Kbd className="text-foreground">{apple ? "⌘K" : "Ctrl K"}</Kbd>
    </Button>
  );
}

/** Mac and iOS show the Command key; the server snapshot assumes Ctrl. */
function useIsApplePlatform(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    () => false,
  );
}
