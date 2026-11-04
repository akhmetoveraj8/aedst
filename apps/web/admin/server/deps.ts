import { readFile } from "node:fs/promises";
import path from "node:path";

import { getOidcConfig } from "@/shared/lib/auth/oidc/config";
import {
  buildEndSessionUrl,
  completeLogin,
  revokeRefreshToken,
  startLogin,
} from "@/shared/lib/auth/oidc/login-flow";
import { refreshSession } from "@/shared/lib/auth/refresh-session";
import type { ServerEnv } from "./env";
import type { Logger } from "./logger";
import type { AppDeps } from "./types";

/** Production wiring: the real shared auth kit, global fetch, files on disk. */
export function productionDeps({
  env,
  logger,
  projectDir,
}: {
  env: ServerEnv;
  logger: Logger;
  /** apps/web/admin (or /app in the image): the parent of dist/. */
  projectDir: string;
}): AppDeps {
  const staticDir = env.ADMIN_STATIC_DIR ?? path.join(projectDir, "dist");
  return {
    env,
    fetch: globalThis.fetch,
    logger,
    auth: {
      getOidcConfig: () => getOidcConfig(),
      startLogin,
      completeLogin,
      refreshSession,
      revokeRefreshToken,
      buildEndSessionUrl,
    },
    staticDir,
    readIndexHtml: () => readFile(path.join(staticDir, "index.html"), "utf8"),
  };
}
