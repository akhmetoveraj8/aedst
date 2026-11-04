"use client";

import { loadOutboxHandlers } from "@/app/config/modules/outbox-handlers";
import { OutboxProvider } from "@/shared/lib/outbox/OutboxProvider";

/** Client boundary that binds the feature modules' handlers to the outbox. */
export function AppOutboxProvider({ children }: { children: React.ReactNode }) {
  return (
    <OutboxProvider loadHandlers={loadOutboxHandlers}>
      {children}
    </OutboxProvider>
  );
}
