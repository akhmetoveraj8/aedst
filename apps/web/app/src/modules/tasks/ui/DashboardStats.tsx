"use client";

import { useQuery } from "@connectrpc/connect-query";
import { useTranslations } from "next-intl";

import { TasksService } from "@/shared/api/connect/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";

/**
 * The dashboard: one `GetTaskStats` call, several derived numbers — see
 * apps/server's tasks.proto GetTaskStats doc comment for why this is a
 * single aggregate query instead of the client computing it from a full
 * task list.
 */
export function DashboardStats() {
  const t = useTranslations("tasks.dashboard");
  const { data, isLoading, isError } = useQuery(
    TasksService.method.getTaskStats,
    {},
  );

  const stats: Array<{
    key: string;
    value: number | undefined;
    emphasize?: boolean;
  }> = [
    { key: "totalTasks", value: data?.total },
    { key: "todo", value: data?.todo },
    { key: "inProgress", value: data?.inProgress },
    { key: "completed", value: data?.done },
    {
      key: "overdue",
      value: data?.overdue,
      emphasize: (data?.overdue ?? 0) > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {stats.map((stat) => (
        <Card key={stat.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-normal">
              {t(stat.key)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <p
                className={`text-2xl font-semibold ${stat.emphasize ? "text-destructive" : ""}`}
              >
                {isError ? "—" : (stat.value ?? 0)}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
