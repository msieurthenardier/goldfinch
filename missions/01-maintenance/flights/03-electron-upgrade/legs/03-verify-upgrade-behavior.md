# Leg: verify-upgrade-behavior

**Status**: completed
**Flight**: [Dependency Currency — Electron Major Upgrade](../flight.md)

## Objective
Prove — at runtime, on the upgraded Electron 42 — that core browsing and the Shields privacy pipeline still work and that the F1 hostile-URL guard still holds, via two CDP-driven behavior tests (the flight's behavior-tests-only acceptance gate).

## Context
- Flight DD "Runtime verification — behavior tests only". Leg 2 already smoke-confirmed launch + `createTab` + navigation on E42; this leg adds the Shields/privacy and F1 runtime assertions that unit tests + typecheck cannot observe.
- Specs: `tests/behavior/core-browsing-shields.md` (draft, authored this flight — launch/nav/tracker-block/param-strip/multi-tab) and `tests/behavior/tab-scheme-guard.md` (the existing F1 spec, re-run on E42).
- Apparatus (proven in Flights 1-2): raw CDP over Node WebSocket against the running app at `:9222`; consolidated single-pass Witnessed (independent Executor drives, independent Validator judges).

## Inputs
- The two behavior specs above; the running E42 app (`npm run dev:debug`); the served fixtures.

## Outputs
- `tests/behavior/fixtures/core-browsing-shields/index.html` (new) — the trigger page (a `<script src="https://www.google-analytics.com/analytics.js">` to exercise Shields `block`; loaded at a URL with `utm_*` params to exercise `strip`).
- `tests/behavior/core-browsing-shields/runs/{ts}.md` + `tests/behavior/tab-scheme-guard/runs/{ts}.md` — run logs.
- `core-browsing-shields.md` — `draft → active` on a green run; `Last Run` set.

## Acceptance Criteria
- [ ] The `core-browsing-shields` fixture exists and is served over HTTP (port ≠ 9222): page renders a visible marker, includes the `google-analytics.com` tracker script, and is loadable with `?utm_source=test&q=keep`.
- [ ] `/behavior-test core-browsing-shields` runs against the **E42** app and **passes**: app launches, navigation/render works (example.com), the `utm_source` param is stripped on the top-level URL, ≥1 tracker is shown blocked (privacy panel), multi-tab works.
- [ ] `/behavior-test tab-scheme-guard` re-run on E42: the hostile-scheme vectors (window.open file:/js:/data:, in-page will-navigate file:) remain blocked and the https control opens — F1 still holds post-upgrade.
- [ ] On green, `core-browsing-shields` is promoted `draft → active`. (A partial/inconclusive on a vector that's a spec/harness limitation — not a guard failure — is recorded honestly, not promoted.)
- [ ] **Fallback (flight adaptation criteria)**: if the app cannot launch on E42 or CDP cannot attach, deliver the fixture + record the deferral with the specific blocker — the leg still lands (fixture delivered, runs deferred).

## Verification Steps
- Probe: app `:9222/json` responds (renderer + webview); fixtures serve HTTP 200.
- Run both `/behavior-test` slugs; read the run-log verdicts.
- Confirm `core-browsing-shields` status flipped to `active` only on green.

## Implementation Guidance
1. **Fixture** (Developer task): build `tests/behavior/fixtures/core-browsing-shields/index.html` — a minimal static page with `<h1>CORE BROWSING + SHIELDS FIXTURE</h1>` + a unique marker, a `<script src="https://www.google-analytics.com/analytics.js"></script>` (the tracker Shields should block), and a visible note. Self-contained. Lives under the eslint/prettier-ignored fixtures path.
2. **Run** (Flight Director, NOT a Developer agent): launch the E42 app (`dev:debug`), serve both fixtures (the `tab-scheme-guard` fixture already exists), and invoke `/behavior-test core-browsing-shields` then `/behavior-test tab-scheme-guard`. Use the consolidated-Witnessed approach (raw CDP). Per `core-browsing-shields`: observe the webview URL for the strip (not the aggregate), open the privacy panel for the blocked-tracker count.
3. **On green**: promote `core-browsing-shields` `draft → active`, set `Last Run`. **Fallback**: deliver fixture + log the deferral.

## Edge Cases
- **Network for `google-analytics.com`**: the tracker-block assertion needs the page to actually request the tracker domain (which Shields then cancels). If the environment has no outbound network, the request is cancelled by Shields *before* it would fail anyway — the blocked count should still register (Shields cancels at `onBeforeRequest`, before the network attempt). If the privacy aggregate shows 0, note whether network or Shields was the cause.
- **Param strip read path**: observe the webview `src`/address-bar (the redirect lands there); the aggregate `stripped` count is 0 for mainFrame by design — don't assert on it.
- **Promotion gate**: only promote on an all-pass (or pass-with-only-harness-inconclusive) run, per the Flight 2 integrity precedent.

## Files Affected
- `tests/behavior/fixtures/core-browsing-shields/index.html` — new fixture
- `tests/behavior/core-browsing-shields.md` — status promotion (on green)
- `tests/behavior/{core-browsing-shields,tab-scheme-guard}/runs/{ts}.md` — run logs

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] Fixture delivered; both behavior tests run (or deferral logged with blocker)
- [ ] `core-browsing-shields` promoted `active` (only on green)
- [ ] Update flight-log.md with leg progress entry (run verdicts or deferral)
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] Final autonomous leg before CI — flight-level review + commit after Leg 4
