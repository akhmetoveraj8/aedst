import type { GetCapabilitiesResponse } from "@/shared/api/connect/generated/aedst/capabilities/v1/capabilities_pb";
import { UpdateStatus } from "@/shared/api/connect/generated/aedst/capabilities/v1/capabilities_pb";
import type { CapabilitySnapshot } from "@/shared/lib/capabilities/evaluate";

const PLATFORM = "web";

const UPDATE_STATUS = {
  [UpdateStatus.UNSPECIFIED]: "unspecified",
  [UpdateStatus.CURRENT]: "current",
  [UpdateStatus.RECOMMENDED]: "recommended",
} as const;

export function toSnapshot(
  response: GetCapabilitiesResponse,
  now: number = Date.now(),
): CapabilitySnapshot {
  const features: CapabilitySnapshot["features"] = Object.fromEntries(
    Object.entries(response.features).map(([name, feature]) => [
      name,
      {
        enabled: feature.enabled,
        // The typed proto field; "" means no requirement.
        requiredClientVersion: feature.requiredClientVersion || undefined,
      },
    ]),
  );
  const window = response.clients[PLATFORM];
  return {
    features,
    updateStatus: UPDATE_STATUS[response.updateStatus] ?? "unspecified",
    minimum: window?.minimum ?? "",
    recommended: window?.recommended ?? "",
    fetchedAt: now,
  };
}

/** Rejects anything that is not a snapshot (a corrupt or older cache entry). */
export function parseSnapshot(raw: unknown): CapabilitySnapshot | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as Partial<CapabilitySnapshot>;
  if (
    typeof value.features !== "object" ||
    value.features === null ||
    typeof value.fetchedAt !== "number"
  ) {
    return null;
  }
  const features: CapabilitySnapshot["features"] = Object.fromEntries(
    Object.entries(value.features).flatMap(([name, feature]) =>
      feature && typeof feature.enabled === "boolean"
        ? [
            [
              name,
              {
                enabled: feature.enabled,
                requiredClientVersion:
                  typeof feature.requiredClientVersion === "string"
                    ? feature.requiredClientVersion
                    : undefined,
              },
            ],
          ]
        : [],
    ),
  );
  return {
    features,
    updateStatus: value.updateStatus ?? "unspecified",
    minimum: typeof value.minimum === "string" ? value.minimum : "",
    recommended: typeof value.recommended === "string" ? value.recommended : "",
    fetchedAt: value.fetchedAt,
  };
}
