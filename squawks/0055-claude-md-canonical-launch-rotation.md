# Squawk 0055: CLAUDE.md canonical dev launch mandates DEV_MINT every launch — conflicts with key-rotation guidance

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-30
**Completed**: 2026-08-30

## Report

`CLAUDE.md`'s Commands section names
`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`
the canonical dev launch and instructs "**Always include both env flags**", with
"agents attach via env-key scripts (`scripts/lib/mcp-client.mjs`), never a static
`.mcp.json` entry." That model (re-mint every launch, re-capture the printed key)
is self-consistent for script harnesses, but since every DEV_MINT launch
**replaces** the stored key hashes (squawk 0054), following it rotates the keys
out from under any MCP client that DOES hold a standing token in a static config
— which is exactly how Claude Code's MCP client attaches (the mission-control
behavior-test apparatus; bitten 2026-08-30, three configs left with stale
tokens). The bullet is the project's most prominent first-read instruction and
now contradicts the rotation warning and mint-once steady state added by squawk
0054. Fix: reword the bullet to distinguish the two consumer models — DEV_MINT +
per-launch env capture for script harnesses vs. mint-once + static client config
+ plain `npm run dev:automation` relaunch for MCP clients — with the rotation
consequence stated. Docs only. Surfaced by the squawk 0054 review (non-blocking
observation).

## Evidence

- `CLAUDE.md:8` — "canonical dev launch … **Always include both env flags** …
  agents attach via env-key scripts (`scripts/lib/mcp-client.mjs`), never a
  static `.mcp.json` entry."
- `src/main/automation/mcp-server.js:1204-1206`, `:1220-1224` — mint overwrites
  the per-jar / admin hash (squawk 0054 evidence).
- Squawk 0054 (PR #197, branch `squawk/0054-dev-mint-relaunch-rotates-mcp-keys`,
  commit `34118c3` — **not yet merged, so not present in this branch's tree**) —
  adds the rotation warning and "Recommended steady state" (mint once, relaunch
  without DEV_MINT) to `docs/mcp-automation.md`, and the rotation consequence to
  `docs/dev-testing.md`'s launch matrix. This squawk reconciles `CLAUDE.md` with
  that guidance; both PRs need to land for the doc set to be self-consistent.
- Observed 2026-08-30: mission-control's `.mcp.json` `goldfinch-development`
  entry (a static-config MCP consumer) 401'd after routine DEV_MINT relaunches.

## Corrective Action

Re-read `src/main/automation/mcp-server.js`'s `mintJarKey` (~1191-1206) and
`mintAdminKey` (~1213-1224) directly before writing any claim, matching squawk
0054's own re-verification: `mintJarKey` copies the existing
`automationKeyHashes` map and overwrites only `hashes[jarId]`, so a re-mint for
the same jar clobbers that jar's prior hash (other jars' hashes are untouched);
`mintAdminKey` writes `automationAdminKeyHash` as a single scalar setting, so a
re-mint clobbers the sole prior admin hash outright. Both confirm the squawk's
Evidence lines. Also re-read `docs/mcp-automation.md`'s *Production
getting-started* (step 3, "Add a `.mcp.json` entry in your MCP client's
config") and *`.mcp.json` registration* section headings to confirm a static
`.mcp.json` entry is a documented, legitimate attach path — not something
`CLAUDE.md` should tell agents to avoid.

`CLAUDE.md:8` (the Commands-section canonical-dev-launch bullet) reworked:
- Canonical launch is now bare `npm run dev:automation`, with
  `GOLDFINCH_AUTOMATION_ADMIN=1` named as an add-on for admin-tier ops, rather
  than baking `GOLDFINCH_AUTOMATION_DEV_MINT=1` into the "always" command.
- Removed "**Always include both env flags**" (the instruction this squawk was
  filed against) and replaced it with an explicit two-model split: (a) script
  harnesses that re-capture the printed `AUTOMATION_DEV_MINT` key each run add
  `GOLDFINCH_AUTOMATION_DEV_MINT=1` per launch and attach via
  `scripts/lib/mcp-client.mjs`; (b) MCP clients holding a standing token in a
  static config (e.g. a `.mcp.json` entry) mint ONCE, then relaunch WITHOUT
  `DEV_MINT` — stated together with the consequence (every re-mint **replaces**
  the stored per-jar/admin hash, so a stale static config starts 401ing).
- Removed the "never a static `.mcp.json` entry" claim and replaced it with
  "(e.g. a `.mcp.json` entry — a legitimate, documented attach path)",
  correcting the false exclusivity against `docs/mcp-automation.md`'s
  production getting-started / `.mcp.json` registration guidance.
- Kept the existing pointers to `docs/dev-testing.md` (launch states/key
  capture/attach recipes) and `docs/mcp-automation.md` (full MCP reference),
  and added "(incl. `.mcp.json` registration)" to the latter pointer since that
  section is now the direct answer to "how do I use a static config."
- `grep -n "DEV_MINT" CLAUDE.md` checked for other always-DEV_MINT instructions:
  the only other hit (line 282, "Bind model") just points to
  `docs/dev-testing.md` for dev/admin key acquisition — it names the
  `AUTOMATION_DEV_MINT` stdout line as a fact, not an instruction to always
  mint, so it needed no reconciliation.

No source, test, or config files touched — `CLAUDE.md` and this squawk file are
the only edits.

## Verification

- Every behavioral claim (per-jar single-hash overwrite, single-scalar
  admin-hash overwrite, `.mcp.json` as a legitimate documented attach path)
  checked directly against `src/main/automation/mcp-server.js` and
  `docs/mcp-automation.md`'s pre-existing *Production getting-started* /
  *`.mcp.json` registration* sections before writing — no claim added beyond
  what those sources and the squawk's own Evidence support. (Squawk 0054's new
  rotation-warning text is NOT in this branch's tree — see Evidence; the
  reworded bullet is deliberately self-contained, stating the rotation
  consequence directly rather than depending on 0054's wording.)
- `npx prettier --check CLAUDE.md` → "All matched files use Prettier code
  style!" — no formatting drift introduced.
- `git diff CLAUDE.md` reviewed: the change is confined to the single
  Commands-section bullet at line 8; no other line touched, no heading
  renamed, telegraphic bullet style and length discipline preserved (one
  bullet, comparable length to the original).
- `git status --short` confirms only `CLAUDE.md` and this squawk file are
  modified — no source, test, or config files touched; `git diff --stat`
  shows no other file in the diff.

## Sign-Off
**Reviewer**: independent Reviewer agent (squawk-review, scoped to the diff)
**Verdict**: confirmed — reworded bullet verified against source (mint overwrite
mechanics; per-request `GOLDFINCH_AUTOMATION_ADMIN` gating; bare
`npm run dev:automation` still force-binds via `--automation-dev`; static
`.mcp.json` entry is a documented attach path); no contradiction elsewhere in
CLAUDE.md; prettier clean. One artifact-accuracy correction required and
applied at close-out: Evidence originally cited squawk 0054's doc additions as
present in this branch's tree, but 0054 lives on its own unmerged PR (#197) —
Evidence/Verification now state that explicitly. The CLAUDE.md bullet is
self-contained and accurate regardless of 0054's merge order.
**Commit**: `squawk/0055-claude-md-canonical-launch-rotation` (squash-merged via its PR)
