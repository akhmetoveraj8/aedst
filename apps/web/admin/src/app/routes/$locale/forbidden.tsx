import { createFileRoute } from "@tanstack/react-router";

import { ForbiddenPage } from "@/app/shell/ForbiddenPage";

export const Route = createFileRoute("/$locale/forbidden")({
  component: ForbiddenPage,
});
