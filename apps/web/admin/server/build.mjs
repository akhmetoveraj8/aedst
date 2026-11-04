// Bundles server/main.ts into dist-server/main.mjs. Run from apps/web/admin:
// `node server/build.mjs`.
import { build } from "esbuild";

import { bundleOptions } from "./bundle-options.mjs";

await build(bundleOptions);
