import type { GeneratedPageProps } from "fumadocs-openapi";
import { LOCAL_SERVER, openapi } from "@/lib/openapi";
import { OpenAPIPageClient } from "./openapi-page-client";

// `<OpenAPIPage document="aedst.tasks.v1" ... />` as the generated pages use it (see
// docs/scripts/openapi-pages.mjs). Loads the document on the server at build time and hands it
// to the client renderer. The generated YAML declares no `servers`, so the playground would
// default to this site's own origin: the local server is set instead.
export async function OpenAPIPage({ document, ...rest }: GeneratedPageProps) {
  const { bundled } = await openapi.getSchema(document);
  const withServer = bundled.servers?.length ? bundled : { ...bundled, servers: [LOCAL_SERVER] };
  return <OpenAPIPageClient {...rest} document={document} payload={{ bundled: withServer }} />;
}
