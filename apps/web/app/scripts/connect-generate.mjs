#!/usr/bin/env node
import { spawnSync } from "node:child_process";
// Generates the Connect-ES TypeScript client stubs used by
// `src/shared/api/connect/client.ts` straight from apps/server's proto
// sources (apps/server/api/proto is the single source of truth — nothing is
// duplicated in apps/web). See buf.gen.yaml for plugin config.
//
// protoc-gen-es alone is enough: Connect-ES v2's unified codegen has
// protoc-gen-es emit each service's `GenService` descriptor (via
// @bufbuild/protobuf/codegenv2) right alongside its message types, so
// `@connectrpc/connect`'s `createClient()` consumes it directly — there is
// no separate protoc-gen-connect-es plugin/output for this codegen style.
//
// Two `buf generate` invocations are required:
//   1. Every RPC-bearing proto from apps/server (auth, tasks, notifications,
//      search, media, admin — discovered, so a new module needs no edit here).
//      `events.proto` files are deliberately excluded — those describe
//      integration events carried by the server outbox, not RPCs, and have
//      no business in a browser client.
//   2. `buf/validate/validate.proto`, the protovalidate dependency that (1)'s
//      generated code imports for field-constraint descriptors. protoc-gen-es
//      only emits code for files it's explicitly told to generate, so this
//      dependency needs its own pass into the same output directory.
import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const serverProtoDir = join(rootDir, "..", "..", "server", "api", "proto");
const generatedDir = join(
  rootDir,
  "..",
  "shared",
  "api",
  "connect",
  "generated",
);
const binDir = join(rootDir, "node_modules", ".bin");

const env = {
  ...process.env,
  PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
};

function buf(args) {
  const bufBin = join(binDir, process.platform === "win32" ? "buf.CMD" : "buf");
  // shell: true is required on Windows to execute the pnpm-generated .CMD
  // shim; args are passed as an array (not a single interpolated string) so
  // they are still safely quoted rather than naively concatenated.
  const result = spawnSync(bufBin, args, {
    cwd: rootDir,
    env,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

rmSync(generatedDir, { recursive: true, force: true });

const rpcProtos = readdirSync(join(serverProtoDir, "aedst"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const versionDir = join(serverProtoDir, "aedst", entry.name, "v1");
    return readdirSync(versionDir)
      .filter((file) => file.endsWith(".proto") && file !== "events.proto")
      .map((file) => join(versionDir, file));
  })
  .sort();

buf([
  "generate",
  serverProtoDir,
  ...rpcProtos.flatMap((file) => ["--path", file]),
]);

buf([
  "generate",
  "buf.build/bufbuild/protovalidate",
  "--path",
  "buf/validate/validate.proto",
]);

console.log("Connect-ES stubs generated into src/shared/api/connect/generated");
