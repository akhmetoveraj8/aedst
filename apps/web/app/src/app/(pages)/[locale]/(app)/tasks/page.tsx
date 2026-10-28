import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  DashboardStatsFallback,
  DashboardStatsSection,
  loadTaskSearchParams,
  TaskListFallback,
  TaskListSection,
} from "@/modules/tasks/public";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/tasks">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "tasks.dashboard" });

  return {
    // Composes with the root locale layout's `title.template` — unlike the
    // home page, this is a genuinely nested segment (`[locale]/tasks`, not
    // `[locale]` itself), so the "same segment" exception doesn't apply
    // here (see (pages)/[locale]/page.tsx's generateMetadata comment).
    title: t("title"),
    // Signed-in page: noindex (set by the (app) layout), so no canonical or
    // hreflang alternates are published.
  };
}

export default async function TasksPage({
  params,
  searchParams,
}: PageProps<"/[locale]/tasks">) {
  const locale = requireLocale((await params).locale);
  const [t, taskParams] = await Promise.all([
    getTranslations({ locale, namespace: "tasks.dashboard" }),
    loadTaskSearchParams(searchParams),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-semibold text-2xl">{t("title")}</h1>
      {/* Independent boundaries: each section streams as soon as its own
          server prefetch resolves, without waiting for the other. */}
      <Suspense fallback={<DashboardStatsFallback />}>
        <DashboardStatsSection />
      </Suspense>
      <Suspense fallback={<TaskListFallback />}>
        <TaskListSection params={taskParams} />
      </Suspense>
    </div>
  );
}
