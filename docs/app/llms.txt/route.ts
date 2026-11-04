import { llmsTxt } from "../../lib/content";
import { allPages } from "../../lib/pages";
import { SITE_DESCRIPTION, SITE_NAME, docsUrl } from "../../lib/site";

export const dynamic = "force-static";

export function GET() {
  const body = llmsTxt(allPages(), docsUrl(), SITE_NAME, SITE_DESCRIPTION);
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
