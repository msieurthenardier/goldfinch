# Leg: verify-a11y

**Status**: completed
**Flight**: [Accessibility — Keyboard & Screen-Reader Baseline](../flight.md)

> **Result (2026-06-06):** PASS. Behavior test `tab-keyboard-operability` 7/7 (run log `tab-keyboard-operability/runs/2026-06-06-16-38-47.md`; spec promoted `draft → active`). `npm run a11y --tags=wcag2a,wcag2aa,wcag21a,wcag21aa` → 0 violations across base/media/privacy/lightbox (controlled fixture on `:8090`). Advisory full set: only `region` (best-practice, documented app-shell exception per DD3). **A real `image-alt` (WCAG 1.1.1) bug — media-card thumbnails + lightbox image lacked `alt` — was found and fixed during verify** (`renderer.js` `img.alt = item.label || item.name`). Offline gates green (147/0/0). Finding #5 (lightbox `aria-modal` without background `inert`) left as a documented optional enhancement (focus trap is the safeguard; acceptable for AA).

## Objective
Operator-gated real-environment acceptance gate for the flight: run the `tab-keyboard-operability` Witnessed behavior test and the multi-state `npm run a11y` axe sweep against the running GUI, plus a screenshot review of the items axe can't check (focus ring, reduced-motion, non-text contrast, color-independent cues) — confirming F22/F23/F24 hold live before the flight lands.

## Why this leg is interactive / operator-gated
The behavior test spawns a two-live-agent crew (Executor + Validator) and, with the axe sweep, requires the **running Electron app at `:9222`** plus a WSLg display — an outward-facing, real-environment activity that must not run autonomously (Flight-4 debrief lesson; flight divert criteria). The Flight Director guides the operator through the steps, fixes any failures inline (spawning a Developer if code changes are needed), and re-verifies before landing.

## Inputs (prerequisites — probed at the start, not assumed)
- Legs 1–4 committed on `flight/05-accessibility-baseline` (done: `286f019`).
- `npm run dev:debug` launches the GUI; `curl -s http://127.0.0.1:9222/json` returns targets incl. the **renderer** (`index.html`) target.
- The a11y media fixture served over HTTP: from `tests/behavior/fixtures/a11y-media/` run `python3 -m http.server 8080` → `http://127.0.0.1:8080/`.
- Two-live-agent behavior-test crew available (re-spawn-per-checkpoint default; experimental `SendMessage` continuation optional).
- `axe-core` installed (it is — devDependency from leg 2).

## Acceptance Criteria
- [ ] **Probe**: `:9222` answers with a renderer target; the fixture serves HTTP 200. (Halt + fall back to "authoring-complete, run deferred" — flagged in the log, not silently skipped — if the GUI/CDP can't come up, per flight divert criteria.)
- [ ] **`/behavior-test tab-keyboard-operability` passes** (all steps PASS, incl. the negative no-hijack Step 8). On pass, promote the spec `draft → active` and bump its `Last Run`. The run log lands at `tests/behavior/tab-keyboard-operability/runs/{ts}.md`.
- [ ] **Per-checkpoint axe subsets clean** (re-run live now that the GUI is up): F23 `--rules=button-name,aria-allowed-attr,aria-valid-attr-value,aria-required-attr,aria-roles`; F24a ARIA-validity + dialog/input-name rules.
- [ ] **Full WCAG-tag axe sweep clean**: `npm run a11y -- --tags=wcag2a,wcag2aa,wcag21a,wcag21aa` across all driven states (base, media panel + fixture loaded, privacy panel, lightbox) → **0 violations** (incl. `color-contrast` + `label`; `nested-interactive` excluded). Best-practice rules run **advisory** — review, don't hard-fail on app-shell-inappropriate ones (`region`/`landmark-one-main`/`page-has-heading-one`).
- [ ] **Screenshot / manual review** (axe can't check these): visible focus ring on tabs + every chrome control; `prefers-reduced-motion` suppresses panel/switch/toast animation; switch off-track ≥3:1 (1.4.11); active-tab / active-filter / shield-alert non-color cues legible; `--fg-dim` text legible (the razor-thin 4.53:1 value — confirm axe `color-contrast` passes it live).
- [ ] Any failure is fixed inline (Developer agent for code) and re-verified before landing; fixes commit in a new commit (no amend).
- [ ] Consider finding #5 (lightbox `aria-modal` without background `inert`) — verify SR browse-mode behavior; add `inert`/`aria-hidden` to the background if it materially leaks (optional enhancement, not an AA blocker).

## Verification Steps (Flight Director guides the operator, one at a time)
1. Operator starts `npm run dev:debug` and the fixture server; FD probes `:9222` + the fixture.
2. FD runs `/behavior-test tab-keyboard-operability`; review the run log verdict.
3. FD runs the axe subsets, then the full WCAG-tag sweep; review violations (should be 0).
4. FD captures/reviews screenshots for the non-axe items (focus ring, reduced-motion, contrast, color cues).
5. Fix-and-re-verify loop for any failure.

## On Pass — Flight Completion (Phase 3)
- [ ] Promote `tab-keyboard-operability` spec `draft → active`.
- [ ] Set this leg status → `completed`; check it off in `flight.md`.
- [ ] Check the three **Contributing to Criteria** boxes (F22/F23/F24) in `flight.md`.
- [ ] Set `flight.md` Status → `landed`.
- [ ] Check off **Flight 5** in `mission.md`, and mark mission criteria **F22/F23/F24** complete (mission then 21/21).
- [ ] Commit the verify results (run log + artifact updates).
- [ ] Open / mark-ready the PR (outward-facing — operator-confirmed).
- [ ] `[COMPLETE:flight]`.

## Files Affected
- `tests/behavior/tab-keyboard-operability.md` (status → active, Last Run), `tests/behavior/tab-keyboard-operability/runs/{ts}.md` (new run log), `flight.md` (checkboxes + status), `mission.md` (flight + criteria), `flight-log.md` (verify entry). Any inline fix may touch `src/renderer/**`.
