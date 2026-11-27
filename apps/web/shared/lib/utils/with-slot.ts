import { cn } from "cn";
import * as React from "react";

/**
 * Wraps a primitive (or an element tag) into a kit part: it gets a
 * `data-slot` name and base classes, and the caller's `className` is merged
 * last. For parts that add nothing else, so a file of ten of them stays short
 * and every part is styled the same way.
 */
function withSlot<C extends React.ElementType>(
  Component: C,
  slot: string,
  base?: string,
): (props: React.ComponentProps<C>) => React.ReactElement {
  function Slotted({ className, ...props }: React.ComponentProps<C>) {
    const merged =
      typeof className === "function" ? className : cn(base, className);
    return React.createElement(Component, {
      "data-slot": slot,
      ...props,
      // Base UI also accepts a function of the state here; only a string is merged.
      className: merged || undefined,
    });
  }
  Slotted.displayName = `Slot(${slot})`;
  return Slotted;
}

export { withSlot };
