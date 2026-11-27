import type * as React from "react";

/**
 * DOM helpers for the WAI-ARIA tree pattern used by `ai-file-tree`: which
 * treeitem is next, parent, first or last, and typeahead. Collapsed folders
 * do not render their group, so "every treeitem in the DOM" is exactly the
 * set of visible items, in visual order.
 */

const ITEM = '[role="treeitem"]';

function treeItems(tree: HTMLElement): HTMLElement[] {
  return Array.from(tree.querySelectorAll<HTMLElement>(ITEM));
}

/** The folder that owns the group `item` sits in (`aria-owns` link). */
function parentItem(item: HTMLElement): HTMLElement | null {
  const group = item.closest<HTMLElement>('[role="group"]');
  if (!group?.id) return null;
  const root = item.closest<HTMLElement>('[role="tree"]');
  return (
    Array.from(root?.querySelectorAll<HTMLElement>("[aria-owns]") ?? []).find(
      (owner) => owner.getAttribute("aria-owns") === group.id,
    ) ?? null
  );
}

/** The first child treeitem of an open folder, if any. */
function firstChildItem(item: HTMLElement): HTMLElement | null {
  const id = item.getAttribute("aria-owns");
  const group = id ? document.getElementById(id) : null;
  return group?.querySelector<HTMLElement>(ITEM) ?? null;
}

/** Visible label of a treeitem (the row holds only its own name). */
function itemLabel(item: HTMLElement): string {
  return item.textContent?.trim().toLowerCase() ?? "";
}

/**
 * The next item whose name starts with `query`, searching after `from` and
 * wrapping. A repeated single letter cycles through the matches.
 */
function findByPrefix(
  items: readonly HTMLElement[],
  from: HTMLElement,
  query: string,
): HTMLElement | undefined {
  const start = items.indexOf(from);
  const cycling = query.length > 1 && [...query].every((c) => c === query[0]);
  const needle = cycling ? query[0] : query;
  for (let step = 1; step <= items.length; step += 1) {
    const candidate = items[(start + step) % items.length];
    if (candidate && itemLabel(candidate).startsWith(needle ?? "")) {
      return candidate;
    }
  }
  return undefined;
}

/** `true` for a key that starts or extends a typeahead (one printable char). */
function isTypeaheadKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    event.key.length === 1 &&
    event.key !== " " &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

/**
 * Sets `aria-setsize` and `aria-posinset` (they need the siblings, which only
 * the rendered DOM has; `aria-level` comes from React context). Returns the
 * path of the first item when no item is in the tab order, else undefined.
 */
function annotateTreeItems(tree: HTMLElement): string | undefined {
  const items = treeItems(tree);
  const levelOf = (item: HTMLElement) =>
    item.closest('[role="group"], [role="tree"]');
  for (const item of items) {
    const siblings = items.filter((other) => levelOf(other) === levelOf(item));
    item.setAttribute("aria-setsize", String(siblings.length));
    item.setAttribute("aria-posinset", String(siblings.indexOf(item) + 1));
  }
  return items.some((item) => item.tabIndex === 0)
    ? undefined
    : items[0]?.dataset.path;
}

interface TreeKeyHost {
  focus: (item: HTMLElement | null | undefined) => void;
  toggle: (path: string, open: boolean) => void;
  select: (path: string) => void;
  /** Typeahead buffer, cleared 500 ms after the last key. */
  typed: { text: string; timer: number };
}

/**
 * The keyboard map of the tree pattern. Returns `true` when the key was
 * handled (the caller prevents the default). Forward is Right in LTR and Left
 * in RTL. Keys typed inside an action (button, menu) are left alone.
 */
function handleTreeKey(
  event: React.KeyboardEvent<HTMLElement>,
  host: TreeKeyHost,
): boolean {
  const item = event.target as HTMLElement;
  if (item.getAttribute("role") !== "treeitem") return false;
  const tree = event.currentTarget;
  const items = treeItems(tree);
  const index = items.indexOf(item);
  const isFolder = item.hasAttribute("aria-expanded");
  const isOpen = item.getAttribute("aria-expanded") === "true";
  const rtl = getComputedStyle(tree).direction === "rtl";
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const backward = rtl ? "ArrowRight" : "ArrowLeft";
  const path = item.dataset.path ?? "";
  const { key } = event;

  if (key === "ArrowDown") host.focus(items[index + 1]);
  else if (key === "ArrowUp") host.focus(items[index - 1]);
  else if (key === "Home") host.focus(items[0]);
  else if (key === "End") host.focus(items.at(-1));
  else if (key === forward) {
    if (isFolder && !isOpen) host.toggle(path, true);
    else if (isFolder) host.focus(firstChildItem(item));
  } else if (key === backward) {
    if (isFolder && isOpen) host.toggle(path, false);
    else host.focus(parentItem(item));
  } else if (key === "Enter" || key === " ") {
    if (isFolder) host.toggle(path, !isOpen);
    else host.select(path);
  } else if (isTypeaheadKey(event)) {
    window.clearTimeout(host.typed.timer);
    host.typed.text += key.toLowerCase();
    host.typed.timer = window.setTimeout(() => {
      host.typed.text = "";
    }, 500);
    host.focus(findByPrefix(items, item, host.typed.text));
  } else {
    return false;
  }
  return true;
}

export { annotateTreeItems, handleTreeKey };
