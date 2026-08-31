# Squawk 0054: DEV_MINT relaunch rotates automation keys — recipe doesn't warn, configs go stale

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-30
**Completed**: 2026-08-30

## Report

Every launch with `GOLDFINCH_AUTOMATION_DEV_MINT=1` mints fresh keys that **replace**
the stored hashes — `mintJarKey` keeps one hash per jar and `mintAdminKey` keeps a
single admin hash — so a habitual DEV_MINT relaunch silently invalidates whatever
bearer token an MCP client config (`.mcp.json`) holds, surfacing later as a bare
`401`/`AUTH_HEADER_REJECTED` at the consumer. This bit the mission-control
behavior-test apparatus on 2026-08-30: three client configs held three different
stale tokens. The durable recipe — mint once, then relaunch with plain
`npm run dev:automation` (minted key hashes persist in the dev profile) — is implied
by the launch matrix in `docs/dev-testing.md` but contradicted in effect by
`docs/mcp-automation.md`, whose "Recipe — attach a script to a dev key" shows the
DEV_MINT launch as the standing Terminal-1 step. Fix: add an explicit
rotation warning to the recipe (mint replaces per-jar/admin hashes; re-mint ⇒
update configs) and state the mint-once / relaunch-without-DEV_MINT pattern as the
recommended steady state. Docs only.

## Evidence

- `src/main/automation/mcp-server.js:1204-1206` — `mintJarKey`:
  `hashes[jarId] = hashKey(key)` — one hash per jar, mint overwrites.
- `src/main/automation/mcp-server.js:1220-1224` — `mintAdminKey`:
  `settings.set('automationAdminKeyHash', hashKey(key))` — single slot, mint overwrites.
- `docs/mcp-automation.md` — "Recipe — attach a script to a dev key": Terminal 1 is
  `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`
  with no rotation caveat.
- `docs/dev-testing.md:13` — launch matrix row for plain `npm run dev:automation`:
  "none minted — every request is rejected unless a previously minted dev key is
  supplied" (the persistence fact, stated without the rotation consequence).
- Observed 2026-08-30: dev MCP endpoint answered 401 to all previously configured
  tokens; a fresh DEV_MINT launch restored access with new keys.

## Corrective Action

Re-read `src/main/automation/mcp-server.js:1191-1225` (`mintJarKey`, `mintAdminKey`)
to confirm the exact overwrite mechanics before writing any claim: `mintJarKey`
copies the existing `automationKeyHashes` map, sets `hashes[jarId] = hashKey(key)`,
and writes the whole map back — one hash per `jarId`, so a re-mint for the same jar
clobbers the prior hash. `mintAdminKey` writes `automationAdminKeyHash` as a single
scalar setting — no map, no history — so a re-mint clobbers the prior admin hash
the same way. Both match the squawk's Evidence lines exactly; no other mint path
exists.

`docs/mcp-automation.md` (under "Dogfooding / dev key acquisition (the
`AUTOMATION_DEV_MINT` mechanism)"):
- Added a blockquote rotation warning immediately after the existing "Minting
  writes only the key *hash*..." sentence, before the "Recipe — attach a script to
  a dev key" recipe: states the single-hash-per-identity mechanics (naming
  `mintJarKey`/`mintAdminKey`'s overwrite behavior), that every `DEV_MINT` launch
  invalidates the previously minted key, and that a stale `.mcp.json` entry or env
  var starts getting a bare 401.
- Added a "Recommended steady state" paragraph after the recipe's closing
  paragraph (before the `## Endpoint` heading): mint once with `DEV_MINT`, store
  the key in the client config, then relaunch routine dev work with plain
  `npm run dev:automation` (`GOLDFINCH_AUTOMATION_ADMIN=1` added at launch when
  admin-tier ops are needed) — minted hashes persist in the dev profile across
  relaunches, so the stored token keeps working. Reserves `DEV_MINT` relaunches
  for when a new key is actually wanted.

`docs/dev-testing.md` (launch-matrix section):
- Extended the DEV_MINT row's Keys cell to state the rotation consequence
  ("**replaces** the prior jar/admin hash, so any config or env var still holding
  an older key starts 401ing") alongside the existing "printed once" fact.
- Extended the paragraph immediately below the table (previously "there is no
  downside to minting") to scope that claim to a *first* mint, name the
  rotation-not-addition mechanics with a pointer to `mcp-automation.md`'s new
  warning, and recommend relaunching without `DEV_MINT` (the row above) when a
  working key is already stored in a client config.

No source, test, or config files touched — both edits are additive prose in the
existing sections/table cell; no heading renames, no restructuring.

## Verification

- Every behavioral claim (per-jar single-hash overwrite, single-scalar admin-hash
  overwrite, hash persistence across a plain relaunch, DEV_MINT gating) checked
  against `src/main/automation/mcp-server.js:1191-1225` directly before writing —
  no claim added beyond what the source and the squawk's own Evidence support.
- `npx prettier --check docs/mcp-automation.md docs/dev-testing.md` →
  "All matched files use Prettier code style!" — no formatting drift introduced.
- `git diff docs/mcp-automation.md docs/dev-testing.md` reviewed: both changes are
  additive (one new blockquote + one new paragraph in `mcp-automation.md`; one
  table-cell extension + one paragraph extension in `dev-testing.md`); no existing
  sentences removed or restructured, no heading renamed.
- `git status --short` confirms only `docs/mcp-automation.md`, `docs/dev-testing.md`,
  and this squawk file are modified — no source, test, or config files touched.

## Sign-Off
**Reviewer**: independent Reviewer agent (squawk-review, scoped to the diff)
**Verdict**: confirmed — every behavioral claim verified against source
(`mintJarKey`/`mintAdminKey` overwrite mechanics, hash persistence across a plain
relaunch via the settings store, per-request `GOLDFINCH_AUTOMATION_ADMIN` env
check in `resolveIdentity`); additions match both docs' conventions and
contradict nothing; docs-only diff; prettier clean. Non-blocking: flagged the
`CLAUDE.md` canonical-launch line ("Always include both env flags") as
conflicting with the new steady-state guidance → logged as squawk 0055.
**Commit**: `squawk/0054-dev-mint-relaunch-rotates-mcp-keys` (squash-merged via its PR)
