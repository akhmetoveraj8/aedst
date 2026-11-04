import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { TaskAttachments } from "@/modules/media/public";
import {
  TaskDetailsFallback,
  TaskDetailsSection,
} from "@/modules/tasks/public";
import { requireLocale } from "@/shared/i18n/require-locale";
import { ErrorBoundary } from "@/shared/lib/errors/ErrorBoundary";

// A title per page (WCAG 2.4.2); the task's own title is not fetched here, the
// page heading carries it.
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/tasks/[id]">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "tasks.details" });
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

/**
 * Task detail + its attachments. The two come from different feature
 * modules (tasks, media) and are composed here: modules never import each
 * other, and a failure in the attachments widget is contained by its own
 * error boundary instead of replacing the task.
 */
export default async function TaskDetailsPage({
  params,
}: PageProps<"/[locale]/tasks/[id]">) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<TaskDetailsFallback />}>
        <TaskDetailsSection taskId={id} />
      </Suspense>
      <ErrorBoundary feature="media">
        <TaskAttachments taskId={id} />
      </ErrorBoundary>
    </div>
  );
}
