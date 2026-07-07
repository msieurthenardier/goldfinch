# Leg: slide-probe

**Status**: landed
**Flight**: [Side-Panel Slide Composition](../flight.md)

## Objective

Probe the media/privacy side-panel open/close **slide** on the native `WebContentsView` surface —
capture objective **settled-state** frame + geometry evidence and run the `panel-slide` Witnessed
spec — to establish whether the settled compositing is correct (guest compresses flush to the panel,
no gap/overlap, both panels, populated privacy, cross-panel switch). A best-effort single
mid-transition frame may be grabbed for a **coarse gross-tear look only** (non-authoritative — true
inter-frame smoothness is the Leg-2 HAT's per DD4). **CP1 gate**: objective net clean → certify
candidate for the HAT; anomaly → carry to the HAT and pre-arm Leg 3; objective net *incomplete*
(privacy deferred / capture-BLOCKED) → the HAT inherits the missing objective checks (see AC4).
**No source changes** — this is a read/observe leg, **FD-driven** (the FD runs the apparatus +
`/behavior-test` directly; no autonomous Developer is spawned — a behavior-test leg, like a HAT).

## Context

- **DD1**: panels are chrome-DOM `flex:none` siblings of `#webviews` in `#main` (`display:flex`);
  opening from `.collapsed {width:0}` → `width: var(--panel-w)` (360px) compresses the `flex:1`
  guest slot; the `#webviews` `ResizeObserver` → `sendActiveBounds()` re-bounds the active guest to
  `measureWebviewsSlotDIP()`. Panels **inset/compress**, never overlay (chrome is opaque + below the
  guests). This leg observes that mechanism, does not change it.
- **DD2**: verify-first. This probe produces the objective net (**settled-state** compositing +
  settled guest-vs-panel geometry) and frame evidence; a best-effort coarse mid-transition frame is
  optional and non-authoritative. The *smoothness* call (no inter-frame tear/lag) is the Leg-2 HAT's
  (DD4 apparatus limit — discrete `captureWindow` grabs are settled frames, so mid-transition
  sampling can only support a coarse "no gross tear" look, never a smoothness proof).
- **DD3**: the privacy panel must be exercised on a **real tracker-heavy page**, not the static
  local fixture — `renderPrivacy()` (`renderer.js:2109-2188`) unconditionally appends its ~8
  sections, so a child-count check on the fixture is trivially true; assert a **non-zero
  Trackers/Third-party stat**. The async-populate-during-open asymmetry itself is inter-frame →
  Leg-2 HAT.
- **DD4 apparatus**: dev instance (`goldfinch-development`, `127.0.0.1:49252`, semi-permanent admin
  key), Wayland dev backend (F8). Act via `evaluate(chromeWcId, "…toggle-media/toggle-privacy/
  media-close.click()")`; observe via `captureWindow` (OS-grab path — confirm with the find-bar
  canary) + `evaluate(#webviews getBoundingClientRect / panel width / privacy big-stat)`.
- **DD6**: a ~1-frame guest-bounds IPC lag is structural (CSS animates in the chrome compositor;
  the guest re-bound travels renderer → async `tabSetBounds` → main, coalesced to one rAF). So a
  gross settled-state gap/overlap would be a real defect; sub-frame transient lag is expected and is
  the HAT's smoothness call, not this leg's.
- Acceptance is carried by `tests/behavior/panel-slide.md` (drafted at flight planning,
  Architect-reviewed) — this leg RUNS it, it does not re-derive verification steps.

## Inputs

- Branch `flight/09-panel-slide-composition` (off `mission/05`); no prior legs.
- Source (read-only, for observation targets): `src/renderer/index.html:107-162` panels;
  `src/renderer/styles.css:525-566, 973-988` (`#main` flex, `#media-panel`/`#privacy-panel`
  `flex:none width var(--panel-w)`, `.collapsed {width:0}`, `width 0.18s` transition);
  `src/renderer/renderer.js:924-951` (`measureWebviewsSlotDIP`, `sendActiveBounds`),
  `:1081-1098` (`togglePanel`), `:1099-1106` click handlers, `:2109-2188` (`renderPrivacy`),
  `:2613-2615` (`#webviews` ResizeObserver); `src/main/main.js:860/863` (chrome opaque + first).
- `tests/behavior/panel-slide.md` — the Witnessed spec this leg runs.
- Apparatus: standing dev MCP (see DD4); fixtures — the ticking `tests/behavior/fixtures/
  menu-overlay/` page (motion) + a real tracker-heavy web page for the privacy step.

## Outputs

- **No source changes.** Evidence + a Witnessed run log.
- Frame evidence under `/tmp/behavior-tests/goldfinch/panel-slide-probe/<ts>/`: baseline, media
  open (×2 for liveness), media close, privacy-open-on-real-page, cross-panel switch, return.
- `tests/behavior/panel-slide/runs/<ts>.md` — the Witnessed run log (committed at flight end).
- A recorded **CP1 verdict** in the flight log: settled compositing clean/anomalous per panel, with
  the guest-vs-panel geometry deltas and any gross tear/gap noted for the HAT.

## Acceptance Criteria

- [ ] **AC1 — Apparatus confirmed.** Wiring litmus passes on `goldfinch-development` (chrome wcId +
  this instance's tabs); the `captureWindow` **OS-grab path** is confirmed via the find-bar canary
  (find bar visible in pixels) — not the WSLg fallback. If the fallback is in force, signal
  `[BLOCKED:capture-apparatus]` (the HAT still covers the surface on-screen).
- [ ] **AC2 — `panel-slide` Witnessed run executed.** `/behavior-test panel-slide` runs to a
  terminal verdict. A **pass** (settled compositing correct across all six steps — guest flush to
  panel both open/closed, both panels, privacy populated on a real page with a non-zero stat,
  cross-panel switch single-inset, return-to-baseline, guest live under compression) satisfies CP1's
  objective half. A **fail/partial** is recorded with the failing step(s) and does NOT block the leg
  — it pre-arms the HAT/Leg 3 (the settled state is a genuine defect if it fails).
- [ ] **AC3 — Guest-vs-panel geometry recorded.** For each panel open, the `#webviews` slot width
  shrank by ≈ `--panel-w` (360px, within a small rounding tolerance) and the guest re-bounded to it;
  the flush relationship (no gap/overlap) is confirmed on pixels. Deltas recorded in the flight log.
- [ ] **AC4 — Frame evidence saved + CP1 verdict recorded, with explicit objective-net status.**
  All frames saved to the evidence dir and referenced in the flight log; a one-paragraph CP1 verdict
  states, per panel: settled compositing clean or anomalous, any gross tear/gap seen, and the
  go/anomaly call for the HAT. **The verdict must classify the objective net as one of: (a) complete
  + clean → certify candidate; (b) complete + anomaly → HAT + pre-arm Leg 3; (c) INCOMPLETE
  (privacy settled-composite deferred for lack of a real page, and/or the whole pixel net BLOCKED by
  the WSLg capture fallback) → the verdict explicitly HANDS Leg 2 the missing *objective*
  settled-composite checks (not just the smoothness call), naming which checks are owed.** The
  keyboard-toggle re-bound path (observer-only, DD6) is NOT objectively covered here and is Leg-2
  HAT scope — say so, so Leg 2 doesn't assume inherited coverage.
- [ ] **AC5 — No source changes.** `git status` shows only the run log + flight-log/leg-artifact
  updates (no `src/` diff). `npm test`/typecheck/lint show **no NEW failures vs branch HEAD** (run
  once as a sanity check that the probe touched nothing — not new coverage; baseline against HEAD in
  case the branch already carries a pre-existing state).

## Verification Steps

- AC1: launch `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49252 npm run dev:automation` (plain —
  the semi-permanent admin key is hash-persisted in the dev profile's settings; auto-mint requires
  BOTH `--automation-dev` AND `GOLDFINCH_AUTOMATION_DEV_MINT=1` — `main.js:2449` — so the plain
  launch leaves `automationAdminKeyHash` untouched and the standing `goldfinch-development` client
  keeps working). **This deliberately diverges from CLAUDE.md's dogfooding recipe** (which mints
  fresh each launch) — the semi-permanent key is the standing-apparatus choice adopted in F8.
  **Stale-key fallback**: if the wiring litmus fails admin auth (hash missing/rotated, or the client
  holds a stale plaintext), re-mint ONCE via a `GOLDFINCH_AUTOMATION_DEV_MINT=1
  GOLDFINCH_AUTOMATION_ADMIN=1 …` launch, update the `goldfinch-development` MCP client's
  Authorization header to the printed adminKey, then revert to the plain launch. Wiring litmus +
  find-bar canary (Ctrl+F via `pressKey` on a guest wcId → `captureWindow` shows the bar).
- AC2: invoke `/behavior-test panel-slide` (the run skill orchestrates its own Executor + Validator;
  the FD does not spawn a Developer for it). Serve the ticking fixture for the motion steps; use a
  real tracker-heavy page for step 4 (privacy). Record the run-log path + verdict.
- AC3: from the run's `evaluate` reads (or a supplementary read), record baseline vs open
  `#webviews` widths for both panels; confirm Δ ≈ 360px and flush-on-pixels.
- AC4: confirm the evidence dir contents; write the CP1 verdict paragraph.
- AC5: `git status --short`; `npm test && npm run typecheck && npm run lint`.

## Implementation Guidance

1. **This leg is apparatus-driven, not code-driven.** Bring up the dev instance on 49252 (standing
   config); run the litmus + canary; then run the `panel-slide` Witnessed spec via
   `/behavior-test panel-slide`. Capture supplementary frames/geometry as needed to satisfy AC3/AC4.
2. **Privacy step needs a real page, and the stat is async.** The static fixture yields zero tracker
   activity; `renderPrivacy` still renders sections (early-returns only when collapsed,
   `renderer.js:2111`), so assert a **non-zero** `Trackers` or **`Third-party domains`** big-stat
   (exact titles, `renderer.js:2139/2147` — read `.ps-big` under the matching `.ps-title` via
   `evaluate`) as the real-content signal. The counts accrue **async** from `privacy-net` updates as
   requests fire — let the real page fully load / hit `#privacy-refresh` (`index.html:157`) before
   asserting, or a too-early read yields a false 0. If no network/real page is available on the rig,
   record AC2's privacy step as **deferred-to-HAT** and mark the CP1 objective net INCOMPLETE
   (AC4 outcome c) rather than passing it trivially — do not certify privacy compositing off the
   empty fixture.
3. **Do not fix anything here.** If a gross settled-state gap/overlap/tear appears, record it as a
   CP1 anomaly and carry it to the HAT/Leg 3 — this leg observes only.
4. **Evidence + run log only.** No `src/` edits. The `panel-slide` spec stays `draft` (Leg 2
   promotes it on HAT certification).

## Edge Cases

- **WSLg capture fallback**: if `captureWindow` provably takes the WSLg fallback (canary bar absent),
  overlay/panel-presence pixel checks are void → `[BLOCKED:capture-apparatus]`; the HAT covers it.
- **Real tracker page unavailable offline**: privacy settled-composite deferred to the HAT (guidance
  2), not passed on the empty fixture.
- **Guest-bounds rounding**: `measureWebviewsSlotDIP` rounds; allow a small (±2px) tolerance on the
  360px delta — a flush check on pixels is the authority, not exact arithmetic.
- **Internal tabs also inset** (`renderer.js:943-948`): out of scope for CP1 (web-tab motion guest
  is the target); note only if incidentally observed.

## Files Affected

- None in `src/`. New: `tests/behavior/panel-slide/runs/<ts>.md` (Witnessed run log). Updated:
  this leg artifact + `flight-log.md` (CP1 verdict).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch flight: review + commit
deferred to flight end — do NOT commit, do NOT set `completed`):

- [ ] All acceptance criteria verified (CP1 verdict + run-log path + geometry deltas in the flight
  log)
- [ ] `panel-slide` run log committed-path noted (file created; committed at flight end)
- [ ] `npm test` / typecheck / lint confirmed untouched
- [ ] Update flight-log.md with the Leg-1 progress entry + CP1 verdict
- [ ] Set this leg's status to `landed` (in this file's header)

---

## Citation Audit

Verified against current code on `flight/09-panel-slide-composition` at leg design time
(2026-07-06):

- `src/renderer/index.html:107-162` `#media-panel`/`#privacy-panel` in `#main` — **OK**
- `src/renderer/styles.css:525-527` `#main {display:flex}`, `:551-566` `#media-panel`
  (`flex:none`, `width var(--panel-w)`, `.collapsed {width:0}`, `width 0.18s`), `:973-988` privacy
  — **OK** (`--panel-w: 360px` at `:11`)
- `src/renderer/renderer.js:924-926` `measureWebviewsSlotDIP`, `:937-951` `sendActiveBounds`,
  `:1081-1098` `togglePanel`, `:1099-1106` click handlers, `:2109-2188` `renderPrivacy`,
  `:2613-2615` `#webviews` ResizeObserver — **OK** (post-Architect-review anchors)
- `src/main/main.js:860` `addChildView(chromeView)`, `:863` `setBackgroundColor('#1e1f25')` — **OK**
- `tests/behavior/panel-slide.md` — drafted + Architect-reviewed at flight planning — **OK**

All clean; anchors carried from the Architect flight-design review (2026-07-06).
