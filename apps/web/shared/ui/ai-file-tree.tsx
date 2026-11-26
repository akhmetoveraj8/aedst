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

import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";

interface FileTreeState {
  expanded: ReadonlySet<string>;
  toggle: (path: string, open: boolean) => void;
  selectedPath: string | undefined;
  onSelect: ((path: string) => void) | undefined;
}

const FileTreeContext = React.createContext<FileTreeState | null>(null);

function useFileTree(part: string): FileTreeState {
  const state = React.use(FileTreeContext);
  if (!state) {
    throw new Error(`${part} must be used inside <AiFileTree>`);
  }
  return state;
}

interface AiFileTreeProps extends Omit<React.ComponentProps<"ul">, "onSelect"> {
  /** Open folders (controlled), by path. */
  expanded?: ReadonlySet<string>;
  /** Open folders on first render (uncontrolled). */
  defaultExpanded?: ReadonlySet<string>;
  onExpandedChange?: (expanded: ReadonlySet<string>) => void;
  /** Path of the selected file (`aria-current`). */
  selectedPath?: string;
  onSelect?: (path: string) => void;
}

/**
 * The files the agent changed, as folders that open and close. A folder is a
 * disclosure button (Collapsible), a file is a button; both are reached with
 * Tab and activated with Enter/Space. Name the tree with `aria-label`.
 */
function AiFileTree({
  expanded,
  defaultExpanded,
  onExpandedChange,
  selectedPath,
  onSelect,
  className,
  ...props
}: AiFileTreeProps) {
  const [inner, setInner] = React.useState<ReadonlySet<string>>(
    () => defaultExpanded ?? new Set(),
  );
  const current = expanded ?? inner;

  const state = React.useMemo<FileTreeState>(
    () => ({
      expanded: current,
      toggle: (path, open) => {
        const next = new Set(current);
        if (open) {
          next.add(path);
        } else {
          next.delete(path);
        }
        setInner(next);
        onExpandedChange?.(next);
      },
      selectedPath,
      onSelect,
    }),
    [current, onExpandedChange, selectedPath, onSelect],
  );

  return (
    <FileTreeContext value={state}>
      <ul
        data-slot="ai-file-tree"
        className={cn("flex w-full flex-col text-sm", className)}
        {...props}
      />
    </FileTreeContext>
  );
}

const ROW =
  "w-full justify-start font-normal aria-expanded:bg-transparent aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/50";

interface AiFileTreeFolderProps
  extends Omit<React.ComponentProps<"li">, "children"> {
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
  const { expanded, toggle } = useFileTree("AiFileTreeFolder");
  const open = expanded.has(path);

  return (
    <li data-slot="ai-file-tree-folder" className={className} {...props}>
      <Collapsible open={open} onOpenChange={(next) => toggle(path, next)}>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={cn(ROW, "group/ai-folder")}
            />
          }
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            aria-hidden="true"
            className="text-muted-foreground transition-transform group-aria-expanded/ai-folder:rotate-90 motion-reduce:transition-none rtl:rotate-180 rtl:group-aria-expanded/ai-folder:rotate-90"
          />
          <AiFileTreeIcon icon={open ? FolderOpenIcon : Folder01Icon} />
          <AiFileTreeName>{name}</AiFileTreeName>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="ms-4 flex flex-col border-s ps-1">{children}</ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

interface AiFileTreeFileProps
  extends Omit<React.ComponentProps<"li">, "children"> {
  path: string;
  name: string;
  icon?: IconSvgElement;
  /** Shown next to the file button (never inside it): a badge, a menu. */
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
  const { selectedPath, onSelect } = useFileTree("AiFileTreeFile");
  const selected = selectedPath === path;

  return (
    <li
      data-slot="ai-file-tree-file"
      data-selected={selected || undefined}
      className={cn("flex items-center gap-1", className)}
      {...props}
    >
      <Button
        variant="ghost"
        size="sm"
        // Aligns with folder names, which have a chevron before the icon.
        className={cn(
          ROW,
          "min-w-0 flex-1 ps-7",
          selected && "bg-accent text-accent-foreground",
        )}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect?.(path)}
      >
        <AiFileTreeIcon icon={icon} />
        <AiFileTreeName>{name}</AiFileTreeName>
      </Button>
      {actions ? <AiFileTreeActions>{actions}</AiFileTreeActions> : null}
    </li>
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

function AiFileTreeActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-file-tree-actions"
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}

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
