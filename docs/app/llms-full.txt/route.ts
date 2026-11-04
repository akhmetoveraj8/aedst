import { llmsFullTxt } from "../../lib/content";
import { allPages } from "../../lib/pages";
import { SITE_NAME, docsUrl } from "../../lib/site";

export const dynamic = "force-static";

export function GET() {
  const body = llmsFullTxt(allPages(), docsUrl(), SITE_NAME);
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
