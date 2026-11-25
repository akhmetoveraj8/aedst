import type { Locale } from "@/shared/i18n/locales";

// next-intl 4 `AppConfig` augmentation: `useLocale()` and the server helpers
// are typed with the app's `Locale` union, so no `as Locale` casts are needed.
//
// Shared by the two next-intl projects (app, marketing), which list this file
// in their tsconfig `include`; admin augments `use-intl` in its own copy.
//
// This must be a `.ts` file: the same augmentation in `messages.d.ts` is not
// picked up by the TypeScript 7 compiler used here (verified: `useLocale()`
// stayed `string`). `Messages` in `messages.d.ts` therefore does not take
// effect either; enabling it needs `AppNav`/`DashboardStats` dynamic keys typed.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
  }
}
