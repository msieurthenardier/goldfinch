# Squawk 0176: `ci/README.md` still describes the dev-mode Vault (seed file, `root` token)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-07
**Completed**: 2026-11-07

## Report
concourse-local sortie 02 moved Vault from an in-memory dev server to persistent raft storage
that unseals itself on start. There is no `.vault-seeds.json` re-seed manifest and no `root`
token any more (handoff:
`~/projects/concourse-local/sorties/02-vault-production-mode/handoff-goldfinch.md`).
Goldfinch's CI docs still describe the old setup, and their deploy-key provisioning recipe
(`docker exec … VAULT_TOKEN=root vault kv put …`) no longer works.

## Evidence
- `ci/README.md` "Secrets (Vault)": "**The Vault dev server is in-memory** — secrets are lost on
  container restart. They are reseeded from `~/projects/concourse-local/.vault-seeds.json`…",
  plus the "Seed-file format" note after it.
- `ci/README.md` "Provision the SSH deploy key" step 3: `docker cp` + `docker exec … VAULT_TOKEN=root
  vault kv put …` and a Node script editing `.vault-seeds.json`. Step 4: "lives only in Vault +
  the seed file".
- `ci/pipeline.yml` `repo` resource comment: "The seed entrypoint was made multiline-safe so this
  PEM round-trips the Vault seed file."
- Verified in concourse-local: `vault/policies/concourse-admin.hcl` grants CRUD+list on
  `concourse/*`; `.env` carries `VAULT_TOKEN` (the concourse-admin token); `concourse/` is KV v1;
  the host `vault` CLI is installed.

## Scope
1. Replace the in-memory/reseed paragraph with: Vault is persistent (raft on a Docker volume),
   self-unsealing, secrets live only in Vault.
2. Delete the seed-file format note.
3. Replace step 3 with a host-CLI recipe in a subshell (token never echoed, never on a command
   line, gone when the subshell exits; homedir-relative path):
   ```bash
   ( export VAULT_ADDR=http://127.0.0.1:8200
     export VAULT_TOKEN="$(grep '^VAULT_TOKEN=' ~/projects/concourse-local/.env | cut -d= -f2-)"
     vault kv put concourse/goldfinch/goldfinch/git-key private_key=@goldfinch-deploy )
   ```
   State that this is the `concourse-admin` policy token, scoped to `concourse/*` — not root.
   `private_key=@file` stores the whole file, newlines included.
4. State that the deploy key goes through the host CLI only, never concourse-local's MCP
   `set_secret`, because that would put the PEM in an agent's context. `set_secret` is fine for
   the MinIO fields.
5. Step 4: the key now lives "only in Vault".
6. Add a recovery line: if Vault's data is lost, generate a new deploy key and re-run steps 1–4.
7. Update the `ci/pipeline.yml` comment so it no longer mentions the seed file. Keep the pointer to
   `ci/README.md`.

Doc-only; no source changes.

## Corrective Action
`ci/README.md`: replaced the in-memory/reseed paragraph with a persistent-raft, self-unsealing,
Vault-only description; deleted the seed-file format note; rewrote "Provision the SSH deploy key"
step 3 as a host-`vault`-CLI subshell recipe (concourse-admin token scoped to `concourse/*`, not
root; `@file` stores newlines; deploy key via host CLI only, never MCP `set_secret`); step 4 now
says "only in Vault"; added a Vault-data-loss recovery line. Also dropped a stray trailing code
fence at the end of the old step 4. `ci/pipeline.yml`: `repo` resource comment no longer mentions
the seed file and keeps the pointer to `ci/README.md`. Doc-only.

## Verification
- `grep -n -i "seed\|VAULT_TOKEN=root\|docker exec.*vault\|docker cp" ci/README.md ci/pipeline.yml`:
  one hit, README line 101 ("there is no re-seed file"), intentional.
- `npx prettier --check ci/README.md ci/pipeline.yml squawks/0176-ci-readme-vault-production-mode.md`:
  all files pass.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed — no blocking or non-blocking issues. All 7 scope items covered; diff confined to `ci/README.md`, `ci/pipeline.yml` and this artifact. Remaining grep hits judged benign (`ci/README.md` "no re-seed file" line; the unrelated MinIO `docker exec` recipe). Recipe checked against `concourse-admin.hcl` (CRUD+list on `concourse/*`) and the KV v1 mount. Prettier check passes; `ci/pipeline.yml` still parses as YAML.
**Commit**: the `squawk/0176: ci/README.md matches the production-mode Vault` commit on `squawk/0176-ci-readme-vault-production-mode`
