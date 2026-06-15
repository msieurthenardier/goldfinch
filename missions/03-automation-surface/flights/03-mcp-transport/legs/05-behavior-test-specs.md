# Leg: behavior-test-specs

**Status**: completed
**Flight**: [MCP-Compatible Local Server + Transport](../flight.md)

## Objective

Author the Witnessed behavior-test specs the surface now makes possible (DD9): the flight's own acceptance — `mcp-drive-end-to-end` (SC6) and `mcp-loopback-origin-guard` (SC7), authored **`active`** and **run this flight** (Leg 6) — plus the four carried-forward Flight-6 drafts (`foreground-to-act`, `internal-session-exclusion`, `observe-refusal-contract`, `devtools-cdp-conflict`), authored **`draft`** and marked **run-at-Flight-6**. Authoring only — no spec is run in this leg.

## Context

- **Flight DD9** — the MCP client over the loopback transport is the behavior-test apparatus the mission has been deferring against ("once the transport exists"). This leg **authors** specs against that apparatus; it does not run them. Per the Flight-2 debrief operator decision (2026-06-13, "draft during Flight-3 planning, don't wait for Flight 6"), the four migration drafts are authored now so the Witnessed-backing debt stops accumulating — but they **run at Flight 6**.
- **Apparatus = the Goldfinch MCP surface itself (dogfooding).** Unlike the existing specs (which attach Playwright / `scripts/cdp-driver.mjs` to the dev CDP port `:9222`), these specs drive via an **MCP client over the loopback Streamable-HTTP transport** at `127.0.0.1:7777`, with the app launched via **`npm run dev:automation`** (`--automation-dev`, **no** `--remote-debugging-port`). The MCP client is the SDK client / `scripts/mcp-example-client.mjs` / a Claude Code MCP session pointed at the `.mcp.json` `goldfinch` entry. The `chrome-devtools` MCP remains **disqualified** (launches its own browser → false pass).
- **The 16 tools + their result semantics** (Legs 1–3) are the vocabulary these specs exercise: drive results are JSON text (`{ok:true}`/boolean/wcId/null); screenshots are **image content**; DOM/a11y are JSON text; the `debugger-unavailable` refusal is a **normal** result; genuine throws are **`isError`**. The specs' Expected Results are written in those observable terms.
- **Rendered-state discipline (AUTHORING.md).** Prefer what a real observer perceives. For these specs that means: a tool's **own returned screenshot / a11y tree / DOM read** is the primary rendered-state observable, and (where feasible) the **visible Goldfinch chrome window** is an independent cross-check so the test is not purely self-referential ("the tool said it worked").
- **Status + header discipline (DD9).** The two `active` specs run in Leg 6. The four `draft` specs must carry a **prominent header note** — "AUTHORED-ONLY — runs at Flight 6; a `/behavior-test` invocation now will partial-run against an interim surface" — plus `Status: draft` and `Last Run: never`, so a stray invocation doesn't produce a confusing partial run.
- **Spec format** is canonical in `.flightops/ARTIFACTS.md` ("Behavior Test — Spec"); follow it and the house style of the existing `tests/behavior/*.md` (e.g. `tab-scheme-guard.md`: active-precondition probe as Step 1, apparatus note, `[mixed-frame]` markers where frames cross, an Out of Scope section).

## Inputs

- The built surface (Legs 1–3): `mcp-server.js` (loopback `127.0.0.1:7777`, Origin/Host guard), `mcp-tools.js` (16 tools), `origin-guard.js`; `npm run dev:automation`; the `.mcp.json` `goldfinch` entry + `scripts/mcp-example-client.mjs` (Leg 4).
- `.flightops/ARTIFACTS.md` — the spec format + the evidence-path convention (evidence at `/tmp/behavior-tests/goldfinch/{slug}/{ts}/`, never committed; specs + run logs committed).
- Existing `tests/behavior/*.md` — house style (esp. `tab-scheme-guard.md`, `core-browsing-shields.md`).
- `.flightops/agent-crews/behavior-tests-execution.md` — the Executor/Validator crew (informational; the run skill orchestrates it at Leg 6 / Flight 6).

## Outputs

Six new spec files under `tests/behavior/`:

1. `tests/behavior/mcp-drive-end-to-end.md` — **`active`** (SC6).
2. `tests/behavior/mcp-loopback-origin-guard.md` — **`active`** (SC7).
3. `tests/behavior/foreground-to-act.md` — **`draft`**, run-at-Flight-6.
4. `tests/behavior/internal-session-exclusion.md` — **`draft`**, run-at-Flight-6.
5. `tests/behavior/observe-refusal-contract.md` — **`draft`**, run-at-Flight-6.
6. `tests/behavior/devtools-cdp-conflict.md` — **`draft`**, run-at-Flight-6 (DD10).

No code changes. No spec is run.

## Acceptance Criteria

- [ ] **Six well-formed specs exist** at the paths above, each matching the ARTIFACTS.md "Behavior Test — Spec" format: `# Behavior Test: {Title}`, `Slug`, `Status`, `Created` (2026-06-13), `Last Run: never`, `## Intent`, `## Preconditions`, `## Observables Required`, `## Steps` (two-column Action | Expected Result table), `## Out of Scope`.
- [ ] **Status correctness.** `mcp-drive-end-to-end` and `mcp-loopback-origin-guard` are `Status: active`. The other four are `Status: draft` **and** carry the prominent AUTHORED-ONLY / run-at-Flight-6 header note (a blockquote near the top), so a stray `/behavior-test {slug}` won't read as a real run.
- [ ] **Apparatus is the MCP surface.** Every spec's Observables/Preconditions name the **MCP client over `127.0.0.1:7777`** launched via `npm run dev:automation` (not the `:9222` CDP path), and note the `chrome-devtools`-MCP disqualification where a reviewer might reach for it.
- [ ] **Active-precondition probe is Step 1** of each runnable spec: connect the MCP client + `tools/list` returns the 16 tools (or, for the origin-guard spec, the server is listening on `127.0.0.1:7777`); halt if not met. (House style — mirrors `tab-scheme-guard.md` Step 1.)
- [ ] **`mcp-drive-end-to-end` (SC6)** drives end to end: discovery (16 tools), `openTab`→wcId, `enumerateTabs`, `navigate`+`readDom` (URL/title confirmed), `captureScreenshot` (image content, page visibly rendered), `readAxTree` (non-empty array on the happy path), trusted input (`click`/`typeText`/`pressKey` with an observable page reaction), and tab management (`activateTab`/`closeTab` reflected in `enumerateTabs`). Where feasible, an independent cross-check via the visible chrome window.
- [ ] **`mcp-loopback-origin-guard` (SC7)** verifies: bind is `127.0.0.1` only (not `0.0.0.0`/`::`); a loopback **no-Origin** request is **not** 403'd; a **non-loopback `Host`** → 403; a **non-loopback `Origin`** (incl. the DNS-rebinding shape `Host: 127.0.0.1` + `Origin: http://attacker.example`) → 403; a loopback `Host` with a mismatched port is **not** 403'd (the deliberate port-agnostic allow); and the guard runs **before** any MCP processing (a 403 means no tool executed). Uses `curl` (shell/http frame) + a bind-address check.
- [ ] **The four drafts are complete and runnable** (draft is a review-status, not a stub): each has a real step table that Flight 6 can execute, covering — `foreground-to-act` (a background guest is brought to front by capture/input; the screenshot shows the foregrounded tab, not blank/the other tab; `enumerateTabs` active flag flips); `internal-session-exclusion` (`enumerateTabs` never lists the `goldfinch://settings` internal guest; a directly-supplied internal-guest `wcId` to any drive/observe tool returns an **`internal-session` `isError`** — never executes; a normal web tab works as control); `observe-refusal-contract` (a contended `readAxTree` returns the `debugger-unavailable` refusal as a **normal** result, `isError` falsy; a bad/internal `wcId` → `isError`; `captureScreenshot` → image content); `devtools-cdp-conflict` (DD10 — app launched **without** `--remote-debugging-port`, open DevTools on a tab, then MCP `readAxTree` on it, and **record** whether it returns the `attach-failed` refusal — a recorded finding, not a hard pass/fail; closing DevTools restores success).
- [ ] **Out of Scope** sections drawn for each (e.g. `mcp-drive-end-to-end` excludes the key-gating/audit — Flight 4 — and element-addressing ergonomics — Flight 9; `mcp-loopback-origin-guard` excludes the key-auth half of SC7 — Flight 4).
- [ ] **Anonymized** (public repo): no operator home paths/usernames in any spec.
- [ ] **No regression**: `npm test`/`typecheck`/`lint` still green (this leg adds only markdown — confirm nothing else changed).

## Verification Steps

- **Format/status**: each file parses as the ARTIFACTS spec shape; `grep -l 'Status: active'` → the two SC specs; `grep -l 'Status: draft'` → the four; each draft has the run-at-Flight-6 header blockquote.
- **Apparatus**: grep the specs for `dev:automation`, `127.0.0.1:7777`, `tools/list` — present; no spec instructs attaching to `:9222` as its primary apparatus.
- **Coverage cross-check**: `mcp-drive-end-to-end` touches all six capability areas (nav, input, tabs, screenshot, DOM, a11y); `mcp-loopback-origin-guard` covers the four guard verdicts + the bind check.
- **Anonymization**: grep for `/home/`, `/Users/`, the operator username — none.
- **Gates**: `npm test`, `npm run typecheck`, `npm run lint` green (markdown-only change).

## Implementation Guidance

1. **Read first**: `.flightops/ARTIFACTS.md` ("Behavior Test — Spec"), `tests/behavior/tab-scheme-guard.md` + `core-browsing-shields.md` (house style), and the actual `mcp-tools.js` tool names/result shapes + `origin-guard.js` policy (write Expected Results from the code, not memory).
2. **Author the two `active` specs** with full step tables (skeletons below). Status `active`, `Created: 2026-06-13`, `Last Run: never`.
3. **Author the four `draft` specs** with full, runnable step tables, Status `draft`, `Last Run: never`, and a prominent header blockquote:
   > **AUTHORED-ONLY (Flight 3 / leg `behavior-test-specs`).** The surface this spec drives is fully built (Flight 3), so it *could* run — but it is **deferred to Flight 6** (behavior-spec migration) by operator sequencing, and is **not part of Flight 3's acceptance**. Authored now so the Witnessed backing exists; **do not** treat a `/behavior-test {slug}` invocation before Flight 6 as a flight-acceptance run.
4. **Skeletons** (elaborate each into the two-column table; one row = one checkpoint; active-precondition probe as Step 1):

   - **`mcp-drive-end-to-end`** — (1) connect MCP client to `127.0.0.1:7777`, `initialize` ok, `tools/list` returns the 16 named tools [halt if not]; (2) `openTab('https://example.com')` → numeric `wcId` (not null); (3) `enumerateTabs` lists the new tab (wcId/url/title); (4) `navigate(wcId,'https://example.com/')` ok → `readDom(wcId)` shows `url` example.com + `title` ~"Example Domain"; (5) `captureScreenshot(wcId)` → image content (`{type:'image', mimeType:'image/png'}`) **and the Validator judges the screenshot PIXELS — the page is visibly rendered, not a blank foreground capture** (the DD1 blank-capture hazard would still return a valid image block, so "an image returned" alone is insufficient); (6) `readAxTree(wcId)` → an AXNode **array** (success shape — `Array.isArray`, **possibly empty** is still success per `observe.js`; assert "array, not the `debugger-unavailable` refusal object, not `isError`" — do **not** assert non-empty, which could false-fail on a sparse page); (7) trusted input against **a served local fixture page** (house style — serve a small fixture on a non-CDP HTTP port) whose DOM/render **visibly echoes** input (e.g. an `<input>` that mirrors typed text into visible page text, or a button that mutates a visible label): `navigate` to it, then `click`/`typeText`/`pressKey`, and confirm the **rendered** echo via `captureScreenshot` (pixels) / `readAxTree` — preferred over a DOM `.value` read (AUTHORING.md rendered-state); (8) tab mgmt — open a 2nd tab, `activateTab`, `enumerateTabs` `active` flag flips, `closeTab` → gone from `enumerateTabs`; (9) [`[mixed-frame]`, independent cross-check] `captureWindow` (the 16th tool — covers the whole-window capture) and/or the visible Goldfinch chrome window reflects the MCP-driven nav/tab state — this is the **non-self-referential** observable that the MCP-driven actions really changed the browser.
   - **`mcp-loopback-origin-guard`** — apparatus note up top: `curl` **replaces** (does not append) the auto-`Host` when given `-H 'Host:'`; each row's Expected Result names **which guard clause** the 403 proves so the Validator confirms the intended branch fired (not just "a 403"). Steps: (1) probe: `ss -tlnp` (or equivalent) shows `127.0.0.1:7777` bound, not `0.0.0.0`/`::` [halt if not]; (2) loopback **no-Origin** request (`curl http://127.0.0.1:7777/mcp`) → status is **not 403** (the guard's no-Origin/loopback-Host **pass** clause — assert "not the guard's 403", NOT "200": a bare GET may draw a non-403 4xx from the MCP layer, which still proves the guard passed); (3) `curl -H 'Host: evil.example' …` → **403** (the **Host-loopback** clause denies — non-loopback Host); (4) `curl -H 'Origin: http://evil.example' …` → **403** (the **Origin-present-non-loopback** clause denies; curl's auto-Host stays loopback, so this isolates the Origin clause); (5) DNS-rebinding shape `curl -H 'Host: 127.0.0.1:7777' -H 'Origin: http://attacker.example' …` → **403** (Origin clause defeats rebinding even with a loopback Host — the load-bearing SC7 control); (6) loopback Host, mismatched port (`-H 'Host: 127.0.0.1:9999'`) → **not 403** (deliberate port-agnostic allow — `bareHost` strips the port); (7) [guard-before-MCP] enumerate tabs via the **legit** MCP client, fire a 403'd request (Step 3/4 shape), then re-`enumerateTabs` → the tab set is **unchanged** (the 403'd request reached no tool — make the "no side effect" observable, not unfalsifiable). **Intent + Out of Scope must state**: the **peer-address** guard clause (a non-loopback peer) is **unit-tested** (`origin-guard.js` / `automation-origin-guard.test.js`) and **bind-check-proxied** by Step 1 here (a second NIC is not assumed); SC7's "non-loopback connection cannot reach it" is thus bind+unit-backed, not end-to-end behavior-tested — say so plainly.
   - **`foreground-to-act`** — (1) probe + `tools/list`; (2) `openTab` A and B (B ends active); (3) `captureScreenshot(A)` → A is foregrounded and the PNG shows A's content (not blank, not B); (4) `enumerateTabs` now shows A active; (5) with B active again, `click`/`typeText(A)` → A foregrounded first, the input lands on A (confirm via `readDom(A)`); background-driving-invisibly is out of scope (v1 foreground-to-act).
   - **`internal-session-exclusion`** — (1) probe + `tools/list`; (2) via the chrome, open Settings (`goldfinch://settings`); (3) `enumerateTabs` → the settings/internal guest is **absent** from the list; (4) obtain the internal guest's `wcId` **out-of-band** (it is deliberately not enumerable — get it via the chrome's own CDP target list / a debug readback in the running app, and the spec must name that apparatus so the step doesn't stall) and call `navigate`/`readDom`/`captureScreenshot`/`readAxTree` on it via MCP → each → **`isError`** with `internal-session` (never executes); (5) control: a normal web tab `wcId` → the same tools succeed. (Proves `resolveContents` holds across the transport.)
   - **`observe-refusal-contract`** — (1) probe + `tools/list`; (2) **primary trigger — open DevTools on the target tab** (deterministically yields `attach-failed`), then `readAxTree(thatWcId)` → a **normal** result whose content is the `debugger-unavailable` refusal (`reason: attach-failed`), `isError` **falsy** (the `locked` reason needs a true concurrent race that sequential tool-calls won't reliably reproduce — list it only as an optional secondary path); (3) a bad/dead/internal `wcId` to `readAxTree` → `isError`; (4) `captureScreenshot` → image content (not JSON-wrapped). (DD6 contract shape.) Out of Scope: cross-reference `devtools-cdp-conflict` (this spec verifies the refusal *contract shape*; that one is the DD10 *recorded finding* — they share the DevTools trigger but differ in intent).
   - **`devtools-cdp-conflict`** (DD10) — (1) confirm the app was launched via `dev:automation` **without** `--remote-debugging-port` (the confound-free venue) + `tools/list`; (2) open a web tab, open Chromium DevTools on **that** tab via the chrome; (3) MCP `readAxTree(thatWcId)` → **RECORD** whether it returns the `attach-failed` refusal or succeeds (a recorded finding, not a hard pass/fail — the underlying Chromium one-client-per-contents behavior is what it is; the Expected Result says "record the outcome", never "must return attach-failed"); (4) close DevTools → `readAxTree` succeeds (lock/attach released). The run log captures the finding for the flight log + mission Open-Question closure. Out of Scope: cross-reference `observe-refusal-contract` (the refusal-shape contract lives there).
5. **Out of Scope + apparatus notes** per spec (see Acceptance Criteria). Add the `chrome-devtools`-MCP disqualification note where relevant.
6. **Do not run any spec.** Authoring only.

## Edge Cases

- **Self-reference** in `mcp-drive-end-to-end`: the tool's own screenshot/DOM is both the action surface and the observable. Mitigate with the optional independent chrome-window cross-check and by chaining observations (navigate → independent `readDom` shows the new URL), and call this out in the spec's apparatus note.
- **`mcp-loopback-origin-guard` no-Origin Step**: a non-403 may still be a 4xx from the MCP layer for a bare GET — the Expected Result must distinguish "**not** the guard's 403" from "a clean MCP response", i.e. assert the status is not 403 (the guard passed), not that it's 200.
- **Non-loopback-peer step**: genuinely reaching the server from a non-loopback address may not be feasible in every dev environment; the spec should make the **bind-address check** (Step 1) the primary runnable proof and cite the unit-tested peer guard, rather than depend on a second NIC.
- **`devtools-cdp-conflict` is a recorded finding, not a binary**: the Expected Result must say "record the outcome", not "must return attach-failed" — DD10 is explicitly a finding.
- **Draft-but-runnable**: `draft` is review-status; the four drafts must still be complete enough to run at Flight 6 — do not leave TODO placeholders in their step tables.

## Files Affected

- `tests/behavior/mcp-drive-end-to-end.md` — new (active).
- `tests/behavior/mcp-loopback-origin-guard.md` — new (active).
- `tests/behavior/foreground-to-act.md` — new (draft).
- `tests/behavior/internal-session-exclusion.md` — new (draft).
- `tests/behavior/observe-refusal-contract.md` — new (draft).
- `tests/behavior/devtools-cdp-conflict.md` — new (draft).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (autonomous leg — do NOT commit; the Flight Director defers review + commit to the end of the flight):**

- [ ] All six specs authored to format; statuses correct (2 active, 4 draft); drafts carry the run-at-Flight-6 header note
- [ ] `npm test` / `typecheck` / `lint` still green (markdown-only change); anonymization grep clean
- [ ] Update flight-log.md with a Leg Progress entry (the six specs + which run when; apparatus = MCP surface)
- [ ] Set this leg's status to `landed` (NOT `completed`)
- [ ] Do NOT run any spec; do NOT commit; do NOT check off the leg in flight.md yet
