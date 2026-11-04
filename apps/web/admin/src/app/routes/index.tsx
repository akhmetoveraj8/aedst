import { createFileRoute } from "@tanstack/react-router";

// `/` is redirected to a locale by the root route's beforeLoad; this route only
// exists so the router has a match for it.
export const Route = createFileRoute("/")({});
