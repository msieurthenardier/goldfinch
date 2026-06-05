# Leg: verify-tab-scheme-guard

**Status**: completed
**Flight**: [Quality & Hygiene Floor](../flight.md)

## Objective
Prove Flight 1's F1 enforcement in the *running app*: build the HTTP trigger fixture the `tab-scheme-guard` behavior spec needs, run `/behavior-test tab-scheme-guard`, and on a green run promote the spec `draft → active`.

## Context
- Flight 1 deferred this (no live app during that flight). The unit tests prove `isSafeTabUrl` in isolation; only the behavior test proves the predicate is actually wired into a live `<webview>` (the `createTab` gate + the main `will-navigate` guard).
- Spec: `tests/behavior/tab-scheme-guard.md` (status `draft`). It needs an HTTP-served trigger page (the spec's Preconditions): buttons/handlers for `window.open('file:///etc/passwd')`, `window.open('javascript:…')`, `window.open('data:text/html,…')`, an in-page `window.location='file:///etc/passwd'`, a crafted `file:` media element, and a control `window.open('https://example.com')`.
- **Apparatus (from flight DD, two-target)**: chrome-devtools MCP attached to `npm run dev:debug` (:9222). Act on the `<webview>` **guest** target (`select_page`), Observe on the **renderer** target (webview `src` + address bar). Run skill orchestrates Executor + Validator.

## Inputs
- `tests/behavior/tab-scheme-guard.md` (the draft spec).
- The running app (`npm run dev:debug`).

## Outputs
- `tests/behavior/fixtures/tab-scheme-guard/index.html` (new) — the trigger page (static HTML+JS; eslint/prettier-ignored).
- (optional) a one-line note/script for serving it (e.g. `python3 -m http.server` in that dir) — documented in the spec Preconditions if not already precise.
- `tests/behavior/tab-scheme-guard/runs/{ts}.md` (written by the run skill) — the run log.
- `tests/behavior/tab-scheme-guard.md` — `Status: draft → active` and `Last Run` updated, **only on a green run**.

## Acceptance Criteria
- [ ] The trigger fixture exists and, served over HTTP, exposes: a `file:` `window.open` trigger, a `javascript:` `window.open`, a `data:` `window.open`, an in-page `window.location='file://…'` trigger, a crafted `file:` media element for the media-open vector, and an `https://example.com` control. Each is operable by a clear DOM affordance (button id/text) the Executor can find.
- [ ] `/behavior-test tab-scheme-guard` runs against the live app and **passes** (all step verdicts pass): the hostile schemes never load into a webview (webview `src`/address bar never `file:`/`data:`/`javascript:`; no local file content renders), while the `https` control DOES open. The run log is written under `tests/behavior/tab-scheme-guard/runs/`.
- [ ] On green, the spec is promoted `draft → active` with `Last Run` set.
- [ ] **Fallback (flight DD)**: if the GUI app cannot launch or CDP cannot attach in this environment, deliver the fixture + the serving note, leave the spec `draft`, and record the deferral explicitly in the flight log (NOT a silent skip). The leg still lands (fixture delivered); the run becomes a follow-up.

## Verification Steps
- Probe first: `npm run dev:debug` launches; `curl -s http://127.0.0.1:9222/json/version` responds; the fixture serves HTTP 200.
- Run `/behavior-test tab-scheme-guard`; read the run log verdicts.
- Confirm spec status flipped to `active` (only if green).

## Implementation Guidance
1. **Fixture** (Developer task): build `tests/behavior/fixtures/tab-scheme-guard/index.html` — a minimal page with labeled buttons that call the six triggers (each `window.open(...)` / `window.location=...` on click), and a crafted media element (e.g. `<video>`/an anchor) whose source is `file:///etc/passwd` for the media-open vector. Keep affordances clearly identifiable (stable ids/text). It's under the eslint/prettier-ignored fixtures path.
2. **Probe** (Flight Director): confirm the app launches via `dev:debug` and :9222 answers; confirm the fixture serves (note the chosen port).
3. **Run** (Flight Director, NOT a Developer agent): invoke `/behavior-test tab-scheme-guard`. The run skill spawns Executor + Validator and drives the two-target CDP flow. Provide it the fixture URL.
4. **On green**: flip the spec to `active`, set `Last Run`. **On fallback**: leave `draft`, log the deferral with the exact blocker.

## Edge Cases
- **`window.open` target on the guest**: the Executor runs the trigger on the `<webview>` guest CDP target (the trigger page), then reads the result on the renderer target — `select_page` between them.
- **`/etc/passwd`**: present on Linux; the control assertion ("no local file content renders") relies on it being readable-if-allowed. Fine on this platform.
- **Don't commit evidence**: screenshots/CDP dumps go to the ephemeral evidence dir (per ARTIFACTS.md), not into `tests/behavior/`.
- **Final leg**: this is the last autonomous leg — after it, the Flight Director runs the single flight-level review + commit.

## Files Affected
- `tests/behavior/fixtures/tab-scheme-guard/index.html` — new fixture
- `tests/behavior/tab-scheme-guard.md` — status promotion (on green)
- `tests/behavior/tab-scheme-guard/runs/{ts}.md` — run log (by the run skill)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] Fixture delivered; behavior test run (or deferral logged with blocker)
- [ ] Spec promoted to `active` (only on a green run)
- [ ] Update flight-log.md with leg progress entry (run verdict or deferral)
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] Final leg → flight-level review + commit handled by the Flight Director next
