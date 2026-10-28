import { RouteMessages } from "@/app/providers/RouteMessages";
import { requireLocale } from "@/shared/i18n/require-locale";

export default async function TasksLayout({
  children,
  params,
}: LayoutProps<"/[locale]/tasks">) {
  const locale = requireLocale((await params).locale);
  return (
    // `media` has no route of its own; the task detail page shows attachments.
    <RouteMessages locale={locale} routes={["/tasks"]} namespaces={["media"]}>
      <div className="flex flex-col gap-6">{children}</div>
    </RouteMessages>
  );
}
