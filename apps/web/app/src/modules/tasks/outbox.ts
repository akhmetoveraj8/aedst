/**
 * Client-safe entry for the offline outbox: the handlers the module delivers
 * with (types listed in `manifest.outbox`). Separate from `public.ts`, which
 * also exports server-only prefetching sections that must never reach the
 * browser bundle; loaded lazily by `src/app/config/modules/outbox-handlers.ts`.
 */

export { tasksOutboxHandlers } from "@/modules/tasks/lib/outbox-handlers";
