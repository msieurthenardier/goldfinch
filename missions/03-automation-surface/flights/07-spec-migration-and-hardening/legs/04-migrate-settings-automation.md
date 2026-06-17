# Leg: migrate-settings-automation

**Status**: completed
**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](../flight.md)

## Objective
Migrate `settings-automation`'s **read/drive apparatus** from CDP-`:9222`/`cdp-driver.mjs` onto the admin MCP surface — a **dual-target** spec (the chrome `#automation-indicator` via `getChromeTarget`; the `goldfinch://settings` Automation section via admin `allowInternal` `enumerateTabs`→guest `wcId`) — while keeping the **staged MCP session under test unchanged**, and explicitly accounting for the **reflexivity** of dogfooding (the harness's own admin driving session now appears in the indicator/viewer it observes).

## Context
- **DD1 + Architect Technical-Approach §3** (flight): dual target. Chrome `#automation-indicator`/badge/title → `getChromeTarget`+`readDom`/`readAxTree`; the settings-guest viewer (`#automation` section, `#automation-active-sessions`, `#automation-activity-log`) → the F6 `settings-shell` pattern (admin engine `allowInternal:true` `enumerateTabs` → the internal-guest `wcId` → `readDom`/`readAxTree`). **NOT `getChromeTarget` for the settings content** (that's chrome-only).
- **The staged MCP session under test is unchanged**: Steps 11–13 still stage a real jar (and admin) session via a loopback `initialize` POST to `/mcp` with a Bearer — that session is the *system under test*, not the driving apparatus. Keep it as-is (Bash/curl or the example client).
- **Two load-bearing apparatus subtleties (verified against code):**
  1. **Property-vs-attribute** — `readDom` returns `outerHTML` (serialized **attributes**), which does NOT reflect a control's live **property** after interaction (a clicked checkbox's `.checked`, an input's `.value`). Read post-interaction form-control state from **`readAxTree(wcId)`** instead — the AX node carries `checked`/`value` state (raw `Accessibility.getFullAXTree`, `observe.js:248-266`). Use `readDom` for text content, `hidden`/`disabled` attributes, `title`/`aria-label`, and element presence.
  2. **Harness-session reflexivity** — the harness drives via its **own admin MCP session** (required for `getChromeTarget` + `allowInternal` `enumerateTabs`, both admin-only). That session is a live automation session: `audit-log.js:activeSessions()` returns it as a `{ kind:'admin', identity:'admin', … }` row, and `renderer.js:1592` counts it in the indicator label. The old CDP harness contributed **no** MCP session; the MCP harness contributes **one persistent admin session**. So every indicator/viewer count/list assertion (Steps 11–13) is **relative to a baseline that includes the harness's own admin session**.
- This leg is **spec-authoring only** (markdown). Live runs are leg 8. Pure edits; no source.
- Eval-free: every read is a DOM text/attribute (`readDom`), a form-control AX state (`readAxTree`), a store file (filesystem), or an HTTP response (the staging POST). No script-runtime value read.

## Inputs
- `tests/behavior/settings-automation.md` (status `active`, Last Run 2026-06-15 pass 12/13) — Preconditions currently `dev:debug`/`:9222`/`cdp-driver.mjs`; reads the `#automation` section in the `goldfinch://settings` guest + the chrome `#automation-indicator`; stages live MCP sessions (Steps 11–13). Steps:
  - **2–10** (UI controls: toggle, address/port, copy, find-port, per-jar + admin keys, show-once reveal, admin-block env-gate) — guest-DOM drive + read + store-file read. **Migrate cleanly.**
  - **11–13** (live-session indicator/viewer: jar session, admin session, session close/lifecycle) — dual-target read + the **reflexivity** accounting.
- **Proven apparatus** (F6 + legs 2–3): `npm run dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT={port}`; admin MCP client on `127.0.0.1:{port}/mcp`. Note: the harness's admin client IS the driving apparatus AND counts as a session under observation (see reflexivity).
- The F6 `settings-shell` migrated spec (the internal-guest-via-`allowInternal` reference).

## The apparatus mapping (CDP-`:9222` → admin MCP surface)
| Old (CDP/`:9222`) | New (admin MCP surface) |
|---|---|
| `npm run dev:debug` + `cdp-driver.mjs` | `npm run dev:automation` + dev-mint/admin env + `GOLDFINCH_MCP_PORT={port}` |
| probe `cdp-driver eval '1+1'` + renderer present | `tools/list` (17) + `getChromeTarget()` → chrome `wcId` |
| attach the chrome renderer (`#automation-indicator`) | `getChromeTarget()` → chrome `wcId`; `readDom`/`readAxTree`/`captureWindow` |
| attach the `goldfinch://settings` guest | admin `enumerateTabs()` (`allowInternal`) → the internal-guest `wcId`; `readDom`/`readAxTree`/`click`/`typeText`/`pressKey` |
| read `el.checked` / `el.value` (live property) | **`readAxTree(wcId)`** — AX `checked`/`value` state (NOT `readDom` outerHTML, which serializes attributes not live properties) |
| read text / `hidden` / `disabled` / `title` / `aria-label` | `readDom(wcId)` (attributes + text) and/or `readAxTree` (accessible name / state) |
| click a toggle/button | `click(wcId, x, y)` — coordinate, located via `captureWindow` |
| type into a field | `typeText(wcId, text)` (focus-anchor `click` first) |
| read clipboard (Step 5) | read the transient `#automation-message` ("Copied") via `readDom` (clipboard isn't an MCP observable; the DOM message is the witness the spec already offers) |
| store reads (`settings.json`) | filesystem read (Read/Bash) — unchanged |
| stage a live session (loopback `initialize` POST) | **unchanged** — this is the session under test, not the apparatus |
| `chrome-devtools` MCP disqualified | **still disqualified** — keep the warning |

## Outputs
- Steps 2–10 rewritten to the admin MCP surface: guest control state via `readAxTree` (checked/value) + `readDom` (text/hidden/disabled/title); drive via `click`/`typeText`/`pressKey`; store reads via filesystem; Step 5 reads `#automation-message` not the clipboard.
- Steps 11–13 rewritten with **explicit harness-baseline accounting**: the indicator/viewer always include the harness's own admin session; count/list assertions are expressed as "**the staged session(s) PLUS the harness admin session**" and the staged session is identified by its kind/jar/since (the harness row is `kind:'admin'`). The harness identifies + excludes its own row when asserting the staged session's properties.
- **Reflexivity observability limit recorded**: the **absolute "zero automation sessions / indicator hidden"** state (Step 11's empty-state note; Step 13 proper-termination "returns to No automation sessions" + "indicator hides") **cannot be observed via the MCP surface** — the harness is always ≥1 admin session. The spec marks these sub-assertions as **HAT-verified (leg 9) or confound-checked** (observable only with the MCP harness disconnected — e.g. a `captureWindow` is itself a session, so a true-zero read needs a non-MCP observer). Recorded; the *behavior* (a session appears/named/distinguished/removed-on-DELETE) is still verified against the baseline.
- The Preconditions/Observables/Step-1 probe migrated to the MCP surface; `chrome-devtools`-disqualified warning kept; `**Last Run**` left as-is; status stays `active`; the focus-anchor + coordinate-click notes added.
- Other specs' `:9222` untouched.

## Acceptance Criteria
- [x] **AC1 (apparatus rewritten)** — Preconditions + Observables + Step-1 probe reference the admin MCP surface (`dev:automation`, admin Bearer, `getChromeTarget`, `allowInternal` `enumerateTabs`, the drive/observe tools) instead of `dev:debug`/`:9222`/`cdp-driver.mjs`. The `chrome-devtools`-disqualified warning is preserved.
- [x] **AC2 (dual-target correct)** — The chrome `#automation-indicator`/badge/title reads go via `getChromeTarget`→chrome `wcId`; the `goldfinch://settings` Automation-section reads/drives go via admin `allowInternal` `enumerateTabs`→internal-guest `wcId` (NOT `getChromeTarget`). Both targets kept straight per step.
- [x] **AC3 (property-vs-attribute — store-read authoritative, AX degradable)** — Post-interaction control state is NOT read from `readDom` outerHTML (which serializes attributes, not live properties). The **authoritative witness is the filesystem store read** (`automationEnabled`/`automationPort`/key-hashes in `userData/settings.json` — Steps 3/6/7 already assert these), reusing Step 8's proven "assert the *stored* value, not the live checkbox" framing. `readAxTree` checked/value is a **degradable UI-reflection check** (the spec marks it `partial` if the AX node lacks the property — `observe.js:228-231` flags AX-on-guest as LIVE-UNKNOWN, and AX `checked` is a **string** `"true"`/`"false"`, not a boolean — with re-render+`readDom` as the documented fallback). Text/`hidden`/`disabled`/`title`/`aria-label` use `readDom` (attribute-serialized) / `readAxTree` (accessible name) appropriately. No step's pass/fail spine depends on `outerHTML` reflecting a mutated live property OR on an unproven AX checked/value shape.
- [x] **AC4 (semantics preserved, Steps 2–10)** — Every UI-control step's Action/Expected intent is unchanged; only apparatus framing + mechanism words change. Step 5 reads `#automation-message` as the copy witness. No checkpoint added or dropped.
- [x] **AC5 (reflexivity accounted — session list AND action log, Steps 11–13)** — Indicator/viewer count/list assertions are expressed relative to the **harness's own admin session baseline** (staged session(s) + 1 harness admin, identity `admin` / name `app / chrome`). The staged jar/admin session is identified distinctly from the harness admin row (snapshot the staged session's `sessionId`/`since`/jarId to disambiguate — both could be `kind:'admin'` when a staged admin session is added in Step 12). **The action log is polluted too**: the harness's own `readDom`/`readAxTree`/`getChromeTarget`/`enumerateTabs` calls are recorded (`mcp-server.js:299-323`) under identity `admin`, newest-first — so Step 11's log assertion identifies the staged session's entries **by the staged identity (jarId)**, NOT by "newest-first" (the newest rows are the harness's own reads). Step 12's indicator `title`/`aria-label` name-list (`renderer.js:1588-1592`) always includes the harness `admin` name — assert accordingly. The migration does NOT assert a clean zero-session state via the MCP surface.
- [x] **AC6 (observability limit recorded + HAT dependency)** — The absolute "zero sessions / indicator hidden" sub-assertions (Step 11 empty-state; Step 13 proper-termination hide) are explicitly marked **not observable via the MCP surface** (every read is itself an admin session) and routed to **leg-9 HAT** — which must witness the indicator hiding when the last *real* session closes **with the MCP harness disconnected** (a human/dev-tools observer, not an MCP client). The dogfooding-reflexivity reason is inline in the spec; the leg-9 HAT dependency is recorded in the flight log. Not silently dropped. (SC10's "visible automation indicator" stays covered: the *present/named/distinguished/removed-on-DELETE* behavior is verified over the MCP surface against the baseline; only the *hidden-at-true-zero* frame moves to the HAT.)
- [x] **AC7 (no stray old-apparatus refs)** — `grep -n "9222\|cdp-driver\|dev:debug\|remote-debugging" tests/behavior/settings-automation.md` returns nothing (the staging POST names `/mcp` + `{port}`, not `:9222`).
- [x] **AC8** — `npm test`/typecheck/lint unaffected (spec doc; expect green).

## Verification Steps
- AC1–AC6: read the rewritten spec; confirm dual-target routing, the readAxTree-for-live-state rule, the harness-baseline accounting, and the recorded observability limit.
- AC7: `grep -n "9222\|cdp-driver\|dev:debug\|remote-debugging" tests/behavior/settings-automation.md` — empty.
- AC8: `npm test && npm run typecheck && npm run lint`.
- **Live confirmation is leg 8** (+ the indicator hidden-at-zero sub-checks via the leg-9 HAT).

## Implementation Guidance
1. **Preconditions/Observables/Step-1** → the F6 `settings-shell` + leg-2/3 MCP-surface framing. Step-1 probe: `getChromeTarget` returns a numeric chrome `wcId`; `enumerateTabs` (admin, `allowInternal`) will include the `goldfinch://settings` guest once opened.
2. **Steps 2–10 (UI controls)**: open Settings; `enumerateTabs`→ settings-guest `wcId`. Drive toggles/buttons via `click` (coordinate via `captureWindow`); type into fields via `typeText` (focus-anchor first). **The authoritative post-interaction witness is the filesystem store read** (`automationEnabled`, `automationPort`, key hashes in `userData/settings.json`) — Steps 3/6/7 already assert these; reuse Step 8's "assert the *stored* value, not the live checkbox" framing across them. `readAxTree` checked/value is a **secondary UI-reflection check, degradable to `partial`** if the AX node lacks the property (AX `checked` is the string `"true"`/`"false"`; if absent, fall back to a re-render + `readDom`). Read text/`hidden`/`disabled`/`title` via `readDom` (attribute-serialized — Step 9 `#automation-admin.hidden` and Step 8 Revoke `disabled` are correctly `readDom` reads). Step 5: read `#automation-message` ("Copied"), not the clipboard. Step 8/10 key reveals: `readDom` the `#automation-key-reveal`/`#automation-key-value`/`#automation-admin-status`.
3. **Steps 11–13 (live session + reflexivity)**:
   - Stage the jar (Step 11) / admin (Step 12) session via the loopback `initialize` POST (unchanged).
   - Read the chrome `#automation-indicator`/`#automation-indicator-badge`/`title`/`aria-label` via `getChromeTarget`+`readDom`/`readAxTree`; read `#automation-active-sessions`/`#automation-activity-log` via the settings-guest `wcId`+`readDom`.
   - **Account for the harness session (list + log + name-list)**: the indicator badge count = staged + 1 (harness admin, identity `admin` / name `app / chrome`); `#automation-active-sessions` lists the harness admin row PLUS the staged row; the indicator `title`/`aria-label` name-list (`renderer.js:1588-1592`) always includes the harness `admin` name. Snapshot the staged session's `sessionId`/`since`/jarId to disambiguate its row (both rows are `kind:'admin'` once a staged admin session is added in Step 12). Assert the **staged** session's properties (jar named, "since" present) on its own row, identified by the staged identity.
   - **Action-log assertion by identity, NOT newest-first**: the harness's own `readDom`/`readAxTree`/`getChromeTarget`/`enumerateTabs` calls are recorded (`mcp-server.js:299-323`) under identity `admin`, so they are the **newest** log rows. Assert the staged session's `initialize`/tool entries appear **identified by the staged jarId**, not as "the newest entry" (which will be a harness read). Note in the spec that harness reads land under `app / chrome` / `admin` so a runner recognizes the noise.
   - Step 12: the `.admin` class is already present from the harness — assert the *staged admin row* is added/labeled `admin`, distinct from the jar row, rather than "the indicator gains `.admin`" (it already has it).
   - **Step 13 + Step 11 empty-state**: mark the absolute "No automation sessions / indicator hidden" outcome as **not MCP-observable** (the harness is a session) → verify via the **leg-9 HAT** (human watches the indicator hide when the last real session closes and the harness is the dev-tools, not an MCP client) or a non-MCP confound. Assert instead, over the MCP surface, that **the staged session is removed from the list on DELETE** (the list returns to the harness-only baseline) — which IS observable and is the real behavior under test. Keep the proper-vs-ungraceful termination distinction (DD6) as a note.
4. **Do NOT** touch `Last Run`, `## Out of Scope`, or other specs' `:9222`. Keep the staging POST exactly as written (system under test).

## Edge Cases
- **Reflexivity is the crux**: do not let any Step 11–13 assertion read as "the indicator shows exactly the staged session" — it shows the staged session PLUS the harness's own admin session. Either subtract the harness row explicitly or assert per-row. A naive count assertion will false-fail by one.
- **readAxTree for live state**: a clicked checkbox's `outerHTML` may still lack the `checked` attribute (property ≠ attribute) — always read checked/value from `readAxTree`. Confirm at implementation that goldfinch's `readAxTree` AX nodes carry `checked`/`value` (raw `getFullAXTree`); if a specific control's state is absent from the AX node, fall back to a re-render + `readDom` or flag that sub-read.
- **hidden-at-zero is genuinely unobservable via MCP**: don't invent a way to read "zero sessions" over the surface (every read is a session). Route it to the HAT. This is a real dogfooding limit, not a spec defect — record it as such.
- **Single-instance vs second-instance**: the spec's Precondition note that `dev:debug` enables CDP but not the MCP gate is now moot — the surface IS the apparatus. Re-frame: one `dev:automation` instance serves both the harness's driving session and the staged session(s). Record which.
- **Admin-only**: the harness needs the admin key (chrome + internal-guest access) — which is also why it shows as an admin session.

## Files Affected
- `tests/behavior/settings-automation.md` — apparatus → admin MCP surface (dual-target; readAxTree-for-live-state; harness-baseline accounting; hidden-at-zero → HAT).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] `grep` over the spec shows no `9222`/`cdp-driver`/`dev:debug`/`remote-debugging`
- [x] `npm test`/typecheck/lint green (sanity)
- [x] Update flight-log.md with leg progress entry (incl. the reflexivity observability limit + the hidden-at-zero → HAT routing)
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md (at flight commit)
- [x] Batched flight — do NOT commit per-leg (committed with the Phase-2d review block)

## Citation Audit
To verify at design-review time (2026-06-16): dual-target = flight Technical-Approach §3 + F6 `settings-shell`; `readAxTree` raw-AX-node shape (`observe.js:248-266`, `Accessibility.getFullAXTree`); session registry exposing the harness admin session (`audit-log.js:activeSessions` `:80`, `:52`; `renderer.js:1592` count label, `:1572-1573` `.admin` class). Spec current apparatus + the staged-session staging confirmed (`settings-automation.md` Preconditions/Steps 11–13). The design-review Developer must scrutinize (a) the readAxTree-for-checked/value claim against actual AX-node output, and (b) the reflexivity accounting + the hidden-at-zero observability-limit disposition (is HAT-routing the right call, or should a sub-assertion stay on a non-MCP observer?).
