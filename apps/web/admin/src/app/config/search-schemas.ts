import * as z from "zod";

/**
 * Search params of the cursor-paged lists (tasks, audit): `?q=<search>&cursors=<t1>,<t2>`.
 * The same keys as `cursorParsers` in shared/lib/url (nuqs reads and writes them
 * in the component); this schema is the router's typed, validated view of them.
 * Anything malformed falls back to "absent" instead of crashing the route.
 */
export const cursorSearchSchema = z.object({
  q: z.coerce.string().max(256).optional().catch(undefined),
  cursors: z.coerce.string().max(4096).optional().catch(undefined),
});
