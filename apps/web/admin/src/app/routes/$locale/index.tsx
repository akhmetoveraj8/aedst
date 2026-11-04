import { createFileRoute, redirect } from "@tanstack/react-router";

/** The admin panel has no landing page: `/{locale}` is the overview. */
export const Route = createFileRoute("/$locale/")({
  beforeLoad: ({ context }) => {
    throw redirect({ href: `/${context.locale}/admin`, replace: true });
  },
});
