# Squawk 0044: Toolbar buttons that receive keyboard focus draw no visible focus indicator

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-28
**Completed**: —

## Report

When the backward tab-boundary handoff (Mission 17 Flight 1 Leg 1) places focus on the chrome's last visible tabbable, that element renders **no focus indicator**: `#bookmarks-overflow` ("More bookmarks", web tabs) and `#kebab` ("More", internal tabs, where the bookmarks bar is hidden) both have computed `outline: none` when focused, and an 8× crop of the chevron shows a plain glyph. The address bar draws a yellow ring on the Ctrl+L path and guest controls draw an orange ring, so a sighted keyboard user Shift+Tabbing out of a page lands on invisible focus. WCAG 2.4.7 Focus Visible (Level AA). Fix: a `:focus-visible` style for the toolbar/bookmarks-bar buttons (audit `#kebab`, `#bookmarks-overflow`, the media/shields/devtools/vault toggles, the tab-strip buttons) consistent with the address bar's ring; verify with `npm run a11y` where it covers the chrome, and a source pin that the rule exists.

Source: behavior-test run `tests/behavior/chrome-guest-keyboard-nav/runs/2026-08-28-01-01-15.md`, checkpoints 8 and 11 (Validator notes).

## Evidence

- Run 2026-08-28-01-01-15: `step-8-eval-C-active-detail.txt` (focused `#bookmarks-overflow`, computed outline none — Validator fresh read), `step-8-validator-crop-chevron.png`; checkpoint 11 `#kebab` likewise
- `src/renderer/styles.css` — `:focus-visible` rules exist for `#address` and inputs (sweep F51), not for the toolbar buttons

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —

## Re-triage / Deferral (2026-08-28, turnaround)

**The report's premise is CSS-false.** Both `#kebab` and `#bookmarks-overflow` carry `class="icon-btn"` (`src/renderer/index.html:322,339-340`), and `.icon-btn:focus-visible` already draws `outline: 2px solid var(--accent); outline-offset: 2px` (`src/renderer/styles.css:357-366`). There is **no** id-level `outline: none` on either button (the only `#bookmarks-overflow` rule, `styles.css:772`, sets flex/width/height). So a focus ring rule *does* apply to them.

The behavior-test observation of "no ring" (runs 2026-08-27-23-14-02 / -28 rows 8, 11, 14) was almost certainly a **`:focus-visible`-vs-programmatic-focus artifact**: the backward-boundary handoff focuses the chrome control via a programmatic `.focus()`, and `:focus-visible` matches only when Chromium's keyboard-modality heuristic classifies the focus as keyboard-initiated — which synthetic automation input (CDP `sendInputEvent`) does not reliably set, so the ring rule does not match under automation even though it exists. A **real** keyboard user (whose modality *is* keyboard) very likely sees the ring — consistent with the HAT operator seeing the guest `last` button's ring and the Validator seeing the `#bookmarks-overflow` ring in one row-14 capture.

**Why deferred, not completed or escalated:** confirming whether a real gap exists needs **live real-keyboard verification** (the exact case automation can't reproduce), and any real fix — forcing the ring on a keyboard-driven programmatic boundary-focus (e.g. `:focus` fallback for the two ids, or a controller-set ring class) — is a focus-visibility behavior/UX decision that couples with the **cross-view stale-ring** boundary-focus item (Mission 17 Known Issue). **Revisit trigger:** the next live/HAT session or the boundary-focus design work — verify on a real keyboard whether a Shift+Tab / Shift+F6 handoff onto `#kebab` / `#bookmarks-overflow` shows the accent ring; if it does, resolve this as not-a-defect; if it does not, fix it together with the stale-ring boundary-focus visibility work. Do NOT add a blind CSS rule — the rule is already there.
