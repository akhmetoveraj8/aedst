// Keep this in sync with `i18nModules` in modules.ts: one type-only import
// per module gives `useTranslations`/`t()` full namespace + key autocompletion.
import type common from "@/app/config/i18n/common/en.json";
import type auth from "@/modules/auth/i18n/en.json";
import type home from "@/modules/home/i18n/en.json";
import type media from "@/modules/media/i18n/en.json";
import type notifications from "@/modules/notifications/i18n/en.json";
import type search from "@/modules/search/i18n/en.json";
import type tasks from "@/modules/tasks/i18n/en.json";

type Messages = {
  common: typeof common;
  home: typeof home;
  auth: typeof auth;
  tasks: typeof tasks;
  search: typeof search;
  notifications: typeof notifications;
  media: typeof media;
};

declare module "next-intl" {
  interface AppConfig {
    Messages: Messages;
  }
}
