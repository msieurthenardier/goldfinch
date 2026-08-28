# Leg: hat-and-alignment

**Status**: ready
**Flight**: [Keyboard Reachability and Omnibox Semantics](../flight.md)
**Slug**: `hat-and-alignment`
**Kind**: interactive HAT — the operator performs each step; the Flight Director presents one step at a time and fixes inline (look-and-feel) or gates (feature) per `/agentic-workflow`.

## Objective

Align the shipped keyboard-reachability and omnibox-announcement behaviour with the operator's expectations on the real app, including one state the operator is not looking at (a second window), and close issue #174's acceptance list on the Flight 1 build: `npm run a11y` green, the two behavior specs passing, and the operator's keyboard-only primary task (navigate, activate a link, fill a form field — no mouse) performed end to end.

## Context

- Legs 1–3 landed on `flight/01-keyboard-reachability` (uncommitted, single commit at flight end): DD1 F6/Shift+F6 Chrome-like landing; DD2–DD5 boundary handoff (web + internal preload bundles); DD6 F6/Shift+F6 from the guest; DD7 Enter-on-commit; DD8 (C) trailing-iframe residual; DD9 shared `tab-boundary.js`; DD11/DD12 `#suggest-status` live region, `aria-expanded` retired.
- Runs: `chrome-guest-keyboard-nav` 15/15 (`runs/2026-08-28-01-56-28.md`); `omnibox-suggestion-announcement` (Leg 3 acceptance run — see the Leg 3 artifact's Run Record).
- Issue #174's draft AC1 said "Tab from the last chrome control lands in the guest" — superseded by the operator's DD1 ruling (F6 enters; the chrome's own Tab order stays native). The HAT records the operator's confirmation of that divergence on the live build.
- `flight.md` § Verification promised a second behavior spec, "keyboard-only primary task (navigate, activate a link, fill a form field, no mouse)". **DD14 (FD ruling, to confirm with the operator at step 3):** that task is the operator's own walk here — the automation apparatus cannot observe what a keyboard-only user experiences beyond what rows 3–9 and 13–15 of `chrome-guest-keyboard-nav` already pin, so a third automated spec would duplicate them; the flight-log entry for this leg is the record. If the operator wants it automated, it is authored as a follow-up spec at the debrief, not inline.
- `npm run a11y` needs the live GUI (verify-only, not CI); the FD runs it in step 1 against the chrome at rest — the audit has never audited the suggestions-open state, so DD11's fix is verified by the unit pins and the live region spec, not the audit.
- Fix-vs-feature gate: look-and-feel fixes ride inline (Developer spawn, re-verify the step); anything adding behaviour goes to a scoped design review first. Multi-surface "cosmetic" fixes (chrome + guest preload, or two pages) get a lightweight design-review pass before the implementing spawn.
- Contract the specs depend on (a HAT change here is a spec re-author, handled deliberately): key bindings F6 / Shift+F6 / Ctrl+L; `guest-tab-boundary {direction}`; `#suggest-status` text shape (`{n} suggestions`, `{primary}, {secondary}, {i} of {n}`, `No matches`); `#address` remains a textbox without `aria-expanded`.

## Steps (one at a time)

1. **Prep (FD).** Fixtures on :8001; app launched via `dev:automation` with a fresh mint (for the audit's attach); `npm run a11y` → exit 0 against the chrome at rest, output summarized in the flight log. Then the operator takes the keyboard.
2. **Entry and traversal (web).** Open `http://127.0.0.1:8001/form.html`. From the address bar: **F6** → the page holds focus (no ring anywhere yet — Chrome-like); **Tab** ×4 → `f1, f2, f3, last`; **Tab** → address bar with the URL selected; **Shift+F6** → the toolbar's last control (`More bookmarks` chevron — squawk 0044 is the missing ring); **F6** → back on `last`. *Alignment*: is the document-level landing what you expect, or should F6 land on the first control?
3. **Keyboard-only primary task.** **Ctrl+L**, type `127.0.0.1:8001/links.html`, **Enter** → focus is in the page; **Tab** → `first`; **Enter** activates the link (record where it goes); **Alt+Left** back; **Ctrl+L**, `127.0.0.1:8001/form.html`, **Enter**; **Tab**, type your name into `f1`. No mouse at any point. *DD14 confirmation*: is this walk the record, or do you want it as an automated spec?
4. **Omnibox announcement.** **Ctrl+L**, type `keyboard` → the popup opens; **ArrowDown** ×2, **ArrowUp** ×2, **Escape**. Optionally with a screen reader running (Orca / NVDA) — hear "N suggestions", "keyboard-nav: …, 127.0.0.1:8001, 1 of N", silence on Escape; without one, the FD reads `#suggest-status` live while you press the keys. Then **ArrowDown**, **Enter** → the suggestion navigates and focus lands in the page (DD7 via the suggestion branch).
5. **Internal page.** **Tab** to the `More` (kebab) button, **Enter**, arrow to *Cookie jars*, **Enter** → `goldfinch://jars`; **F6** → the page; **Tab** → the first jar link; **Shift+Tab** → the chrome's last control (bookmarks bar is suppressed here, so `More`); **F6** → back.
6. **The state you are not looking at (multi-window).** **Ctrl+N** → a second window; open `http://127.0.0.1:8001/links.html` there; **F6**, **Tab** ×3, **Tab** → *that* window's address bar (the handoff routes to the owning window's chrome); **Shift+F6**; switch back to window 1 (Alt+Tab or the OS) — its focus state is intact: **F6** enters window 1's page where you left it. Close window 2 (**Ctrl+Shift+W**).
7. **Find overlay and the residual.** **Ctrl+F**, type `field`, **Escape** → focus returns to the page; **Tab** traverses forward (the #174 "incidental path" now fully works). Open `http://127.0.0.1:8001/iframe.html`: **F6**, **Tab** ×3 → the wrap to `top` (DD8 (C) residual) — **Shift+F6** is the documented exit. *Alignment*: acceptable until Flight 2 / #147?
8. **Close-out.** Anything that felt wrong → fix-vs-feature call out loud; fixes re-verified at their step. The FD records outcomes per step in the flight-log leg entry, ticks the flight's Contributing-to-Criteria boxes, and lands the leg.

## Acceptance Criteria

- [x] AC1: `npm run a11y` exits 0 on the Flight 1 build (chrome at rest) — run 2026-08-28 with `--tags=wcag2a,wcag2aa,wcag21a,wcag21aa --url=http://127.0.0.1:8001/` from the squawk-0045-fixed script against the Legs 1–3 build: "No NEW violations — every violation node is in the ACCEPTED baseline"; 19 sheet states skipped by ruling (squawk 0045).
- [ ] AC2: steps 2–7 performed by the operator; every observation recorded; every alignment question answered and logged (FD Notes).
- [ ] AC3: any inline fix re-verified at its step with gates green; any feature request gated to a design review or logged as a follow-up.
- [ ] AC4: DD14 confirmed or overturned by the operator (logged).
- [ ] AC5: issue #174's acceptance list mapped to evidence in the flight-log entry (which rows / runs / this walk satisfy each; the DD1 divergence from its draft AC1 recorded).

## Verification Steps

The flight-log leg entry (per-step outcomes) and the a11y audit summary.

## Edge Cases

- Screen reader unavailable on the operator's machine → the FD reads `#suggest-status` via the automation client during step 4; the behavior spec already pinned the text.
- Window manager steals F6 (some Linux WMs bind F-keys) → note and use the OS-level alternative; not a product defect.
- Step 6 with WSLg: window focus switching may be unreliable — activate via the taskbar; the state assertion is what matters.
