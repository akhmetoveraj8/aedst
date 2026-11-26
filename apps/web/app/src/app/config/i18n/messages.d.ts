// Keep this in sync with `i18nModules` in modules.ts: one type-only import
// per module gives `useTranslations`/`t()` full namespace + key autocompletion.

import type auth from "@i18n/auth/en.json";
import type common from "@i18n/common/en.json";
import type media from "@i18n/media/en.json";
import type notifications from "@i18n/notifications/en.json";
import type search from "@i18n/search/en.json";
import type tasks from "@i18n/tasks/en.json";

type Messages = {
  common: typeof common;
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
