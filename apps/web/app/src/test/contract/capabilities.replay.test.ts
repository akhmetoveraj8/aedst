import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { disabledRoutePrefixes } from "@/app/config/modules/registry";
import { CLIENT_VERSION } from "@/shared/api/connect/client-id";
import {
  GetCapabilitiesResponseSchema,
  UpdateStatus,
} from "@/shared/api/connect/generated/aedst/capabilities/v1/capabilities_pb";
import {
  type CapabilitySnapshot,
  chooseSnapshot,
  isFeatureShown,
} from "@/shared/lib/capabilities/evaluate";
import { parseSnapshot, toSnapshot } from "@/shared/lib/capabilities/snapshot";
import contract from "../../../../../../docs/contract/behavior/capabilities.json";

/**
 * Replays docs/contract/behavior/capabilities.json. The fixture's `clientBuild`
 * describes android 1.3.0; the rules are platform-independent, so they are
 * replayed against that build description and the shared evaluator. Web's own
 * build (its manifests) is checked separately below.
 */
type FixtureFeatures = Record<
  string,
  { enabled: boolean; requiredClientVersion?: string }
>;

function snapshot(features: FixtureFeatures): CapabilitySnapshot {
  return {
    features,
    updateStatus: "current",
    minimum: "",
    recommended: "",
    fetchedAt: 0,
  };
}

const { clientBuild } = contract;
const asked = (expect_: object) => Object.keys(expect_);

describe("capabilities contract (replay)", () => {
  it.each(contract.cases)("$id", ({ server, lastKnown, expect: expected }) => {
    const fetched = server
      ? snapshot(server.features as unknown as FixtureFeatures)
      : null;
    const known = lastKnown
      ? snapshot(lastKnown.features as unknown as FixtureFeatures)
      : null;
    const effective = chooseSnapshot(fetched, known);

    for (const name of asked(expected)) {
      const built = clientBuild.features.includes(name);
      const shown =
        built &&
        isFeatureShown(
          { name, flagged: clientBuild.flagged.includes(name) },
          effective,
          clientBuild.version,
        );
      expect(shown, name).toBe(
        (expected as unknown as Record<string, boolean>)[name],
      );
    }
  });
});

describe("capabilities on web", () => {
  it("maps coarse module ids and the typed required_client_version", () => {
    const mapped = toSnapshot(
      create(GetCapabilitiesResponseSchema, {
        features: {
          tasks: { enabled: true, requiredClientVersion: "999.0.0" },
          media: { enabled: true, requiredClientVersion: "0.0.1" },
          "media.uploads": { enabled: true },
          // A stale param must not be read as the requirement any more.
          search: {
            enabled: true,
            params: { requiredClientVersion: "999.0.0" },
          },
        },
      }),
      1,
    );
    expect(mapped.features["tasks"]?.requiredClientVersion).toBe("999.0.0");
    expect(mapped.features["media.uploads"]?.requiredClientVersion).toBe(
      undefined,
    );
    const shown = (name: string) =>
      isFeatureShown({ name, flagged: false }, mapped, CLIENT_VERSION);
    expect(shown("tasks")).toBe(false);
    expect(shown("media")).toBe(true);
    expect(shown("search")).toBe(true);
    // Unlisted built-in on, unlisted flagged off.
    expect(shown("admin")).toBe(true);
    expect(
      isFeatureShown({ name: "admin", flagged: true }, mapped, CLIENT_VERSION),
    ).toBe(false);
  });

  it("enabled=false wins over a satisfied required_client_version", () => {
    const mapped = toSnapshot(
      create(GetCapabilitiesResponseSchema, {
        features: {
          notifications: { enabled: false, requiredClientVersion: "0.0.1" },
        },
      }),
      1,
    );
    expect(
      isFeatureShown(
        { name: "notifications", flagged: false },
        mapped,
        CLIENT_VERSION,
      ),
    ).toBe(false);
  });

  it("maps the wire response (typed version, support window, update status)", () => {
    const response = create(GetCapabilitiesResponseSchema, {
      serverVersion: "1.2.3",
      updateStatus: UpdateStatus.RECOMMENDED,
      clients: { web: { minimum: "1.0.0", recommended: "1.1.0" } },
      features: {
        search: { enabled: false },
        tasks: { enabled: true, requiredClientVersion: "9.0.0" },
      },
    });
    const mapped = toSnapshot(response, 5);

    expect(mapped).toEqual({
      features: {
        search: { enabled: false, requiredClientVersion: undefined },
        tasks: { enabled: true, requiredClientVersion: "9.0.0" },
      },
      updateStatus: "recommended",
      minimum: "1.0.0",
      recommended: "1.1.0",
      fetchedAt: 5,
    });
    expect(parseSnapshot(JSON.parse(JSON.stringify(mapped)))).toEqual(mapped);
    expect(
      isFeatureShown({ name: "tasks", flagged: false }, mapped, CLIENT_VERSION),
    ).toBe(false);
  });

  it("ignores a corrupt cached snapshot", () => {
    expect(parseSnapshot("nope")).toBeNull();
    expect(parseSnapshot({ features: 3 })).toBeNull();
  });

  it("denies the routes of a disabled module and none by default", () => {
    // No flagged module is left in this project, so nothing is off before negotiation.
    expect(disabledRoutePrefixes(null)).toEqual([]);
    expect(
      disabledRoutePrefixes(
        snapshot({ search: { enabled: false }, admin: { enabled: true } }),
      ),
    ).toEqual(["/search"]);
    // Unknown server features never matter.
    expect(
      disabledRoutePrefixes(
        snapshot({ teleport: { enabled: true }, admin: { enabled: true } }),
      ),
    ).toEqual([]);
  });

  it("never denies the public sign-in route, even if auth is switched off", () => {
    expect(
      disabledRoutePrefixes(snapshot({ auth: { enabled: false } })),
    ).not.toContain("/");
  });
});
