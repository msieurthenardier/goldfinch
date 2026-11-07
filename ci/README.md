# Goldfinch CI on local Concourse

CI runs on the **local Concourse** instance (`http://localhost:8080`, team `goldfinch`)
instead of GitHub Actions, to conserve GitHub Actions minutes. GitHub Actions
`ci.yml` is disabled (manual `workflow_dispatch` only); `build.yml` (the real
release path, incl. macOS) is **untouched** and still owns releases.

## What runs where

| Check | Task file | GitHub Actions equivalent |
|---|---|---|
| Unit tests | `tasks/test.yml` | "Unit tests" |
| Type check | `tasks/typecheck.yml` | "Type check" |
| Lint (ESLint + Prettier check) | `tasks/lint.yml` | "Lint" + "Format check" |
| Dependency audit | `tasks/audit.yml` | "Dependency audit" |
| Package smoke (`--dir`) | `tasks/package-linux.yml` | "Package (no installers)" |
| Linux installers (AppImage+deb) | `tasks/build-linux.yml` | (fallback only — `build.yml` owns releases) |
| Windows installer (nsis) | `tasks/build-windows.yml` | (fallback only) |

## Daily use

### 1. Pre-push gate against your local working tree (no credentials, no clone)

Runs the exact CI task on the Concourse worker against your **current files**
(committed or not):

```bash
fly -t local-goldfinch execute -c ci/tasks/test.yml       -i repo=.
fly -t local-goldfinch execute -c ci/tasks/typecheck.yml  -i repo=.
fly -t local-goldfinch execute -c ci/tasks/lint.yml       -i repo=.
fly -t local-goldfinch execute -c ci/tasks/audit.yml      -i repo=.
fly -t local-goldfinch execute -c ci/tasks/package-linux.yml -i repo=.
```

`-i repo=.` uploads the repo (git-tracked files; `node_modules`/`dist` are
gitignored and skipped — the task runs `npm ci` fresh).

### 2. Automatic CI on every push to `main`

The `ci` job in `pipeline.yml` has a `git` resource on `main` (`trigger: true`)
and runs the full suite in parallel. Watch it at
`http://localhost:8080/teams/goldfinch/pipelines/goldfinch`.

### 3. Fallback installers (on demand)

The `build-linux` / `build-windows` jobs are **manual** (`passed: [ci]`, no
auto-trigger) so they don't tie up workers on every push. Build when you want a
local installer (e.g. GH Actions minutes are exhausted):

```bash
fly -t local-goldfinch trigger-job -j goldfinch/build-linux   -w
fly -t local-goldfinch trigger-job -j goldfinch/build-windows -w
```

They push a per-build archive to MinIO (bucket `goldfinch-installers`). Grab it:

```bash
# via the MinIO console at http://localhost:9001 (minioadmin / minioadmin), or:
docker exec concourse-local-minio-1 \
  mc ls --recursive local/goldfinch-installers
```

Or build ad-hoc straight to a local dir (no MinIO, no pipeline):

```bash
fly -t local-goldfinch execute -c ci/tasks/build-linux.yml   -i repo=. -o installers=./out
fly -t local-goldfinch execute -c ci/tasks/build-windows.yml -i repo=. -o installers=./out
```

> `build-windows` runs on the Concourse `windows` worker (Node 22 + git +
> python preinstalled). `--publish never` keeps both build tasks off GitHub
> Releases.

## Setup / maintenance

### Set or update the pipeline

```bash
./ci/set-pipeline.sh
fly -t local-goldfinch unpause-pipeline -p goldfinch
```

### Secrets (Vault)

Concourse resolves `((var.field))` from Vault at `concourse/goldfinch/goldfinch/<var>`.

| Vault path | Fields | Used by |
|---|---|---|
| `concourse/goldfinch/goldfinch/git-key` | `private_key` (read-only, repo-scoped SSH deploy key) | `repo` git resource (SSH clone of the private repo) |
| `concourse/goldfinch/goldfinch/minio` | `endpoint`, `access_key`, `secret_key`, `bucket` | `linux-installers` / `windows-installers` s3 resources |

> MinIO `endpoint` is `http://172.19.0.20:9000`, **not** `minio:9000`. Build
> containers reach MinIO at its static compose-network IP `172.19.0.20` because
> worker DNS is `8.8.8.8` (the compose service name does not resolve), and
> MinIO's published ports are loopback-only. The scheme is required — the
> Concourse s3 resource parses `endpoint` as a full URL and rejects a bare
> `host:port`.

Vault is persistent (raft storage on a Docker volume) and unseals itself on
start, so secrets survive container restarts and live **only in Vault** — there
is no re-seed file. Each secret is written once, with the `concourse-admin`
policy token (see step 3 below).

### Provision the SSH deploy key (one-time)

The `repo` git resource authenticates with a **read-only, repo-scoped SSH deploy
key** — the most-scoped credential available (it can clone this one repo and
nothing else; no account-wide PAT).

1. Generate a dedicated key (no passphrase):

   ```bash
   ssh-keygen -t ed25519 -N "" -C "concourse-goldfinch-ci" -f goldfinch-deploy
   ```

2. GitHub → the `goldfinch` repo → **Settings → Deploy keys → Add deploy key**.
   Paste the contents of `goldfinch-deploy.pub`. **Leave "Allow write access"
   UNCHECKED** (read-only is all the pipeline needs).

3. Write the **private** key into Vault with the host `vault` CLI (run locally
   so the key never leaves your machine):

   ```bash
   ( export VAULT_ADDR=http://127.0.0.1:8200
     export VAULT_TOKEN="$(grep '^VAULT_TOKEN=' ~/projects/concourse-local/.env | cut -d= -f2-)"
     vault kv put concourse/goldfinch/goldfinch/git-key private_key=@goldfinch-deploy )
   ```

   The subshell keeps the token out of your shell history, never echoes it, never
   puts it on a command line, and discards it when the subshell exits. It is the
   `concourse-admin` policy token, scoped to `concourse/*` — not root.
   `private_key=@file` stores the whole file, newlines included.

   Use the host CLI only for the deploy key — never concourse-local's MCP
   `set_secret`, which would put the PEM into an agent's context. (`set_secret`
   is fine for the MinIO fields.)

4. Delete the local private key (`rm goldfinch-deploy`) — it now lives only in
   Vault.

If Vault's data is ever lost, generate a new deploy key and re-run steps 1-4
(replace the old key in GitHub's Deploy keys).
