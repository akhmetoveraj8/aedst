// Keep this in sync with `i18nModules` in modules.ts: one type-only import
// per module gives `useTranslations`/`t()` full namespace + key autocompletion.

import type admin from "@/shared/i18n/catalogs/admin/en.json";
import type common from "@/shared/i18n/catalogs/admin-common/en.json";

type Messages = {
  common: typeof common;
  admin: typeof admin;
};

declare module "use-intl" {
  interface AppConfig {
    Messages: Messages;
  }
}
