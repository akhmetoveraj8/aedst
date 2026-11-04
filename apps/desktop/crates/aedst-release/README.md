# aedst-release

Release tool for the desktop updater. It uses the app's own `aedst_update::verify_manifest`, so what it signs is
what the app accepts. Output on stdout is `key=value` lines; errors go to stderr with a non-zero exit code
(2 = bad command line, 1 = anything else). A private key is never printed; only `keygen` writes one, to its `--out`
file. No command overwrites an existing file.

## Commands

```
aedst-release keygen   --out <private-key-file>
aedst-release manifest --version <semver> --channel stable|beta --feed-entry <velopack json>
                       --published-at <RFC3339|now> --base-url <https dir url> --notes-url <https url> --out <file>
                       [--expires-in-days N] [--rollback] [--platform windows] [--arch x86_64] [--min-supported <semver>]
aedst-release sign     --manifest <file> --key <private-key-file> --key-id <id> --out <envelope.json>
aedst-release verify   --envelope <file> --keys "<id>:<hex>[,<id>:<hex>]"
```

- `keygen` prints `key-id` (first 16 hex of SHA-256 of the public key) and `public-key`.
- `manifest` reads version, SHA-256, size and file name from the Velopack `releases.<channel>.json` feed
  (the `Full` asset of `--version`); the legacy text `RELEASES` file has only SHA-1 and is refused.
- `sign` signs the exact text of the manifest file, verifies the envelope in memory and again from disk.
- `verify` prints channel, version and `publishedAt`, or the typed refusal.

## Release flow

1. Build the app (release profile). *(CI, not here)*
2. `vpk pack` to produce the Velopack package and feed. **NOT automated here.**
3. `aedst-release manifest ...` from the feed entry (no hash typed by hand).
4. `aedst-release sign ...` on the release runner with the key from a CI secret.
5. Upload the package, feed and envelope. **NOT automated here.**

## Private key rules

The key file lives only on the release runner: a CI secret written to a temp file readable only by the runner,
used by one `sign` run, then shredded. Never in the repository, never an artifact, never on a command line.
On Windows `keygen` cannot restrict the file mode (Unix: 0600). See the crate docs in `src/lib.rs`.
