import { createFileRoute } from "@tanstack/react-router";

import { ForbiddenPage } from "@/app/shell/forbidden-page";

export const Route = createFileRoute("/$locale/forbidden")({
  component: ForbiddenPage,
});
