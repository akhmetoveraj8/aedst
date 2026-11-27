"use client";

import {
  ArrowRight01Icon,
  File01Icon,
  Folder01Icon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";

import { withSlot } from "@/shared/lib/utils/with-slot";
import {
  type AiFileTreeProps,
  FileTreeContext,
  type FileTreeState,
  GROUP,
  LevelContext,
  ROW,
  useFileTree,
} from "@/shared/ui/ai-file-tree-context";
import { annotateTreeItems, handleTreeKey } from "@/shared/ui/ai-file-tree-nav";

/**
 * The files the agent changed, as a WAI-ARIA tree (`tree`, `treeitem`,
 * `group`, with level, set size, position, expanded and selected). One item is
 * in the tab order (roving tabindex): Up/Down move, Home/End jump, the
 * forward arrow opens a folder or enters it, the backward arrow closes it or
 * goes to its parent (forward is Right in LTR and Left in RTL), Enter/Space
 * opens a folder or selects a file, and typing a letter jumps to the next
 * name that starts with it. Name the tree with `aria-label`.
 */
function AiFileTree({
  expanded,
  defaultExpanded,
  onExpandedChange,
  selectedPath,
  onSelect,
  className,
  onKeyDown,
  ...props
}: AiFileTreeProps) {
  const [inner, setInner] = React.useState<ReadonlySet<string>>(
    () => defaultExpanded ?? new Set(),
  );
  const [activePath, setActivePath] = React.useState<string | undefined>(
    selectedPath,
  );
  const current = expanded ?? inner;
  const treeRef = React.useRef<HTMLDivElement>(null);
  const typed = React.useRef({ text: "", timer: 0 });

  const toggle = React.useCallback(
    (path: string, open: boolean) => {
      const next = new Set(current);
      if (open) {
        next.add(path);
      } else {
        next.delete(path);
      }
      setInner(next);
      onExpandedChange?.(next);
    },
    [current, onExpandedChange],
  );

  // setsize and posinset need to know the siblings, which only the DOM has
  // once the children are rendered; `level` comes from context (SSR-safe).
  // Also guarantees exactly one tab stop, even if the active item vanished.
  React.useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const firstPath = annotateTreeItems(tree);
    if (firstPath !== undefined) setActivePath(firstPath);
  });

  React.useEffect(() => {
    const state = typed.current;
    return () => window.clearTimeout(state.timer);
  }, []);

  const focus = (item: HTMLElement | null | undefined) => {
    if (!item) return;
    if (item.dataset.path !== undefined) setActivePath(item.dataset.path);
    item.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const handled = handleTreeKey(event, {
      focus,
      toggle,
      select: (path) => onSelect?.(path),
      typed: typed.current,
    });
    if (handled) event.preventDefault();
  };

  const state = React.useMemo<FileTreeState>(
    () => ({
      expanded: current,
      toggle,
      selectedPath,
      onSelect,
      activePath,
      setActivePath,
    }),
    [current, toggle, selectedPath, onSelect, activePath],
  );

  return (
    <FileTreeContext value={state}>
      <div
        ref={treeRef}
        role="tree"
        data-slot="ai-file-tree"
        className={cn("flex w-full flex-col text-sm", className)}
        onKeyDown={handleKeyDown}
        {...props}
      />
    </FileTreeContext>
  );
}

interface AiFileTreeFolderProps
  extends Omit<React.ComponentProps<"div">, "children"> {
  path: string;
  name: string;
  children?: React.ReactNode;
}

function AiFileTreeFolder({
  path,
  name,
  children,
  className,
  ...props
}: AiFileTreeFolderProps) {
  const { expanded, toggle, activePath, setActivePath } =
    useFileTree("AiFileTreeFolder");
  const level = React.use(LevelContext);
  const groupId = React.useId();
  const nameId = React.useId();
  const open = expanded.has(path);

  return (
    <div
      role="none"
      data-slot="ai-file-tree-folder"
      className={cn("flex flex-col", className)}
      {...props}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled by the tree (onKeyDown) */}
      <div
        role="treeitem"
        data-slot="ai-file-tree-row"
        data-path={path}
        aria-level={level}
        aria-expanded={open}
        aria-owns={open ? groupId : undefined}
        // The owned group is part of the content; the name is the folder's own.
        aria-labelledby={nameId}
        tabIndex={activePath === path ? 0 : -1}
        className={ROW}
        onClick={(event) => {
          setActivePath(path);
          event.currentTarget.focus();
          toggle(path, !open);
        }}
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          aria-hidden="true"
          className="text-muted-foreground transition-transform group-aria-expanded/ai-item:rotate-90 motion-reduce:transition-none rtl:rotate-180 rtl:group-aria-expanded/ai-item:rotate-90"
        />
        <AiFileTreeIcon icon={open ? FolderOpenIcon : Folder01Icon} />
        <AiFileTreeName id={nameId}>{name}</AiFileTreeName>
      </div>
      {open ? (
        <LevelContext value={level + 1}>
          <div role="group" id={groupId} className={GROUP}>
            {children}
          </div>
        </LevelContext>
      ) : null}
    </div>
  );
}

interface AiFileTreeFileProps
  extends Omit<React.ComponentProps<"div">, "children"> {
  path: string;
  name: string;
  icon?: IconSvgElement;
  /** Shown at the end of the row, outside the name: a badge, a menu. */
  actions?: React.ReactNode;
}

function AiFileTreeFile({
  path,
  name,
  icon = File01Icon,
  actions,
  className,
  ...props
}: AiFileTreeFileProps) {
  const { selectedPath, onSelect, activePath, setActivePath } =
    useFileTree("AiFileTreeFile");
  const level = React.use(LevelContext);
  const selected = selectedPath === path;

  return (
    <div
      role="none"
      data-slot="ai-file-tree-file"
      data-selected={selected || undefined}
      className={cn("flex items-center gap-1", className)}
      {...props}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled by the tree (onKeyDown) */}
      <div
        role="treeitem"
        data-slot="ai-file-tree-row"
        data-path={path}
        aria-level={level}
        aria-selected={selected}
        tabIndex={activePath === path ? 0 : -1}
        // Aligns with folder names, which have a chevron before the icon.
        className={cn(
          ROW,
          "ps-7",
          selected && "bg-accent text-accent-foreground",
        )}
        onClick={(event) => {
          setActivePath(path);
          event.currentTarget.focus();
          onSelect?.(path);
        }}
      >
        <AiFileTreeIcon icon={icon} />
        <AiFileTreeName>{name}</AiFileTreeName>
      </div>
      {actions ? <AiFileTreeActions>{actions}</AiFileTreeActions> : null}
    </div>
  );
}

interface AiFileTreeIconProps
  extends Omit<React.ComponentProps<typeof HugeiconsIcon>, "icon"> {
  icon: IconSvgElement;
}

function AiFileTreeIcon({ icon, className, ...props }: AiFileTreeIconProps) {
  return (
    <HugeiconsIcon
      data-slot="ai-file-tree-icon"
      icon={icon}
      strokeWidth={2}
      aria-hidden="true"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

/** File and folder names stay left-to-right (paths), truncated. */
function AiFileTreeName({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="ai-file-tree-name"
      dir="ltr"
      className={cn("min-w-0 truncate font-mono text-xs", className)}
      {...props}
    />
  );
}

const AiFileTreeActions = withSlot(
  "div",
  "ai-file-tree-actions",
  "flex shrink-0 items-center gap-1",
);

export {
  AiFileTree,
  AiFileTreeActions,
  AiFileTreeFile,
  type AiFileTreeFileProps,
  AiFileTreeFolder,
  type AiFileTreeFolderProps,
  AiFileTreeIcon,
  type AiFileTreeIconProps,
  AiFileTreeName,
  type AiFileTreeProps,
};
