"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";

import { ADMIN_SECTIONS } from "@/modules/admin/lib/sections";
import { Link, usePathname } from "@/shared/i18n/navigation";

export function AdminNav({ allowed }: { allowed: readonly string[] }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")}>
      <ul className="flex flex-wrap gap-1 border-b pb-2">
        {ADMIN_SECTIONS.filter((section) => allowed.includes(section.key)).map(
          (section) => {
            const active = pathname === section.href;
            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm hover:bg-muted",
                    active ? "bg-muted font-medium" : "text-muted-foreground",
                  )}
                >
                  {t(section.key)}
                </Link>
              </li>
            );
          },
        )}
      </ul>
    </nav>
  );
}
