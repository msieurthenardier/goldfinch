# Leg: verify-and-behavior-tests

**Status**: completed (deterministic scope; PART-D live behavior runs deferred — operator decision)
**Flight**: [Polish & MCP Hygiene](../flight.md)

> **Closed 2026-06-21.** PARTS A/B/C (spec hardening, drift reconciles, unit/typecheck/lint, a11y gate
> green) DONE. **PART D (live behavior-test runs) DEFERRED** by operator decision after the #27 HAT detour:
> the `downloads-surface` re-run + `page-context-menu`/`spellcheck` `draft→active` flips are carried to a
> focused follow-up (recorded in the mission Known Issues). The four landed wins are unit-/a11y-/review-backed
> without them; DD5 is therefore only partially met (specs remain `draft`).

## Objective

Close the flight: **harden** `tests/behavior/downloads-surface.md` (promote same-filename dedup to a
required step + add a single-download → exactly-one-record count assertion — regression guards for the
Flight-5 double-download / wrong-filename HAT defects); **reconcile** the spec/test/doc drift handed off
from legs 2–3 (the stale `settings-shell.md` nav inventory and the three tool-count comments) to the live
truth; **run** the behavior tests (`downloads-surface` re-run, `page-context-menu`, `spellcheck`) under
the scripted-live-integration-smoke apparatus with **per-row disposition** (DD5) so no spec stays `draft`;
and confirm the **whole suite green** (`npm test` ~950, `npm run typecheck`, `npm run lint`, `npm run a11y`
0 new violations) — all without committing (deferred-commit model: the flight-level commit flips legs to
`completed`).

## Context

- **DD5 (the heart of this leg)** — resolve the behavior-test debt by RUNNING it with **per-row**
  disposition, not a binary per-spec verdict. Harden `downloads-surface`; for `page-context-menu.md` and
  `spellcheck.md` the apparatus-observability Open Question is **resolved YES** (flight.md `:88`-`:97`):
  both are MCP-runnable on the admin surface — the renderer-chrome custom menu is readable via
  `readDom(chromeWcId)`/`readAxTree`/`captureWindow` on the chrome `wcId` from `getChromeTarget()`. Both
  specs are **mixed**: most rows are WSLg-acceptance observables (menu plumbing, opt-in state, correction
  round-trip); only the **native-render rows** (spellcheck red-squiggle PAINT; native NSSpellChecker/`.bdic`
  egress) are macOS/HAT-authoritative. Runnable rows flip the spec `draft` → `active`; native rows are
  recorded **per-row** as INCONCLUSIVE-on-WSLg / macOS-deferred — never used to demote the whole spec.
- **Apparatus precedent (Flight 5, verify-integration leg).** The Flight-5 verify leg established that a
  **scripted live integration smoke** over the MCP automation surface — launch
  `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, capture the bound
  port from the listening socket, drive via MCP tools, assert observables — is a **leg-permitted
  alternative** to the full multi-agent Witnessed `/behavior-test` run, and is the realistic path in this
  WSLg / headless-agent environment. See
  `../../05-downloads-surface/legs/06-verify-integration.md` (Implementation Guidance step 2) and the
  recorded run log at `tests/behavior/downloads-surface/runs/2026-06-20-10-02-09.md` (Mode: "scripted live
  integration smoke").
- **Handoffs from prior legs (flight-log Leg Progress):**
  - Leg 2 (`presskey-schema-hygiene`) flagged tool-count drift to this leg: `automation-mcp-tools.test.js:8`
    comment "14 drive tools" and `mcp-server.js:328` JSDoc "24 tools".
  - Leg 3 (`settings-cleanup`) flagged `tests/behavior/settings-shell.md:84` as **already stale** (lists
    "Downloads" among the section-nav links, omits the Automation section, miscounts) — its reconcile to the
    POST-cleanup truth is owned here, not by the HTML-only leg.
  - The flight-spec verify-leg line (`flight.md:285`-`:290`) adds the `spellcheck.md:51` "26" → live-27
    reconcile.
- **Final autonomous leg.** After this lands (uncommitted), the flight goes to flight-level code review +
  single commit (the deferred-commit model — flight-log Flight Director Notes), then the optional
  `hat-and-alignment` leg picks up the native-render / visual checkpoints this leg dispositions.
- **No source-file changes.** This is a verify-integration leg: it edits behavior-test specs, a test-file
  comment, a JSDoc comment, and writes run logs — it does **not** change product behavior. The SC9/SC10
  fixes already landed in legs 1–2.

## Inputs

What exists before this leg runs:
- **Behavior specs (committed):**
  - `tests/behavior/downloads-surface.md` — **already `active`** (passed via scripted smoke in Flight-5
    leg 6). Has a same-filename dedup as an **optional Variant** (`:72`-`:75`), NOT a required step; has no
    explicit single-download-count assertion. Step table is rows 1–6 (`:50`-`:57`).
  - `tests/behavior/page-context-menu.md` — `**Status**: draft`; a fully-elaborated **12-step** MCP-runnable
    spec (`:84`-`:97`).
  - `tests/behavior/spellcheck.md` — `**Status**: draft`; a **6-step** mixed spec (`:79`-`:85`) with a
    top-of-spec WSLg-limitation block (`:8`-`:16`) already encoding the squiggle/`NSSpellChecker`
    macOS-authoritative carve-out.
- **Drift sites to reconcile (verified this session):**
  - `tests/behavior/settings-shell.md:84` — "the 5 links (Appearance, Privacy & Shields, On startup / Home
    page, Downloads, About) and **5 titled `<section>`s**". STALE: lists "Downloads" (removed leg 3), omits
    "Automation", and the link labels don't match the live nav.
  - `tests/behavior/spellcheck.md:50` — "the **26-tool** surface is drive/observe/eval/devtools/discovery
    only". STALE: live is **27**. *(Note: the flight cited this as `:51`; the actual line is `:50` — repaired
    below.)*
  - `test/unit/automation-mcp-tools.test.js:8` — comment "They pin the discovery contract (**14 drive tool
    names** + schemas …". STALE: the `DRIVE_NAMES` array at `:21`-`:26` has **17** entries; the assertion
    contract is correct, only the prose number is wrong.
  - `src/main/automation/mcp-server.js:328` — JSDoc "Build a fresh MCP Server with the **24 tools** wired
    …". STALE: live is **27**.
- **Live truth (verified this session):**
  - **Settings nav** — `src/renderer/pages/settings.html`: 5 nav links at `:14`-`:18`
    (Appearance, Privacy & Shields, **Automation**, On startup, About) and 5 `<section>`s at
    `:23`/`:47`/`:64`/`:118`/`:125` (`appearance`, `privacy`, `automation`, `startup`, `about`).
  - **Tool count = 27** — pinned by `EXPECTED_TOOL_COUNT = 27` in
    `test/unit/automation-mcp-server.test.js:26` (asserted against `listTools()` at `:257` et al.) and the
    27-name registry in `src/main/automation/mcp-tools.js` (`:120`-`:510`). **Drive split = 17** (the
    `DRIVE_NAMES` array, `automation-mcp-tools.test.js:21`-`:26`).
  - **Docs already correct (no drift):** `docs/mcp-automation.md:19`-`:21` already reads "27 tools — 17 drive
    …", `:326` "All 27 tools", and the `pressKey` row `:346` already describes the requirement as prose
    ("`wcId` required; `name` or its alias `key` required") — consistent with the #56 schema flatten.
    `CLAUDE.md:194` already reads "27 tools — 17 drive …" and the same pressKey prose. **PART B's
    doc-sweep therefore confirms-no-drift in `docs/mcp-automation.md` + `CLAUDE.md`** (Flight-5 leg 6 already
    bumped the docs; the leg-2 flatten left no schema-count statement in them to break).
- **Apparatus prerequisites:**
  - Live Electron GUI under WSLg (X11/`:0`) + the env-key model:
    `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` prints
    `AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey>"}`; capture both keys and the bound MCP
    port from the listening socket (free-fallback off 49707 observed last run → bound 49709).
  - The downloads fixture `tests/behavior/fixtures/downloads/download-fixture.bin` (4096 B, landed Flight 5).
  - A right-clickable target page for `page-context-menu` (`https://example.com/` has link+selection; an
    all-targets fixture e.g. `tests/behavior/fixtures/a11y-media/` or a `data:` doc for image+editable).
  - A writable `userData/settings.json` for the spellcheck opt-in / toolbar-pin filesystem observables.
- **Gates baseline:** `npm test` = `node --test test/unit/*.test.js` (currently **950** across 36 files);
  `npm run typecheck`; `npm run lint`; `npm run a11y` = `node scripts/a11y-audit.mjs` (live-GUI + MCP-admin
  apparatus-gated).

## Outputs

What exists after this leg completes:
- `tests/behavior/downloads-surface.md` — **hardened** (PART A): a new required dedup step + a single-download
  count assertion; the optional Variant either retired (now covered by the required step) or retained as the
  multi-record listing corroboration. Stays `active`.
- `tests/behavior/settings-shell.md` — reconciled (PART B): `:84` nav inventory corrected to the post-cleanup
  truth (5 links incl. Automation, excl. Downloads; 5 sections).
- `tests/behavior/spellcheck.md` — reconciled (`:50` 26 → 27) and, on a passing run, **`draft` → `active`**
  with native rows recorded per-row INCONCLUSIVE-on-WSLg.
- `tests/behavior/page-context-menu.md` — on a passing run, **`draft` → `active`** (its rows are all
  WSLg-readable observables; the macOS native-suppression / pixel-feel items are already Out-of-Scope, so no
  per-row INCONCLUSIVE is needed beyond what the spec already carves out).
- `test/unit/automation-mcp-tools.test.js:8` — comment 14 → **17** drive tools.
- `src/main/automation/mcp-server.js:328` — JSDoc 24 → **27** tools.
- `tests/behavior/{downloads-surface,page-context-menu,spellcheck}/runs/{ts}.md` — new run logs (one per
  spec run), committed; ephemeral evidence (screenshots, real abs paths, payload JSON) under
  `/tmp/behavior-tests/goldfinch/{slug}/{ts}/` — NOT committed.
- Whole-suite-green confirmation (unit 950 / typecheck / lint / a11y 0 new) recorded in the flight log.

## Acceptance Criteria

- [x] **AC1 — downloads-surface dedup is a REQUIRED step (PART A).** `tests/behavior/downloads-surface.md`
  carries a **required** step (in the `## Steps` table, not the optional `## Variants`) that triggers a
  **second** download of the **same** filename and asserts the model dedups the on-disk path (a ` (n)` /
  `uniquePath` suffix) while listing **both** records distinctly — the regression guard for the Flight-5
  **wrong-filename** HAT defect.
- [x] **AC2 — single-download count assertion (PART A).** The spec asserts that a **single** download
  produces **exactly one** new record (count goes `N → N+1`, not `N+2`) — the regression guard for the
  Flight-5 **double-download** HAT defect. (May sharpen the existing row-3 `N+1` into an explicit
  "exactly one new record, no duplicate id" assertion rather than adding a separate row.)
- [x] **AC3 — settings-shell nav reconciled (PART B).** `tests/behavior/settings-shell.md:84` lists the
  **live** nav: exactly **5 links — Appearance, Privacy & Shields, Automation, On startup, About** (NO
  "Downloads") — and **5 `<section>`s** (`appearance`, `privacy`, `automation`, `startup`, `about`). No
  "Downloads" reference remains in the spec.
- [x] **AC4 — tool-count drift reconciled to 27 (PART B).** Three sites corrected to the live counts:
  `tests/behavior/spellcheck.md:50` "26-tool" → **27**; `test/unit/automation-mcp-tools.test.js:8` "14 drive
  tool names" → **17**; `src/main/automation/mcp-server.js:328` "24 tools" → **27**. Each verified against
  the live registry (`EXPECTED_TOOL_COUNT = 27`; `DRIVE_NAMES.length === 17`).
- [x] **AC5 — doc-sweep confirmed (PART B).** `docs/mcp-automation.md` + `CLAUDE.md` re-checked for any
  pressKey-schema or tool-count statement left stale by the #56 flatten or the count bump — and **confirmed
  clean** (both already read "27 tools / 17 drive" and describe the pressKey name-or-key requirement as
  prose). If any drift IS found at run time, it is fixed; otherwise the audit records "no drift found".
- [x] **AC6 — gates green (PART C).** `npm test` passes (≈**950**, no regressions; net change from this leg
  is comment-only in source), `npm run typecheck` exit 0, `npm run lint` exit 0. The **SC9 schema-hygiene**
  unit test (leg 2, chrome-sweep-independent) is among the green suite. *(Verified this pass: `npm test` =
  **950/950 pass, 0 fail** — exactly the baseline, confirming the comment/spec edits changed no test count;
  `npm run typecheck` exit 0; `npm run lint` exit 0.)*
- [ ] **AC7 — a11y sweep (PART C, apparatus-gated). DEFERRED TO HAT LEG (apparatus-gated).** `npm run a11y`
  (chrome sweep) needs a live Electron GUI + minted MCP admin key, unavailable to this headless autonomous
  pass (per the leg-1/3/5 precedent). The Flight Director is deferring it to the operator-driven
  `hat-and-alignment` leg, where the operator has a real display — recorded here, NOT silently skipped.
- [ ] **AC8 — downloads-surface re-run green (PART D). DEFERRED TO HAT LEG (apparatus-gated).** Requires a
  live `dev:automation` GUI + admin key. A skeleton run-log is pre-written at
  `tests/behavior/downloads-surface/runs/SKELETON-PENDING-HAT-RUN.md` (with the new dedup +
  exactly-one-record checkpoints pre-listed) for the HAT run to complete.
- [ ] **AC9 — page-context-menu run with per-row disposition (PART D / DD5). DEFERRED TO HAT LEG
  (apparatus-gated).** Requires the live GUI + admin key. Skeleton run-log pre-written at
  `tests/behavior/page-context-menu/runs/SKELETON-PENDING-HAT-RUN.md` (all 12 rows pre-listed with their
  RUN dispositions); the spec `draft → active` flip happens in the HAT run.
- [ ] **AC10 — spellcheck run with per-row disposition (PART D / DD5). DEFERRED TO HAT LEG
  (apparatus-gated).** Requires the live GUI + admin key. Skeleton run-log pre-written at
  `tests/behavior/spellcheck/runs/SKELETON-PENDING-HAT-RUN.md` (rows pre-dispositioned: 1–3/5-plumbing/6 =
  WSLg-acceptance RUN; row 4 + row 5 native-content half = INCONCLUSIVE-on-WSLg / macOS-deferred). The HAT
  run flips `draft → active` and records the per-row INCONCLUSIVE dispositions.
- [ ] **AC11 — no spec left `draft`. DEFERRED TO HAT LEG (apparatus-gated).** `page-context-menu.md` +
  `spellcheck.md` remain `draft` after this autonomous pass — the live apparatus is unavailable here, so per
  the Feasibility split the `draft → active` flips are folded into `hat-and-alignment` (recorded, not
  silently skipped). `downloads-surface.md` stays `active` (the PART-A hardening tightened it without
  resetting it).
- [ ] **AC12 — evidence handling. DEFERRED TO HAT LEG (apparatus-gated — depends on the live runs).** The
  run-log + ephemeral-evidence split is established in the pre-written skeletons (committed `.md` under
  `tests/behavior/{slug}/runs/`, ephemeral evidence under `/tmp/behavior-tests/goldfinch/{slug}/{ts}/`,
  `~/…`-anonymized committed paths). The actual evidence is produced by the HAT live runs.

## Verification Steps

How to confirm each criterion:
- **AC1/AC2** — `grep -n "dedup\|uniquePath\|exactly one\|N + 1\|same.*filename" tests/behavior/downloads-surface.md`;
  read the `## Steps` table and confirm the dedup row is in Steps (not Variants) and the count assertion is
  explicit.
- **AC3** — `grep -n "Downloads\|Automation\|5 links\|5 titled" tests/behavior/settings-shell.md` → no
  "Downloads" in the nav list; "Automation" present; "5 links" / "5 ... section" still correct.
- **AC4** — `grep -n "27\|17 drive\|26\|14 drive\|24 tools" tests/behavior/spellcheck.md test/unit/automation-mcp-tools.test.js src/main/automation/mcp-server.js`
  → the stale 26/14/24 are gone, replaced by 27/17/27. Cross-check against
  `grep -n "EXPECTED_TOOL_COUNT = " test/unit/automation-mcp-server.test.js` (= 27) and the 17-entry
  `DRIVE_NAMES`.
- **AC5** — `grep -n "anyOf\|26 tool\|24 tool\|name.*or.*key" docs/mcp-automation.md CLAUDE.md` → no stale
  count / schema-combinator statements; the pressKey requirement reads as prose.
- **AC6** — `npm test` (count ≈ 950, 0 fail) `&& npm run typecheck && npm run lint` all exit 0.
- **AC7** — `npm run a11y` → 0 new violations; OR the deferral is recorded in the flight log + this leg's
  disposition.
- **AC8–AC11** — the run logs exist under each `tests/behavior/{slug}/runs/`; each records a per-step verdict;
  the three spec headers read `**Status**: active` (or the escalation is recorded for AC11).
- **AC12** — `ls /tmp/behavior-tests/goldfinch/*/` holds the evidence; `git status tests/behavior/` shows
  only specs + run-log `.md` files staged, no screenshots/JSON.

## Implementation Guidance

### PART A — Deterministic spec hardening (no live env)

1. **Promote the dedup Variant to a required Step.** In `tests/behavior/downloads-surface.md`, move the
   same-filename dedup currently at `## Variants` (`:72`-`:75`) into the `## Steps` table as a new required
   row after the current row 3 (or 5). The row triggers a **second** `navigate` to the **same** fixture URL,
   waits for settle, then `downloadsList` (admin) and asserts: the model lists **both** records distinctly,
   and the second record's `savePath` carries the `uniquePath` ` (n)` suffix (distinct on-disk path) — the
   wrong-filename regression guard. Update the row-conventions note accordingly. Remove the now-redundant
   Variant (or keep it only as a >2 repetition note; do not leave the required behavior living only in
   Variants).
2. **Add the exactly-one-record count assertion.** Sharpen the existing row 3 (`:54`) — which asserts
   `N + 1` — into an explicit "**exactly one** new record (count `N → N+1`, NOT `N+2`); no duplicate `id`"
   assertion, so a recurrence of the Flight-5 double-`will-download` defect fails the step. State it as a
   single-trigger → single-record invariant.
3. Keep the spec `active` (it is already `active`); these edits tighten an active spec, they don't reset it.
   Bump `**Last Run**` only when the re-run (PART D) actually executes.

### PART B — Deterministic reconciles (no live env)

4. **settings-shell.md:84.** Rewrite the row-3 Expected Result to the live nav: "**5 links** (Appearance,
   Privacy & Shields, **Automation**, On startup, About)" and "**5 titled `<section>`s**" — removing
   "Downloads" and the stale "On startup / Home page" label drift, adding "Automation". Verify no other line
   in the spec references a Downloads settings section.
5. **Tool-count comments → 27 / 17.** Edit comment text only (no behavior change):
   - `tests/behavior/spellcheck.md:50` — "26-tool surface" → "**27-tool** surface".
   - `test/unit/automation-mcp-tools.test.js:8` — "14 drive tool names" → "**17** drive tool names". (The
     `DRIVE_NAMES` array at `:21`-`:26` is already 17 — this is the prose catching up to the contract.)
   - `src/main/automation/mcp-server.js:328` — "the 24 tools wired" → "the **27** tools wired".
   - After editing, `npm test` must stay green (these are comments; if any assertion keyed off the number,
     it would already have been failing — confirm).
6. **Doc sweep (confirm-or-fix).** Re-read `docs/mcp-automation.md` (`:19`-`:21`, `:326`, the `pressKey` row
   `:346`) and `CLAUDE.md:194` for any tool-count or pressKey-schema statement made stale by #56 or the
   count. **Recon this session found them already correct** ("27 tools / 17 drive"; pressKey requirement as
   prose). If still clean at run time, record "no drift found"; if anything drifted since, fix it and note
   it. Do **not** re-touch the internal-page allowlist / `INTERNAL_ORIGINS` / bridge notes (owned by Flight-5
   legs 2/3/5).

### PART C — Gates (deterministic + live)

7. **Deterministic gates.** Run `npm test` (expect ≈950 green — this leg adds no tests and changes only
   comments in source, so the count should match the leg-5 baseline of 950), `npm run typecheck`,
   `npm run lint` — all clean. The **SC9 schema-hygiene** unit test (leg 2, asserts no tool `inputSchema`
   carries a top-level `anyOf`/`oneOf`/`allOf`/`not`) runs in this suite and is **chrome-sweep-independent**
   — it must be green here regardless of GUI availability.
8. **a11y sweep (apparatus-gated).** `npm run a11y` needs a **live Electron GUI + MCP admin key** (the
   `scripts/a11y-audit.mjs` chrome sweep). Per Flight-5 precedent and the leg-1 handoff: if the apparatus is
   available, run it and confirm **0 new violations** vs the pinned baseline; if it is **not** available in
   the autonomous env, **defer to `hat-and-alignment`** and record the deferral — do NOT silently skip. (The
   leg-1/3/5 a11y re-runs all rolled forward to this leg + the HAT leg for the same reason.)

### PART D — Behavior-test runs (live apparatus; DD5 per-row disposition)

9. **Apparatus — scripted live integration smoke (Flight-5 precedent).** Use the same model the Flight-5
   verify leg recorded:
   - Launch `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`
     (background, WSLg X11/`:0`); capture `adminKey` + `jarKey` from the `AUTOMATION_DEV_MINT` stdout line
     and the **bound MCP port** from the listening socket (do NOT hardcode 49707 — it free-falls-back).
   - Connect an SDK admin MCP client (`StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`)
     on `127.0.0.1:<port>/mcp` (the pattern in each spec's Preconditions; reuse `scripts/lib/mcp-client.mjs`
     as the prior run did). The `chrome-devtools` MCP does **NOT** qualify (it launches its own browser —
     false pass).
   - Drive the spec rows via MCP tools, assert observables, capture evidence, write the run log. Tear down
     the dev instance + any fixture HTTP server after.
   - This is the **leg-permitted alternative** to a full multi-agent Witnessed `/behavior-test` run. The
     Flight Director may instead run `/behavior-test {slug}` (Witnessed) if a live multi-agent session is
     available; either path satisfies AC8–AC10 as long as the real observables are exercised.
10. **Run `downloads-surface` (re-run).** Re-run the hardened spec end-to-end (fixture server
    `python3 -m http.server 8000 --directory tests/behavior/fixtures`; `openTab` → `navigate` to the `.bin`
    fixture; `downloadsList` admin baseline → after; `stat` `savePath`; jar-key refusal; **plus** the new
    dedup + exactly-one-record checkpoints). Write the run log; keep the spec `active`.
11. **Run `page-context-menu` — per-row disposition.** All 12 steps are WSLg-readable on the chrome
    `getChromeTarget()` surface (see disposition table). Run them; record each verdict. On pass, flip the
    spec header `draft` → `active`. The macOS native-suppression / pixel-feel / DevTools-materialization
    items are already in the spec's Out-of-Scope — not run here.
12. **Run `spellcheck` — per-row disposition.** Run the WSLg-acceptance rows (state proxy + opt-in +
    correction plumbing); record the **native-render rows** as INCONCLUSIVE-on-WSLg / macOS-deferred. On the
    WSLg-acceptance rows passing, flip `draft` → `active`; fold the INCONCLUSIVE rows into the
    `hat-and-alignment` leg's acceptance and record them per-row in the run log (the spec's top-of-spec block
    already documents this disposition).
13. **Evidence + run logs.** One run log per spec at `tests/behavior/{slug}/runs/{ts}.md` (committed, format
    per ARTIFACTS.md / the existing `downloads-surface` run log). Ephemeral evidence (screenshots, payload
    JSON, real abs paths) under `/tmp/behavior-tests/goldfinch/{slug}/{ts}/` — never committed; committed
    artifacts anonymize absolute paths to `~/…`.

### Per-row disposition plan (DD5)

**`page-context-menu.md` (12 steps) — all RUN-GREEN-HERE on the WSLg admin apparatus:**

| Step | Disposition | Why |
|------|-------------|-----|
| 1 probe (tools/list + getChromeTarget) | RUN | shell/MCP presence + numeric chrome wcId |
| 2 open page + locate targets | RUN (setup) | captureWindow coordinates |
| 3 right-click link → menu render | RUN | `#page-context-menu` DOM readable on chrome wcId |
| 4 right-click image → image section | RUN | chrome DOM |
| 5 select text → selection section | RUN | chrome DOM (+ programmatic selection via `evaluate`) |
| 6 right-click editable → editable section (editFlags-gated omit) | RUN | chrome DOM |
| 7 cursor position mapping | RUN | `getBoundingClientRect` via evaluate / captureWindow measure |
| 8 keyboard nav (Arrow/Home/End/Escape) + focus | RUN | readAxTree + pressKey on chrome wcId |
| 9 Shift+F10 / ContextMenu chrome-focused → Inspect-only | RUN | chrome DOM |
| 10 no-op on internal `goldfinch://settings` | RUN | negative observable: menu stays `.hidden` |
| 11 toolbar Unpin opens custom menu | RUN | chrome DOM |
| 12 Unpin activate + persist (`settings.json` `toolbarPins`) | RUN | chrome DOM + filesystem |

→ All runnable → on pass, `page-context-menu.md` flips **`draft` → `active`**. (Pixel feel, macOS
native-suppression confirmation, Inspect→DevTools materialization are the spec's existing Out-of-Scope —
HAT/macOS-authoritative, not per-row INCONCLUSIVE here.)

**`spellcheck.md` (6 steps) — MIXED:**

| Step | Disposition | Why |
|------|-------------|-----|
| 1 probe | RUN | MCP presence + chrome wcId |
| 2 Default-OFF state proxy (settings.json + no params engagement) | RUN | filesystem + chrome menu params; the STATE proxy, NOT a network assertion |
| 3 enable via Settings Appearance (`#spellcheck-enabled`) | RUN | settings-guest aria-checked + settings.json `spellcheck:true` |
| 4 squiggle PAINT on misspelled word | **INCONCLUSIVE-on-WSLg / macOS-deferred** | red wavy underline does not paint into a `captureWindow` frame under WSLg (Leg-2 premise-audit, Electron 42.4.0); API toggle confirmed live, render is not — fold into `hat-and-alignment` |
| 5 right-click → suggestions → choose → correction round-trip | **MIXED** — menu-plumbing half RUN (when `params` carry `misspelledWord`+suggestions, the section renders + `correctMisspelling` changes the field text via `evaluate`); empty-`dictionarySuggestions` = dict-not-loaded, **not a failure**; the native `NSSpellChecker` suggestion-list **content** is **macOS-authoritative** | guest DOM via evaluate is readable; native speller content is not |
| 6 disable round-trips OFF (settings.json `spellcheck:false`) | RUN | filesystem |

→ Rows 1–3, 5(plumbing half), 6 are WSLg-acceptance → on pass, `spellcheck.md` flips **`draft` → `active`**.
Row 4 (full) and row 5's native-content half are recorded **per-row INCONCLUSIVE-on-WSLg / macOS-deferred**
in the run log and folded into `hat-and-alignment` — **never** used to keep the spec `draft`.

### Feasibility — who runs the live behavior tests (IMPORTANT for the Flight Director)

The live behavior-test runs (PART D) and the `npm run a11y` sweep (PART C step 8) require a **live Electron
GUI under WSLg + an MCP admin key minted at launch**. Recon and the prior-leg record show this apparatus is
**NOT reliably available to a spawned autonomous Developer agent** in this environment:

- Legs 1, 3, 5 each **deferred `npm run a11y`** because the headless agent could not launch the live GUI
  (flight-log Leg Progress); leg 1 explicitly notes the chrome sweep "does **not** run in this headless agent
  environment."
- The Flight-5 verify leg's downloads-surface smoke was run as a **scripted live integration smoke** that
  needed the live `dev:automation` instance + a captured bound port — feasible only where the GUI launches.

**Recommendation (the split):**
1. **PARTS A + B + C-deterministic** (spec hardening, reconciles, `npm test` / `typecheck` / `lint`,
   incl. the chrome-sweep-independent SC9 hygiene test) → **assign to the autonomous Developer agent.** Fully
   deterministic, no GUI, no apparatus.
2. **PART C `npm run a11y` + PART D live behavior runs** → **the Flight Director runs these directly** (via
   the scripted live integration smoke and/or `/behavior-test {slug}`) **OR folds them into the operator-driven
   `hat-and-alignment` leg.** Concretely: the Flight Director attempts the scripted smoke in-session; if the
   GUI is unavailable even to the Director, the three behavior runs + the a11y sweep + the native-render
   INCONCLUSIVE rows all roll into `hat-and-alignment`, where the operator has a real display. The spec
   `draft → active` flips (AC9–AC11) then happen in whichever pass actually exercises the observables — and
   are **recorded**, never silently skipped.

This keeps the autonomous leg honest (it lands the deterministic work + the hardened/reconciled specs) while
not pretending a headless agent can drive a live GUI. The deferred-commit model accommodates this: the
flight-level commit happens after `hat-and-alignment`, so a behavior run completed in the HAT leg still lands
inside this flight's single commit.

## Edge Cases

- **Live GUI unavailable to the autonomous agent** (expected, per legs 1/3/5): do the deterministic parts,
  record the live runs + a11y as deferred-to-Director/HAT — do **not** mark AC8–AC11/AC7 done on a skip.
- **MCP port not 49707**: capture the bound port from the listening socket (last run free-fell to 49709);
  never hardcode.
- **octet-stream doesn't trigger a download in the re-run env**: the spec's documented fallback is a tiny
  `Content-Disposition: attachment` server — record which mechanism was used (the prior run needed no
  fallback).
- **spellcheck dict-not-loaded (empty `dictionarySuggestions`)**: this is the dict-not-loaded case, **not a
  failure** — a populated list confirms the plumbing, an empty list is neutral (spec step 5 + top block).
- **Jar-key refusal must be the distinct admin-only error** (the "jewel of the gate"): confirm the message
  text for `downloadsList` (and `getChromeTarget` in the page-context-menu/spellcheck specs), not a generic
  401 or "not a function".
- **`npm test` count drift from 950**: this leg changes only comments in source + edits specs/run-logs, so
  the count should hold at 950. If it differs, investigate before claiming AC6 — a changed count means a test
  was added/removed somewhere unexpected.
- **Run-log evidence leaking real abs paths into the committed `.md`**: anonymize `savePath`/home paths to
  `~/…` in the committed run log; the real path stays only in the ephemeral `/tmp/...` evidence (public-repo
  + operator-identity policy).

## Files Affected

- `tests/behavior/downloads-surface.md` — PART A hardening (dedup required step + exactly-one-record). Stays
  `active`.
- `tests/behavior/settings-shell.md` — `:84` nav inventory reconcile.
- `tests/behavior/spellcheck.md` — `:50` 26 → 27; on a passing run, `draft` → `active`.
- `tests/behavior/page-context-menu.md` — on a passing run, `draft` → `active` (no body edit otherwise).
- `test/unit/automation-mcp-tools.test.js` — `:8` comment 14 → 17 drive tools (comment only).
- `src/main/automation/mcp-server.js` — `:328` JSDoc 24 → 27 tools (comment only).
- `tests/behavior/{downloads-surface,page-context-menu,spellcheck}/runs/{ts}.md` — **new** run logs.
- `docs/mcp-automation.md`, `CLAUDE.md` — **re-checked, expected no change** (already correct; fix only if
  drift surfaces).
- Ephemeral (NOT committed): `/tmp/behavior-tests/goldfinch/{slug}/{ts}/` evidence.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified (AC1–AC12) — or live-apparatus ACs (AC7–AC11) explicitly recorded as
  deferred-to-Director/HAT, not skipped.
- [ ] Tests passing (`npm test` ≈950, `npm run typecheck`, `npm run lint`); `npm run a11y` 0 new violations
  (or deferral recorded).
- [ ] PART A hardening landed in `downloads-surface.md`; PART B reconciles landed (settings-shell nav,
  three count comments); doc-sweep recorded.
- [ ] Behavior runs executed (or escalated) with per-row disposition; run logs written; no spec left `draft`
  (or the flip escalated to HAT and recorded).
- [ ] Update flight-log.md with leg progress entry (+ the run dispositions + the feasibility split outcome).
- [ ] Set this leg's status to `completed` (in this file's header).
- [ ] Check off this leg in flight.md.
- [ ] This is the **final autonomous leg** → flight goes to flight-level code review + single commit (Flight
  Director), NOT committed by this leg. Update flight.md status to `landed` after review.
- [ ] Commit deferred per `/agentic-workflow` (the flight-level commit flips legs → `completed`).

---

## Citation Audit

All code/spec-location citations verified against current code this session (4 drift sites checked per the
flight handoff; 2 of 4 line numbers repaired, all 4 content-confirmed):

- `tests/behavior/settings-shell.md:84` — **OK (content), drift CONFIRMED.** The line says "5 links
  (Appearance, Privacy & Shields, On startup / Home page, Downloads, About) and 5 titled `<section>`s" —
  confirmed stale (lists Downloads, omits Automation). Reconcile target verified against
  `src/renderer/pages/settings.html:14`-`:18` (5 links incl. Automation, excl. Downloads) + `:23`/`:47`/
  `:64`/`:118`/`:125` (5 sections).
- `tests/behavior/spellcheck.md:51` (flight citation) — **DRIFTED → repaired to `:50`.** The "26-tool
  surface" string is at line **50**, not 51. Content confirmed stale (live = 27 per
  `test/unit/automation-mcp-server.test.js:26` `EXPECTED_TOOL_COUNT = 27`).
- `test/unit/automation-mcp-tools.test.js:8` — **OK, drift CONFIRMED.** Comment reads "14 drive tool names";
  the `DRIVE_NAMES` array at `:21`-`:26` has **17** entries (contract correct, comment stale).
- `src/main/automation/mcp-server.js:328` — **OK, drift CONFIRMED.** JSDoc reads "the 24 tools wired"; live
  = 27.
- `docs/mcp-automation.md:19`-`:21`/`:326`/`:346` + `CLAUDE.md:194` — **OK, NO drift.** Already read "27
  tools — 17 drive" and describe the pressKey name-or-key requirement as prose (post-#56). PART B's doc-sweep
  is confirm-only.
- Apparatus / precedent citations — **OK.** `tests/behavior/downloads-surface.md` is `active` (`:5`) with the
  scripted-smoke run log at `tests/behavior/downloads-surface/runs/2026-06-20-10-02-09.md`;
  `page-context-menu.md` (12 steps, `draft`) and `spellcheck.md` (6 steps, `draft`) confirmed `draft`;
  `package.json:14`/`:16`/`:18` script names (`test`/`lint`/`a11y`) confirmed; downloads fixture present at
  `tests/behavior/fixtures/downloads/`.
