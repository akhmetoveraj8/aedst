"use client";

import { createClient } from "@connectrpc/connect";
import { useTransport } from "@connectrpc/connect-query";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { CapabilitiesService } from "@/shared/api/connect/generated/aedst/capabilities/v1/capabilities_pb";
import {
  type CapabilitySnapshot,
  chooseSnapshot,
} from "@/shared/lib/capabilities/evaluate";
import {
  readLastKnown,
  writeLastKnown,
} from "@/shared/lib/capabilities/last-known";
import { toSnapshot } from "@/shared/lib/capabilities/snapshot";

const STALE_MS = 5 * 60_000;

/** `null` = nothing negotiated: built-in features on, flagged ones off. */
const CapabilitiesContext = createContext<CapabilitySnapshot | null>(null);

/**
 * Negotiates capabilities for the signed-in shell. The server's snapshot (from
 * the request-scoped TTL cache) renders first so there is no flash; the browser
 * then refreshes it on mount, window focus and reconnect (resume) at most every
 * few minutes. On failure the last snapshot this browser stored is used.
 */
export function CapabilitiesProvider({
  initial,
  children,
}: Readonly<{
  initial: CapabilitySnapshot | null;
  children: React.ReactNode;
}>) {
  const transport = useTransport();
  const client = useMemo(
    () => createClient(CapabilitiesService, transport),
    [transport],
  );
  const [stored, setStored] = useState<CapabilitySnapshot | null>(null);
  useEffect(() => setStored(readLastKnown()), []);

  const { data } = useQuery({
    queryKey: ["capabilities"],
    queryFn: async () => toSnapshot(await client.getCapabilities({})),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial?.fetchedAt,
    staleTime: STALE_MS,
    retry: 1,
    meta: { feature: "capabilities" },
  });
  useEffect(() => {
    if (data) {
      writeLastKnown(data);
    }
  }, [data]);

  return (
    <CapabilitiesContext value={chooseSnapshot(data, stored)}>
      {children}
    </CapabilitiesContext>
  );
}

export function useCapabilities(): CapabilitySnapshot | null {
  return useContext(CapabilitiesContext);
}
