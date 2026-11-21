// The OpenAPI documents behind the interactive pages (fumadocs-openapi). Every
// public/openapi/*.yaml is an input, keyed by its file name without the extension
// (for example "aedst.tasks.v1"), so a new package needs no registration here.
// Uses only erasable TypeScript syntax: docs/scripts/openapi-pages.mjs imports it with plain node.
import { readdirSync } from "node:fs";
import { createOpenAPI } from "fumadocs-openapi/server";

const OPENAPI_DIR = "public/openapi";

/** Default target of the "send request" playground: the local server, never a real deployment. */
export const LOCAL_SERVER = { url: "http://localhost:8080", description: "Local development server" };

/** Document id -> YAML path, relative to the docs/ directory (the working directory of next and of the script). */
export function openapiInput(): Record<string, string> {
  const files = readdirSync(OPENAPI_DIR)
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  return Object.fromEntries(files.map((name) => [name.slice(0, -".yaml".length), `./${OPENAPI_DIR}/${name}`]));
}

export const openapi = createOpenAPI({ input: openapiInput() });
