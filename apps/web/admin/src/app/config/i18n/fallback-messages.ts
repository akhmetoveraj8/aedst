import { defaultLocale, type Locale, locales } from "@/shared/i18n/locales";

/**
 * Strings for the two pages that render *outside* the locale layout and so
 * cannot use next-intl: the root 404 and `global-error.tsx`. Kept as a plain
 * object (no provider, no async loading) because they run when everything
 * above them may be broken.
 */
export type FallbackMessages = {
  errorLabel: string;
  errorTitle: string;
  errorDescription: string;
  notFoundTitle: string;
  notFoundDescription: string;
  goHome: string;
};

export const fallbackMessages: Record<Locale, FallbackMessages> = {
  en: {
    errorLabel: "Error",
    errorTitle: "Something went wrong",
    errorDescription: "We've been notified and are looking into it.",
    notFoundTitle: "Page not found",
    notFoundDescription:
      "The page you're looking for doesn't exist or has been moved.",
    goHome: "Go home",
  },
  ru: {
    errorLabel: "Ошибка",
    errorTitle: "Что-то пошло не так",
    errorDescription: "Мы уже получили уведомление и разбираемся.",
    notFoundTitle: "Страница не найдена",
    notFoundDescription: "Такой страницы нет или она была перемещена.",
    goHome: "На главную",
  },
  tj: {
    errorLabel: "Хато",
    errorTitle: "Чизе нодуруст рафт",
    errorDescription: "Ба мо хабар расид ва мо дар ин бора кор карда истодаем.",
    notFoundTitle: "Саҳифа ёфт нашуд",
    notFoundDescription: "Чунин саҳифа вуҷуд надорад ё интиқол дода шудааст.",
    goHome: "Ба саҳифаи асосӣ",
  },
  uz: {
    errorLabel: "Xato",
    errorTitle: "Nimadir noto'g'ri ketdi",
    errorDescription: "Bizga xabar berildi va muammo ustida ishlayapmiz.",
    notFoundTitle: "Sahifa topilmadi",
    notFoundDescription: "Bunday sahifa mavjud emas yoki ko'chirilgan.",
    goHome: "Bosh sahifaga",
  },
  ar: {
    errorLabel: "خطأ",
    errorTitle: "حدث خطأ ما",
    errorDescription: "تم إبلاغنا ونعمل على حل المشكلة.",
    notFoundTitle: "الصفحة غير موجودة",
    notFoundDescription: "الصفحة التي تبحث عنها غير موجودة أو تم نقلها.",
    goHome: "العودة إلى الرئيسية",
  },
};

function isLocale(value: string | undefined): value is Locale {
  return locales.includes(value as Locale);
}

/**
 * Picks the visitor's locale without any provider: a `/<locale>/…` path wins
 * (that is what they were browsing), otherwise the first supported language
 * in an `Accept-Language`-style list, otherwise the default.
 */
export function pickFallbackLocale({
  pathname,
  languages,
}: {
  pathname?: string;
  languages?: readonly string[] | string | null;
}): Locale {
  const fromPath = pathname?.split("/")[1];
  if (isLocale(fromPath)) {
    return fromPath;
  }
  const list =
    typeof languages === "string"
      ? languages.split(",").map((part) => part.split(";")[0] ?? "")
      : (languages ?? []);
  for (const language of list) {
    const base = language.trim().toLowerCase().split("-")[0];
    if (isLocale(base)) {
      return base;
    }
  }
  return defaultLocale;
}
