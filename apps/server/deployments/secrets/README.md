# Encrypted secrets

Secrets that must live in the repo (not in `.env`, which stays
local-only and untracked — see `.env.example`) are encrypted with
[SOPS](https://github.com/getsops/sops) using
[age](https://github.com/FiloSottile/age), configured in `.sops.yaml`.

## First-time setup

1. Generate a keypair (once, on your own machine):

   ```bash
   age-keygen -o key.txt
   ```

   This prints an `age1...` public key and writes the private key to
   `key.txt`. **Never commit `key.txt`** — keep it outside the repo, or in a
   password manager.

2. Open a PR adding your `age1...` public key to the `age:` list in
   `.sops.yaml` (comma-separated with existing keys). Once merged, anyone
   holding a previous private key re-encrypts for the new recipient list:

   ```bash
   sops updatekeys deployments/secrets/*.enc.yaml
   ```

3. Set `SOPS_AGE_KEY_FILE=/path/to/key.txt` (or `SOPS_AGE_KEY` with the raw
   key) in your shell so `sops` can decrypt without prompting.

## Day to day

```bash
task secrets:edit ENV=staging   # opens deployments/secrets/secrets.staging.enc.yaml decrypted in $EDITOR, re-encrypts on save
task secrets:view ENV=staging   # prints the decrypted content
```

Never run `sops` by hand against a file outside `deployments/secrets/` —
`.sops.yaml`'s `path_regex` only encrypts files matching
`secrets.*.enc.yaml` here; anything else silently stays plaintext.

## Files

| File | Purpose |
|---|---|
| `secrets.example.yaml` | Template with every key the chart can read; copy to `secrets.<env>.enc.yaml`, fill in, `sops --encrypt --in-place` |
| `secrets.<env>.enc.yaml` | The Kubernetes `Secret` for one environment; `data`/`stringData` encrypted, metadata readable |
| `../k8s/secrets/overlays/<env>` | Kustomize overlay with the ksops generator that decrypts it in the cluster |

`.sops.yaml` ships a **placeholder** recipient; `task secrets:edit` refuses to run
until you replace it (step 2 above). `key.txt` and `*.agekey` are git-ignored.

## Delivering to the cluster (ksops)

The bridge from a SOPS file to the Secret the chart reads (`existingSecret`) is
[ksops](https://github.com/viaduct-ai/kustomize-sops), a Kustomize generator run by
the Argo CD repo-server. Choosing ksops over External Secrets Operator keeps the
existing SOPS+age workflow and needs no external secret store; switch to ESO if
you later adopt one (render an `ExternalSecret` with the same name and keys instead).

One-time setup (UNVERIFIED: not applied to a cluster):

1. Install ksops and kustomize in the repo-server (a sidecar or custom image, per the
   ksops README) and mount the age private key as the Secret `sops-age` with
   `SOPS_AGE_KEY_FILE` pointing at it. Add the key's public half as a recipient in
   `.sops.yaml`, then `sops updatekeys deployments/secrets/secrets.*.enc.yaml`.
2. In `argocd-cm`: `kustomize.buildOptions: --enable-alpha-plugins --enable-exec --load-restrictor LoadRestrictionsNone`
   (the generator reads `deployments/secrets/`, outside its overlay directory).
3. Apply `deployments/k8s/argocd/applications.yaml`. It declares
   `aedst-secrets-<env>` Applications; sync them **before** the first
   `aedst-server-<env>` sync, because the chart's migration hook needs the Secret.
   (They are separate Applications, so Argo CD does not order them: later changes
   to a secret roll out on the next pod restart, not automatically.)

Local check of a rendered overlay: `kustomize build --enable-alpha-plugins --enable-exec --load-restrictor LoadRestrictionsNone deployments/k8s/secrets/overlays/staging` (needs ksops and your age key).
