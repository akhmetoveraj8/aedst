"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { identifyUser } from "@/shared/lib/analytics/analytics";
import { addBreadcrumb, setErrorUser } from "@/shared/lib/errors/breadcrumbs";

type AuthContextValue = {
  /** Unverified id of the signed-in user, or `null` when signed out. */
  userId: string | null;
  /** Unverified roles from the access token — UI hints, never authorization. */
  roles: readonly string[];
  isAuthenticated: boolean;
  hasRole: (role: string) => boolean;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const NO_ROLES: readonly string[] = [];

/**
 * Client-side mirror of the server-side session. The tokens themselves live
 * only in httpOnly cookies; this holds nothing secret — just *who* is signed
 * in and which roles their token carries, seeded by the server layout, so
 * there is no signed-out flash and no `localStorage` involved. It also keeps
 * Sentry's user context and analytics identity (id only, no PII) in step
 * with the session.
 *
 * `roles` only decide what to *render* (e.g. the admin link). apps/server
 * re-checks every role on every call, so a tampered client gains nothing.
 */
export function AuthProvider({
  initialUserId = null,
  initialRoles = NO_ROLES,
  children,
}: {
  initialUserId?: string | null;
  initialRoles?: readonly string[];
  children: React.ReactNode;
}) {
  const [userId, setUserId] = useState<string | null>(initialUserId);
  const [roles, setRoles] = useState<readonly string[]>(initialRoles);

  useEffect(() => {
    setUserId(initialUserId);
  }, [initialUserId]);

  // Compared by value: a fresh array from every server render must not
  // reset state that has not changed.
  const rolesKey = initialRoles.join(",");
  useEffect(() => {
    setRoles(rolesKey ? rolesKey.split(",") : NO_ROLES);
  }, [rolesKey]);

  useEffect(() => {
    setErrorUser(userId);
    identifyUser(userId);
  }, [userId]);

  const signOut = useCallback(() => {
    addBreadcrumb({ category: "auth", message: "sign-out" });
    setUserId(null);
    setRoles(NO_ROLES);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      userId,
      roles: userId ? roles : NO_ROLES,
      isAuthenticated: userId !== null,
      hasRole: (role) => userId !== null && roles.includes(role),
      signOut,
    }),
    [userId, roles, signOut],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() must be called within <AuthProvider>");
  }
  return ctx;
}
