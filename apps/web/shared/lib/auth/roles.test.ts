import { describe, expect, it } from "vitest";

import {
  ADMIN_ROLE,
  type AdminPermission,
  AUDITOR_ROLE,
  can,
  isOperator,
  SUPPORT_ROLE,
} from "./roles";

describe("admin permissions", () => {
  it("lets admin do everything", () => {
    const all: AdminPermission[] = [
      "overview.read",
      "users.read",
      "tasks.read",
      "tasks.delete",
      "notifications.broadcast",
      "audit.read",
    ];
    for (const permission of all) {
      expect(can([ADMIN_ROLE], permission)).toBe(true);
    }
  });

  it("keeps support read-only and away from the audit log", () => {
    expect(can([SUPPORT_ROLE], "users.read")).toBe(true);
    expect(can([SUPPORT_ROLE], "tasks.delete")).toBe(false);
    expect(can([SUPPORT_ROLE], "notifications.broadcast")).toBe(false);
    expect(can([SUPPORT_ROLE], "audit.read")).toBe(false);
  });

  it("keeps auditor to the overview and the audit log", () => {
    expect(can([AUDITOR_ROLE], "overview.read")).toBe(true);
    expect(can([AUDITOR_ROLE], "audit.read")).toBe(true);
    expect(can([AUDITOR_ROLE], "users.read")).toBe(false);
    expect(can([AUDITOR_ROLE], "tasks.read")).toBe(false);
  });

  it("denies everything to a plain user", () => {
    expect(isOperator(["user"])).toBe(false);
    expect(can(["user"], "overview.read")).toBe(false);
  });

  it("treats any operator role as an operator", () => {
    expect(isOperator([SUPPORT_ROLE])).toBe(true);
    expect(isOperator([AUDITOR_ROLE])).toBe(true);
    expect(isOperator([])).toBe(false);
  });
});
