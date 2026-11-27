import * as React from "react";

// Shared state of `ai-file-tree.tsx` (kept apart for file size; not public).

interface FileTreeState {
  expanded: ReadonlySet<string>;
  toggle: (path: string, open: boolean) => void;
  selectedPath: string | undefined;
  onSelect: ((path: string) => void) | undefined;
  /** Path of the one treeitem in the tab order (roving tabindex). */
  activePath: string | undefined;
  setActivePath: (path: string) => void;
}

const FileTreeContext = React.createContext<FileTreeState | null>(null);
/** Depth of the next item: 1 at the top, +1 inside every open folder. */
const LevelContext = React.createContext(1);

function useFileTree(part: string): FileTreeState {
  const state = React.use(FileTreeContext);
  if (!state) {
    throw new Error(`${part} must be used inside <AiFileTree>`);
  }
  return state;
}

/**
 * The treeitem is the row itself (icon + name), so its accessible name is its
 * own text; an open folder links to its group with `aria-owns` instead of
 * wrapping it.
 */
const ROW =
  "group/ai-item flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 pointer-coarse:min-h-11 hover:bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring";
const GROUP = "flex flex-col ms-4 border-s ps-1";

interface AiFileTreeProps
  extends Omit<React.ComponentProps<"div">, "onSelect"> {
  /** Open folders (controlled), by path. */
  expanded?: ReadonlySet<string>;
  /** Open folders on first render (uncontrolled). */
  defaultExpanded?: ReadonlySet<string>;
  onExpandedChange?: (expanded: ReadonlySet<string>) => void;
  /** Path of the selected file (`aria-selected`). */
  selectedPath?: string;
  onSelect?: (path: string) => void;
}

export {
  type AiFileTreeProps,
  FileTreeContext,
  type FileTreeState,
  GROUP,
  LevelContext,
  ROW,
  useFileTree,
};
