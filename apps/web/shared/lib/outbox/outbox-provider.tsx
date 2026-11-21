"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, use, useEffect, useRef, useState } from "react";
import { useAuth } from "@/shared/lib/auth/AuthProvider";
import { registerBeforeSignOut } from "@/shared/lib/auth/sign-out-hooks";
import { reportError } from "@/shared/lib/errors/report-error";
import { startDelivery } from "@/shared/lib/outbox/delivery";
import { createIdbOutboxStore } from "@/shared/lib/outbox/idb-store";
import { createOutbox, type Outbox } from "@/shared/lib/outbox/outbox";
import type { OutboxHandler, OutboxRecord } from "@/shared/lib/outbox/types";

/** `null` while signed out or before the browser store is open. */
export const OutboxContext = createContext<Outbox | null>(null);

export function useOutbox(): Outbox | null {
  return use(OutboxContext);
}

/**
 * The queue's records (pending and parked), refreshed on every change. Empty
 * until the store has been read.
 */
export function useOutboxItems(): readonly OutboxRecord[] {
  const outbox = useOutbox();
  const [items, setItems] = useState<readonly OutboxRecord[]>([]);

  useEffect(() => {
    if (!outbox) {
      setItems([]);
      return;
    }
    let active = true;
    const refresh = () =>
      outbox
        .list()
        .then((next) => active && setItems(next))
        .catch((error) =>
          reportError(error, { source: "query", feature: "outbox" }),
        );
    void refresh();
    const off = outbox.subscribe(() => void refresh());
    return () => {
      active = false;
      off();
    };
  }, [outbox]);

  return items;
}

/**
 * Owns the signed-in user's outbox: opens the IndexedDB store, wires the
 * handlers feature modules contribute, starts delivery (enqueue / online /
 * visibility), refetches server data after a delivery and drops the queue
 * when the user signs out - before the cookies go (sign-out hook) or because
 * the session expired (user id turned null).
 */
export function OutboxProvider({
  loadHandlers,
  children,
}: {
  loadHandlers: () => Promise<readonly OutboxHandler[]>;
  children: React.ReactNode;
}) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const hadUser = useRef(false);

  useEffect(() => {
    if (!userId) {
      if (hadUser.current) {
        hadUser.current = false;
        void createIdbOutboxStore()
          .clear()
          .catch((error) =>
            reportError(error, { source: "mutation", feature: "outbox" }),
          );
      }
      setOutbox(null);
      return;
    }
    hadUser.current = true;
    let handlers: Promise<ReadonlyMap<string, OutboxHandler>> | undefined;
    const created = createOutbox({
      store: createIdbOutboxStore(),
      owner: userId,
      handlers: () => {
        handlers ??= loadHandlers().then(
          (list) => new Map(list.map((h) => [h.type, h])),
        );
        return handlers;
      },
    });
    setOutbox(created);
    const stopDelivery = startDelivery(created);
    const offSignOut = registerBeforeSignOut(() => created.clear());
    const offEvents = created.subscribe((event) => {
      // Once per drain, not per delivered item: the one place that
      // refetches everything (a delivered write may touch any module).
      if (event.kind === "drained") {
        void queryClient.invalidateQueries();
      }
    });
    return () => {
      stopDelivery();
      offSignOut();
      offEvents();
    };
  }, [userId, queryClient, loadHandlers]);

  return <OutboxContext value={outbox}>{children}</OutboxContext>;
}
