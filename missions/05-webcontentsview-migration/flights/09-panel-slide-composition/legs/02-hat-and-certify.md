# Leg: hat-and-certify

**Status**: completed
**Flight**: [Side-Panel Slide Composition](../flight.md)

## Objective

Human acceptance test of the side-panel open/close **slide smoothness** on the native surface — the
one property the Leg-1 probe could not judge (inter-frame no-tear/no-lag during the 0.18s slide is
HAT-authoritative, DD4) — plus the two paths the probe didn't objectively cover (keyboard toggles
Ctrl+M / Ctrl+Shift+P per DD6; the privacy async-populate-during-open reflow on a real page per DD3).
Then **certify SC7/#27/SC10 closed** (F1's "looks free" prediction, now earned on both settled
compositing AND smoothness) or trigger the conditional Leg-3 fix. CP2. Interactive: the FD guides the
operator one step at a time.

## Context

- Leg-1 CP1 came back **complete + clean**: settled compositing verified 6/6 by the `panel-slide`
  Witnessed run (guest compresses flush, Δ−360, byte-identical restore, real-page privacy, single
  cross-inset). This HAT covers only what pixels-at-rest can't: the *motion* between frames.
- **DD5**: SC7 stays droppable — if the slide glitches AND a fix is non-trivial, the operator may
  drop SC7 rather than commit to Leg 3.
- **DD6**: a ~1-frame guest-bounds IPC lag is structural (CSS animates in the chrome compositor; the
  guest re-bound is async-IPC, coalesced to one rAF) — so a *sub-frame* transient is expected; the
  HAT judges whether it's perceptible/objectionable, not whether it's mathematically zero.

## Verification Steps (guided HAT — one at a time)

Apparatus is already up: dev instance on 49252 (Wayland backend), fixture at
`http://127.0.0.1:8123/` (ticking motion), and a cnn.com tab.

1. **Media slide smoothness (motion guest):** on the ticking fixture tab, click the **Media** toolbar
   icon to open, then close, a few times. Watch the guest edge as the panel slides in/out — does the
   guest compress/expand **smoothly**, with the guest edge tracking the panel edge (no tear, no gap
   flashing, no lag/jump)? A ~1-frame settle at the end is fine (DD6); a visible tear/stutter is not.
2. **Privacy slide + async populate (real page):** on the cnn.com tab, open and close the **Shields**
   (privacy) panel a few times. Same smoothness call — AND watch the panel body as it opens: do the
   privacy stats populate without the panel visibly reflowing/jumping mid-slide (the M04 asymmetry:
   Shields glitched because stats arrived during the open frame)?
3. **Cross-panel switch:** with one panel open, open the other (Media↔Shields). Does the swap read
   cleanly (no double-slide, flash, or gap where the old panel was)?
4. **Keyboard toggles (DD6):** open/close both panels via **Ctrl+M** (media) and **Ctrl+Shift+P**
   (privacy) — these use the observer-only re-bound path (no explicit bounds send). Same smoothness
   as the click path?
5. **Resize while open:** open a panel, then drag-resize the window. Does the guest stay compressed
   flush against the panel through the resize (no gap opening up, no overlap)?

## Acceptance Criteria

- [ ] Steps 1–5 judged smooth by the operator (or a glitch is recorded → Leg 3 / drop-SC7 decision)
- [ ] **SC7/#27/SC10 certified closed** (both settled compositing — Leg 1 — and slide smoothness —
  this HAT — pass) OR consciously dropped (DD5), recorded either way
- [ ] `panel-slide` spec promoted `draft` → `active` (its first run passed)
- [ ] Flight log updated (HAT results per step, certification decision)

## Post-Completion (FD-driven at HAT wrap)

- Leg status → `completed`; check off in flight.md
- Flight status → `landed`; SC7 box updated in mission.md (certified or dropped)
- Commit (Leg-1 run log + all artifacts; any Leg-3 fix would be its own commits)
- Merge `flight/09-panel-slide-composition` → `mission/05-webcontentsview-migration` (local; `main`
  untouched)
- Signal `[COMPLETE:flight]`; `/flight-debrief` runs separately
