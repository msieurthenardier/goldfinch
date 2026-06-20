# Leg: verify-integration

**Status**: completed
**Flight**: [Downloads Surface](../flight.md)

## Objective

Close the flight: create the download fixture, finalize the `downloads-surface` behavior-test spec
(tool-count 27), **verify the SC7/SC8 real-environment observables** against the live automation surface (a
download triggered via `navigate` appears in `downloadsList` as `completed` with an on-disk `savePath`; a
jar key is refused), and **own the docs + count bumps** the build legs deferred — README `Ctrl+J` row,
`docs/mcp-automation.md` (26 → 27 + `downloadsList`), and the **CLAUDE.md kebab prose** (still stale at
"Settings + Exit") — with the whole suite (`node --test`, typecheck, lint, a11y) green.

## Context

- **DD7** — the behavior-test apparatus is the M03 automation surface, audited both axes: **act** =
  `navigate` a guest tab to a download-triggering fixture (silent default-save, DD5, completes with no
  dialog); **observe** = the `downloadsList` admin tool result + a filesystem `stat` of `savePath` (the
  internal page DOM is unreadable by automation). **Key identity** = admin (the only key `downloadsList`
  accepts); a **jar key** call is asserted refused (the SC8 gating half).
- **The behavior-test spec already exists** at `tests/behavior/downloads-surface.md` (status `draft`,
  authored during planning) — this leg finalizes it (tool-count 27, apparatus corrections) and runs it.
- **Final autonomous leg.** After this lands, the flight goes to flight-level review + commit (the
  deferred-commit model), then the optional `hat-and-alignment` leg.
- **Docs ownership**: build legs 1–5 intentionally deferred user-facing docs + the doc tool-count to this
  leg to avoid double-edits. Note legs 2/3/5 **already** updated much of CLAUDE.md (the internal-page list,
  `INTERNAL_ORIGINS`, the downloads bridge, the menu-controller pointer) — this leg finishes the **kebab
  prose** + the **doc tool-count** + README/`docs/mcp-automation.md`.

## Inputs

What exists before this leg runs:
- `tests/behavior/downloads-surface.md` (status `draft`) — the 6-step spec; its Preconditions reference a
  "Content-Disposition: attachment" fixture and a "total tool count 27".
- **Fixtures dir**: `tests/behavior/fixtures/` (has `a11y-media`, `core-browsing-shields`,
  `mcp-drive-end-to-end`, `tab-scheme-guard`) — **no download fixture yet**. The a11y/behavior pattern
  serves fixtures via `python3 -m http.server`.
- **The attach + env-key model** (from `scripts/a11y-audit.mjs` header + `docs/mcp-automation.md`
  "Dogfooding / dev key acquisition"): launch `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1
  npm run dev:automation` → it prints `AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey>"}`. Use
  the `adminKey` for `downloadsList` and the `jarKey` for the refusal assertion. (The MCP port may
  free-fallback off 49707 — capture the printed/bound port.)
- **Doc surfaces to bump:**
  - `README.md` ~`:170`-`:189` — the "Keyboard shortcuts" table (`Ctrl+T`…`Ctrl+Shift+I`); **no `Ctrl+J`
    row** (grep the table). (Optionally a Downloads feature bullet near the panels prose.)
  - `docs/mcp-automation.md:19`-`:20` ("**26 tools** — 17 drive, 4 observe, 2 eval, 2 devtools, 1 admin
    chrome-discovery"), `:311`-`:326` (the admin/`getChromeTarget` section + "All 26 tools below"),
    `:324`. Needs 26 → 27 + a `downloadsList` entry (admin, app-level, no-input, returns the records).
  - `CLAUDE.md:22` — the kebab prose still reads "(Settings + Exit; **Settings** opens …" — **stale**:
    the kebab now has **Settings, Downloads, Print…, Exit**, and `Ctrl+J` opens downloads. (The
    internal-page list, `INTERNAL_ORIGINS`, the downloads bridge, and the menu-controller pointer are
    already updated by legs 2/3/5 — verify and don't duplicate.)
- **Landed deliverables to verify against**: `downloadsList` MCP tool (admin-only, leg 4); the
  `goldfinch://downloads` page (leg 2); the kebab/`Ctrl+J` entry (leg 3); the silent default-save +
  app-level model (leg 1).

## Outputs

What exists after this leg completes:
- `tests/behavior/fixtures/downloads/download-fixture.bin` (new) — a small binary the browser downloads.
- `tests/behavior/downloads-surface.md` — finalized (tool-count 27, apparatus/fixture corrections);
  status → `active` once the run passes.
- `tests/behavior/downloads-surface/runs/{ts}.md` (new) — the run log (if the formal `/behavior-test` run
  is performed) **or** a recorded scripted-integration-smoke result with the SC7/SC8 evidence.
- `README.md` — `Ctrl+J` shortcut row (+ optional Downloads feature bullet).
- `docs/mcp-automation.md` — 26 → 27, `downloadsList` documented.
- `CLAUDE.md` — kebab prose updated (Settings, Downloads, Print…, Exit; `Ctrl+J`).
- Whole-suite-green confirmation (unit/typecheck/lint/a11y).

## Acceptance Criteria

- [ ] **Fixture**: `tests/behavior/fixtures/downloads/download-fixture.bin` exists (small, e.g. a few KB);
  served via `python3 -m http.server` it downloads (a `.bin` is sent as `application/octet-stream`, which
  Chromium downloads rather than renders — Content-Disposition not strictly required; if octet-stream does
  not trigger a download in the run env, fall back to a tiny server that sets `Content-Disposition:
  attachment` and note it in the spec).
- [ ] **SC7/SC8 real-environment verification** (the behavior-test observables, via the live automation
  surface with the admin key):
  1. `downloadsList` (admin) returns an array (baseline count N).
  2. Open a guest tab and `navigate` it to the fixture URL; the download completes **silently** (no
     dialog, DD5) to the OS Downloads folder.
  3. `downloadsList` (admin) now has N+1 records; the new record has the fixture `filename` (sanitized),
     `state: 'completed'`, a non-empty `savePath`, `received === total > 0`.
  4. `stat` the `savePath` → the file exists on disk with non-zero size.
  5. `downloadsList` with a **jar key** → **refused** with the distinct admin-only error.
  This is performed either by `/behavior-test downloads-surface` (the Witnessed run, Flight-Director-driven)
  **or** an equivalent scripted live integration smoke, with the evidence recorded.
- [ ] **Behavior-test spec finalized**: `tests/behavior/downloads-surface.md` reflects the as-built
  apparatus (tool count **27**; the `.bin`/octet-stream fixture as primary + Content-Disposition fallback,
  reconciling the current Preconditions/Steps that mandate Content-Disposition). Status → `active` if a
  **live** run passed (Witnessed or scripted smoke); stays `draft` if only the WSLg seeded-store fallback
  was used (live-trigger deferred to macOS), with the disposition recorded.
- [ ] **Docs — README**: a `| `Ctrl+J` | Open downloads |` row in the Keyboard shortcuts table.
- [ ] **Docs — `docs/mcp-automation.md`**: tool count **26 → 27** (`:19`-`:20` breakdown + `:324` "All 27
  tools"); a `downloadsList` entry documented as **admin-only, app-level, no-input**, returning the
  downloads records (jar keys get `automation: admin-only`, mirroring `getChromeTarget`).
- [ ] **Docs — CLAUDE.md kebab prose** (`~:23`, grep "Settings + Exit"): updated to "Settings, Downloads, Print…, Exit" with the
  Downloads item opening `goldfinch://downloads` (trusted tab) and `Ctrl+J` as its shortcut. Verify the
  internal-page list / `INTERNAL_ORIGINS` / downloads-bridge / menu-controller notes are already present
  (legs 2/3/5) and **not** duplicated.
- [ ] **Whole suite green**: `node --test test/unit/*.test.js`, `npm run typecheck`, `npm run lint` all
  pass; `npm run a11y` reports 0 new violations (the full chrome sweep, now incl. the kebab Downloads
  item — this also covers the leg-3 a11y re-run that its agent couldn't perform).

## Verification Steps

- `node --test test/unit/*.test.js` && `npm run typecheck` && `npm run lint` — all clean.
- `npm run a11y` — 0 new violations (chrome sweep; confirms the leg-3 kebab item too).
- The SC7/SC8 sequence above, run live (record the `downloadsList` payloads + the `stat` output as
  evidence; evidence goes to the ephemeral `/tmp/behavior-tests/goldfinch/downloads-surface/{ts}/` path,
  never committed — per ARTIFACTS.md).
- `grep -n "Ctrl+J" README.md` — the shortcut row exists.
- `grep -n "27 tools\|downloadsList" docs/mcp-automation.md` — count bumped + tool documented.
- `grep -n "Downloads" CLAUDE.md` — kebab prose mentions the Downloads item.

## Implementation Guidance

1. **Fixture.** Create `tests/behavior/fixtures/downloads/download-fixture.bin` — a small deterministic
   binary (e.g. a few KB of fixed bytes). Document in the spec that `python3 -m http.server` rooted at
   `tests/behavior/fixtures/` serves it at `http://127.0.0.1:8000/downloads/download-fixture.bin` as
   `application/octet-stream`, which Chromium downloads.
2. **Run the verification (Flight-Director or scripted).** The Flight Director may run
   `/behavior-test downloads-surface` (the Witnessed Executor+Validator run). If that live multi-agent run
   isn't performed in-session, execute the equivalent **scripted live integration smoke**:
   - Launch `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`
     (background); capture the printed `adminKey`/`jarKey` + the bound MCP port.
   - Start `python3 -m http.server 8000` in `tests/behavior/fixtures/` (background).
   - Over the MCP loopback surface (admin key): `enumerateTabs`/`openTab`, then `navigate` the guest to the
     fixture URL; wait for the download to settle.
   - Call `downloadsList` (admin) → assert the new `completed` record (filename, savePath, received===total).
   - `stat` the `savePath` on disk → exists, non-zero.
   - Call `downloadsList` with the **jar key** → assert the `automation: admin-only` refusal.
   - Record the payloads + stat as evidence; write the run log (or record the smoke result in the flight
     log + the spec).
   - Tear down both background processes.
3. **Finalize the spec.** Update `tests/behavior/downloads-surface.md`:
   - **Reconcile the fixture preconditions** — the spec's Preconditions (~`:30`) and Steps row 2 (~`:49`)
     currently mandate `Content-Disposition: attachment`. Rewrite them so the **primary** mechanism is the
     `.bin`/`application/octet-stream` served by `python3 -m http.server` (Chromium downloads octet-stream),
     with `Content-Disposition: attachment` (via a tiny custom server) as the documented **fallback**.
   - Confirm "total tool count **27**".
   - **Status semantics**: a **passing live run — Witnessed `/behavior-test` OR the scripted integration
     smoke — sets status `active`** (both exercise the real SC7/SC8 observables incl. the DD5 silent save).
     If only the **WSLg seeded-store fallback** was used (live trigger NOT fired), the spec **stays
     `draft`** with the live-trigger deferred-to-macOS disposition recorded (the silent-save observable
     wasn't exercised).
4. **README.** Add `| `Ctrl+J`        | Open downloads      |` to the shortcuts table (`:170`-onwards),
   placed near the other app-level shortcuts. (Optional: a short Downloads bullet in the features prose.)
5. **`docs/mcp-automation.md`.** Bump `:19`-`:20` to **27 tools** and adjust the breakdown (the admin
   chrome/app-level tools are now **2**: `getChromeTarget` + `downloadsList`). Update `:324` "All 27 tools".
   Add a `downloadsList` entry (in/near the admin section `:311`-`:326`): admin-only, app-level (no `wcId`),
   `inputSchema {}`, returns the app-level downloads records `{ id, url, filename, savePath, state,
   received, total, … }`; jar keys get `automation: admin-only` (mirrors `getChromeTarget`).
6. **CLAUDE.md kebab prose (`:22`).** Replace "(Settings + Exit; …" with the current kebab contents:
   **Settings, Downloads, Print…, Exit**. Describe the Downloads item: opens `goldfinch://downloads` (the
   app-level downloads surface) via the trusted `createTab` path; reachable via `Ctrl+J` too. Keep the
   existing Settings/Exit descriptions. Do **not** re-touch the internal-page allowlist / `INTERNAL_ORIGINS`
   / bridge / menu-controller notes (already done by legs 2/3/5) — just verify they're coherent.

## Edge Cases

- **octet-stream doesn't trigger a download** in the run env: fall back to a tiny Node/Python server that
  sets `Content-Disposition: attachment` (the spec's original premise); record which mechanism was used.
- **WSLg live-trigger flakiness** (flight Adaptation Criteria): if the download won't fire/complete under
  WSLg, fall back to **seeding the persisted store** and asserting `downloadsList` reflects it, deferring
  the live-trigger assertion to macOS — record the disposition in the flight log + spec. (Leg 1 confirmed
  the downloads dir is writable, so a live trigger is expected to work.)
- **MCP port not 49707**: capture the actual bound port from the launch line; don't hardcode.
- **a11y can't launch** (leg-3's agent hit this; leg-2/5 agents launched fine): retry; if genuinely
  unavailable, record it and flag the a11y sweep for the HAT/operator — do not silently skip.
- **Jewel of the gate**: the jar-key refusal must be the **distinct admin-only** error, not a generic 401
  or "not a function" — confirm the message text.

## Files Affected

- `tests/behavior/fixtures/downloads/download-fixture.bin` — **new**.
- `tests/behavior/downloads-surface.md` — finalized (count 27, fixture mechanism, status).
- `tests/behavior/downloads-surface/runs/{ts}.md` — **new** run log (if `/behavior-test` run) or evidence
  recorded in the flight log.
- `README.md` — `Ctrl+J` shortcut row.
- `docs/mcp-automation.md` — 26 → 27 + `downloadsList`.
- `CLAUDE.md` — kebab prose.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`node --test test/unit/*.test.js`, `npm run typecheck`, `npm run lint`); `npm run a11y`
  0 new violations
- [ ] SC7/SC8 real-environment verification performed + evidence recorded
- [ ] Update flight-log.md with leg progress entry (+ the verification result/disposition)
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] This is the **final autonomous leg** → flight goes to flight-level review + commit (Flight Director),
  NOT committed by this leg
- [ ] Commit deferred per `/agentic-workflow`

---

## Citation Audit

All citations verified clean against current code at leg design time (read directly this session):
`README.md:168`-`:184` (Keyboard shortcuts table, no `Ctrl+J`); `docs/mcp-automation.md:19`-`:20` ("26
tools" breakdown), `:311`-`:326` (admin/`getChromeTarget` section), `:324` ("All 26 tools"); `CLAUDE.md:22`
(stale "Settings + Exit" kebab prose), with `:80`/`:82`/`:140`-`:154` (internal-page allowlist /
`INTERNAL_ORIGINS` / channel list) **already updated** by legs 2/3/5 (verify, don't duplicate);
`tests/behavior/downloads-surface.md` (draft spec); `tests/behavior/fixtures/` (no download fixture yet);
the attach+env-key launch model (`scripts/a11y-audit.mjs` header, `docs/mcp-automation.md` dogfooding
section). Landed deliverables (leg 1 silent save / leg 2 page / leg 3 entry / leg 4 `downloadsList`) are
the verification targets.
