"use client";

import { useLocale } from "next-intl";
import { type Locale, localeNames, locales } from "@/shared/i18n/locales";
import { usePathname, useRouter } from "@/shared/i18n/navigation";
import { LocaleSelect } from "@/shared/ui/locale-select";

const options = locales.map((value) => ({
  value,
  label: localeNames[value],
}));

/** Wires the shared presentational picker to next-intl; `label` comes from the server. */
export function LocaleSwitcher({ label }: { label: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <LocaleSelect
      value={locale}
      options={options}
      label={label}
      onValueChange={(next) =>
        router.replace(pathname, { locale: next as Locale })
      }
    />
  );
}
