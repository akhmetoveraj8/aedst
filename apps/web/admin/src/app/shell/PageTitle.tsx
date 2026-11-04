import { useTranslations } from "use-intl";

/** Sets the document title (`<title>` is hoisted to <head> by React 19): "Page · AEDST Admin". */
export function PageTitle({ title }: { title: string }) {
  const t = useTranslations("common");
  return <title>{`${title} · ${t("appName")}`}</title>;
}
