"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";
import { navEntriesFor } from "@/app/config/modules/registry";
import { Link, usePathname } from "@/shared/i18n/navigation";
import { useAuth } from "@/shared/lib/auth/AuthProvider";
import { useCapabilities } from "@/shared/lib/capabilities/CapabilitiesProvider";

/**
 * Primary navigation, built from the module manifests (`nav`) via the
 * registry. An entry with `requiredRole` (admin) renders only for tokens
 * carrying that role — a UI hint; the pages and every RPC are guarded again
 * by proxy.ts and apps/server.
 */
export function AppNav() {
  const t = useTranslations("common.nav");
  const pathname = usePathname();
  const { hasRole } = useAuth();
  const items = navEntriesFor(hasRole, useCapabilities());

  return (
    <nav aria-label={t("label")}>
      <ul className="flex flex-wrap items-center gap-1">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium text-sm transition-colors hover:bg-muted",
                  active ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
