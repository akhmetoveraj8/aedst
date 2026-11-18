import { loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";

// The whole docs/content tree is the documentation (existing URLs are kept: a page at
// content/server/modules.md is served at /server/modules, the home page is content/index.mdx).
const docs = defineDocs({
  dir: "content",
  docs: { schema: pageSchema },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
});
