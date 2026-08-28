# Squawk 0049: `tabSequence` / `FOCUSABLE_SELECTOR` does not pierce open shadow roots

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-28
**Completed**: —

## Report

The shared tabbable enumerator built in Mission 17 Flight 1 walks the light DOM only: `tabSequence` collects candidates via `doc.querySelectorAll(FOCUSABLE_SELECTOR)` (`src/shared/tab-boundary.js:90`), which does not descend into shadow roots. A guest page (or a chrome surface) that puts focusable controls inside an open shadow root would have them omitted from the sequence, so the forward/backward boundary detection and the chrome's "last visible tabbable" computation would both mis-locate the true first/last tabbable.

**Latent, not currently live**: no guest fixture or chrome surface in the tree today uses shadow DOM for focusable content, so nothing observably misbehaves now (Flight 1's Accessibility Reviewer flagged it as a pre-existing, unexercised gap). It becomes a real defect the moment a shadow-DOM-bearing surface is introduced. Logged so it is not rediscovered then; a reasonable **revisit trigger** is "when any guest surface or chrome control adopts an open shadow root."

## Evidence

- `src/shared/tab-boundary.js:90` — `const nodes = Array.from(doc.querySelectorAll(FOCUSABLE_SELECTOR));` (no `shadowRoot` / `assignedNodes` traversal).
- `src/shared/tab-boundary.js:31` — `FOCUSABLE_SELECTOR` (light-DOM selector only).

## Corrective Action

*(recorded by the Developer, if/when picked up)* — extend the walk to recurse into open shadow roots (and, if needed, flattened slot assignment order) so `tabSequence` reflects the real focus order. Confirm the traversal order matches Chromium's sequential focus for a shadow-DOM fixture before pinning. If the traversal shape or closed-root policy turns out to need a design decision, escalate (`[BLOCKED:exceeds-squawk-scope]`).

## Verification

*(recorded by the Developer)* — a new keyboard-nav fixture with a focusable control inside an open shadow root; a unit test that `tabSequence` includes it in document order; the existing `tab-boundary.test.js` cases unchanged.
