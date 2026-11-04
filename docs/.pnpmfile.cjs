// TypeScript 7 is the native (Go) compiler and ships no JavaScript compiler
// API (`ts.sys` is undefined). Nextra creates its twoslash transformer at
// import time, so with the docs' own `typescript@7` every page fails with
// "Cannot read properties of undefined (reading 'readFile')".
//
// The docs type-check with TypeScript 7 (devDependency `typescript`); the
// twoslash toolchain gets a private copy of the last JS-API release instead.
// Its `typescript` *peer* would otherwise resolve to the root TypeScript 7 and
// pnpm can neither override nor extend a peer, so it is rewritten into a
// regular dependency here. Remove once twoslash supports TypeScript 7.
const TWOSLASH_TYPESCRIPT = "6.0.3";
const TWOSLASH_PACKAGES = new Set(["twoslash", "@shikijs/twoslash", "@typescript/vfs"]);

function readPackage(pkg) {
  if (TWOSLASH_PACKAGES.has(pkg.name)) {
    if (pkg.peerDependencies) delete pkg.peerDependencies.typescript;
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: TWOSLASH_TYPESCRIPT };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
