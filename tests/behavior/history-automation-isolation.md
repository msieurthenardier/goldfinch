# Behavior Test: getHistory confines each key to its jar; admin reads any named jar

**Slug**: `history-automation-isolation`
**Status**: active
**Created**: 2026-07-12
**Last Run**: 2026-07-13-02-13-20 (pass — 7/7, first run; two launches;
isolation-despite-50k-foreign-rows condition held; run-protocol notes in
the run log: pre-declare jar-key-run teardown mechanics, Executor tears
down only after Validator [CLOSING])

## Intent

Close Mission 08's automation criteria in the running app: a JAR-keyed
client's `getHistory` returns ONLY its own jar's history (recent and
search), a supplied foreign `jarId` is refused with the discriminated
`automation: out-of-jar` code and NO data, and the ADMIN identity reads
any NAMED jar (`unknown-jar` on a bogus id, `bad-args` on a missing one).
The confinement is decided by the live key→jar binding on the loopback
MCP transport — only a real two-launch run (jar key vs admin key)
exercises it end-to-end. The refusal matrix itself is unit-pinned
(scope/engine suites); this spec proves the LIVE binding.

**Isolation-despite-scale is deliberate**: the dev profile carries ~50k
foreign-jar rows (F4's seeded population, kept on purpose) — the jar
key's reads must stay clean against that population, asserted via
distinctive markers and deltas, never absolute counts.

## Preconditions

- Dev-profile drift check (the `mcp-jar-scoping` rule): read
  `~/.config/goldfinch-dev/containers.json`, record the RESOLVED
  `defaultId` (do not hardcode a jar name) and confirm a second
  persistent jar exists. The auto-mint provisions the RESOLVED-DEFAULT
  jar's key.
- Fixture rows are staged through the LIVE recorder (the F4 lesson —
  resolvable local pages): a static server on `127.0.0.1:8000` with
  titled pages; visit 2–3 pages in the DEFAULT jar and 2 DIFFERENT
  distinctive pages in the SECOND jar (admin openTab with that jarId).
  Marker titles must be unique to this run (e.g. "Auklet Alpha" default /
  "Petrel Alpha" second jar).
- Launches: run 1 with `GOLDFINCH_AUTOMATION_DEV_MINT=1` only (jar key,
  resolved default); run 2 adds `GOLDFINCH_AUTOMATION_ADMIN=1` (admin
  key). Staging is re-done per launch where needed (history persists;
  only keys/tabs reset). Scripted SDK client; `GOLDFINCH_MCP_PORT`
  pinned.
- readOnly node:sqlite cross-checks of `history.db` (WAL concurrent
  reads — proven three runs running).

## Observables Required

- mcp (getHistory results + isError refusal codes over the loopback
  transport — jar-key and admin clients)
- filesystem (history.db marker/count cross-checks — Bash + node:sqlite)
- browser (tab staging via admin/enumerate — goldfinch MCP)
- shell (launches, key capture, fixture server — Bash)

## Steps

### Jar-key run (mint env only; key = resolved default jar)

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Setup: drift check + fixture server + launch (mint env, NO admin); capture the jar key; connect; stage the default-jar marker visits (navigate the active tab); DB cross-check both jars' marker rows exist (second jar's markers may be staged in run 2 if openTab-with-jarId needs admin — note which). | Initialize succeeds bound to the resolved-default jar; DB shows this run's default-jar markers. Halt if the key binds to a different jar than resolved. |
| 2 | **Own-jar read.** `getHistory` with NO jarId (limit ~50). | `{ jarId: <own>, visits }` — visits include this run's default-jar markers; EVERY returned row's URL/title cross-checks to a `jar_id = <own>` DB row (spot-check several); ZERO rows match the second jar's distinctive markers. |
| 3 | **Own-jar search.** `getHistory({ query: <own marker token> })` and `getHistory({ query: <SECOND jar's marker token> })`. | First returns the own-jar marker rows; second returns EMPTY visits (the foreign marker exists in the DB — cross-checked — but never crosses the jar boundary). |
| 4 | **Foreign jarId refused.** `getHistory({ jarId: <second jar id> })`. | `isError` with `automation: out-of-jar`; NO visit data in the response. |
| 5 | **Explicit own jarId allowed.** `getHistory({ jarId: <own id> })`. | Same shape as step 2 (own jarId is not a violation). |

### Admin run (both envs; re-launch)

| # | Actions | Expected Results |
|---|---------|------------------|
| 6 | Relaunch with admin env; capture adminKey; connect as admin; stage the SECOND jar's markers now if not in run 1 (admin openTab jarId). `getHistory({ jarId: <second jar id> })` and `getHistory({ jarId: <default jar id> })`. | Both succeed with each jar's own rows (admin reads any NAMED jar); the second-jar response contains its markers and none of the default jar's. |
| 7 | **Admin arg contract.** `getHistory` with NO jarId; then `getHistory({ jarId: 'no-such-jar-xyz' })`. | Missing → `isError` `automation: bad-args — jarId required`; unknown → `isError` `automation: unknown-jar`. |

## Out of Scope

- Recording semantics, restart survival (F1's `history-recording`).
- Omnibox exclusivity (F4's `omnibox-suggestions` step 3).
- Web-page reachability (structural: no `ipcRenderer` in web content;
  origin-gated internal twins — unit-pinned since F1).
- Auth admission (mcp-auth-gating) and drive confinement
  (mcp-jar-scoping).

## Variants (optional)

- Paging variant: `before` cursor from an own-jar row id (fail-closed
  foreign-cursor behavior is unit-pinned; a live row could be added
  later).
