"use client";

import { create } from "zustand";

/**
 * Whether the command palette is open: client UI state shared by the
 * header trigger, the global ⌘K/Ctrl+K shortcut and the dialog itself,
 * which live in different parts of the tree.
 */
type CommandPaletteState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

export const useCommandPalette = create<CommandPaletteState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
