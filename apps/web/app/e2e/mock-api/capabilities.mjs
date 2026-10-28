// aedst.capabilities.v1.CapabilitiesService: what a default apps/server advertises (every registered module is
// enabled, nothing is gated by client version). The web client treats `admin` as a flagged feature, so the e2e
// suite needs this to see the admin pages at all.
const MODULES = ["auth", "tasks", "search", "notifications", "media", "admin"];

export const capabilities = {
  GetCapabilities() {
    return {
      serverVersion: "mock",
      clients: {},
      features: Object.fromEntries(
        MODULES.map((name) => [name, { enabled: true }]),
      ),
      updateStatus: "UPDATE_STATUS_CURRENT",
    };
  },
};
