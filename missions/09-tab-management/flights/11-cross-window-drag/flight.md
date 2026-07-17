# Flight: Cross-Window Tab Drag

**Status**: landed
**Mission**: [First-Class Tab Management](../../mission.md)

## Contributing to Criteria

- [x] A tab dragged from one window's strip into another window's strip moves there, keeping its
      cookie-jar identity and its page state. *(behavior-test-backed)* — **criterion 8**, UNSATISFIED
      since F8; F10 Station C measured the HTML5-DnD transport a **GO**. This flight builds the gesture.
      *(WITNESSED live by the operator: X11 full-parity run — non-overlapping windows, across bare
      desktop — plus the Wayland overlap path. The behavior-spec re-authoring is Leg 4.)*

---

## Pre-Flight

### Objective

Ship the cross-window tab **drag** gesture on the HTML5-DnD transport F10 Station C proved delivers a
custom-MIME `drop` across `BaseWindow`s. Drag a tab out of window A's strip and drop it on window B's
strip → the tab moves A→B keeping `wcId`, jar, and page state, by reusing the existing coordinate-free
`moveTabIntoWindow`/adopt core through a **new drop-side IPC**. **Spike-first** — the coexistence of
HTML5 `draggable` with the existing pointer-based reorder/tear-off is the make-or-break unknown the L5
design review flagged, and it must be **measured, not designed**.

### The problem this flight inherits (from F10 L5 design review)

The in-window reorder/tear-off is **pointer-events based** (`renderer.js` `pointerdown`→document
`pointermove`→`pointerup`). Making a tab `draggable=true` fires `dragstart` and **`pointercancel`**,
killing that machinery. The review found only two viable paths, **both needing a spike**:
- **(c) modifier-gated** `draggable` set at `pointerdown` (lead hypothesis) — keeps reorder pure pointer;
  only a modified press upgrades to a native drag. **Unmeasured:** does Chromium honor a `draggable`
  attribute *set during `pointerdown`* for that same gesture?
- **(b) full replacement** of the pointer drag with HTML5 DnD for both in-window and cross-window
  (fallback) — a ~+100/−80 rewrite re-litigating `tab-reorder`/`tab-drag-zone`.

### Open Questions (resolved by Leg 1, the spike)

- [ ] **Q1 — does `draggable` set during `pointerdown` initiate a native drag on that same gesture?**
      (option c's linchpin; a native drag normally initiates only from a fresh mousedown→first-move.)
- [ ] **Q2 — does `dragover`/`drop` deliver over the strip's `-webkit-app-region: drag` zone on WSLg RAIL?**
      Station C's probe used a bare `draggable` div, NOT the real strip; `#tabs` is not `no-drag`, and the
      `#tabstrip` background + spacer are window-move regions. A drop may only land on the `no-drag` tab
      buttons — a robust "drop anywhere on the target strip" may need a dedicated `no-drag` drop surface.
- [ ] **Q3 — does `pointercancel` reliably fire** to clean up the abandoned pointer `drag` record when the
      native drag pre-empts it?
- [ ] **Q4 — coexistence verdict:** given Q1–Q3, is (c) viable, or must this flight take (b) the rewrite?
      A clean GO on (c) is the low-risk path; a NO-GO routes to (b) or escalates.

### Design Decisions (provisional — firmed after the spike)

**DD1 — Reuse the move core; new drop-side IPC.** A new `tab-adopt-by-drop({ wcId, url, title, favicon,
container })` resolves `source = registry.getWindowForGuest(payload.wcId)`, `target =
getWindowForChrome(event.sender)`, refuses same-window/internal/vanished, then calls the EXISTING
`moveTabIntoWindow(source, p, () => target)` — preserving the DD1 synchrony pin and the row-8a
displaced-tab hide. **Payload must be `{wcId,url,title,favicon,container}`** (mirror `requestTearOff`;
`jarId` alone fails `validateMoveTabPayload`).

**DD2 — Drop-side authority ruling (owed, not inherited).** Unlike the keyboard/menu moves (source =
`event.sender`), the drop resolves source from a **payload-supplied `wcId`** — a real weakening (guest web
content could set the MIME with an arbitrary `wcId`). For a single-user desktop app the blast radius is
"moves one of your own web tabs"; **decide explicitly**: accept, or add provenance gating. Not a silent
inheritance.

**DD3 — LOCKED (operator, post-spike): option (b) unified / Chrome-parity rewrite.** All tab drags become
native HTML5 DnD — one gesture for reorder + tear-off + cross-window, no modifier. The pointer-based drag
machinery is **removed**, not gated. Reorder drop-index is recomputed from `dragover` (`classifyDragPoint`
stays pure window-local math — DD16 clientX/clientY only, never `screenX`); the live transform-follow is
replaced by a **custom drag image** (`setDragImage`) to keep the feel. Tear-off = drag-end with no
in-strip/other-window drop. **Spike impl notes:** the strip `dragover` MUST set `dropEffect='move'` (else the
drop is silently rejected); the move is **target-driven** (drop → IPC; the source's `dragend.dropEffect`
reads `none` even on success).

**DD4 — Out-of-window drag feedback is the native drag image.** F10's overlay pill is window-clipped; the
OS-native HTML5 drag ghost is what crosses window bounds (this flight's transport provides it for free).
*(Amended, session 2: the tear-off ghost pill is retired from the drag path entirely — it was briefly a
boundary-death suspect [exonerated], but is redundant under HTML5 DnD regardless. The overlay-view
primitive in `src/main/tearoff-overlay-manager.js` stays for other consumers.)*

**DD5 — LOCKED (operator): the WSLg/Wayland drag boundary is an accepted environment limit, not an app
bug.** Measured (probes 7–10 + the wayland relaunch of probe10): the identical minimal drag survives to
true desktop release on X11 but is compositor-canceled at the window edge under `--ozone-platform=wayland`
(dev-launch's default, kept for the M05 F8 first-click fix — WSLg RAIL has no desktop surface, so leaving
all windows ends the Wayland DnD session). Accepted rig behavior: tear-off spawns at the window-exit edge;
cross-window drag requires overlapping windows along the drag path. Full-parity spot-check escape hatch:
`npm run dev -- --ozone-platform=x11`.
*(CORRECTED at the criterion-8 HAT: the overlap concession was wrong — WSLg Wayland cancels the drag on
leaving the SOURCE SURFACE, not just on leaving all windows, so on this rig under Wayland cross-window
drag does not work AT ALL, overlapping or not. The target window never receives the drag; the source gets
a stale-coordinate dragend that reads as either an in-strip cancel [visually silent; screen-reader "Move
canceled"] or a tear-off [spawns a window], depending on where the cursor left the surface — both
unfixable app-side and indistinguishable from genuine gestures. Wayland-rig alternative for moving tabs
between windows: the F8 keyboard/menu "Move to window" path. The drag gesture is verified on X11 and
expected on packaged native targets.)* Packaged targets (native Windows/macOS/Linux) don't run WSLg RAIL —
expected full Chrome-parity there (X11 probes are the proxy; unverifiable on this rig). **Spike lesson
recorded: a transport spike must replicate the app's real LAUNCH FLAGS (ozone backend), not just its
window/view structure.** *(Extension, increment-A HAT: Escape-cancel mid-drag is also unavailable under
ozone-wayland — the native drag loop owns input and this backend doesn't abort on Escape; the page-level
listener stays as defensive parity. Practical cancel: release back onto the strip at the original slot.)*

### Legs (provisional)

- [x] `01-transport-spike` — measured Q1–Q3 by hand (probe2/probe3, key-free): **GO on the unified rewrite.**
      *(Session-2 caveat: probes 1–6 ran on X11 [bare electron]; the app runs Wayland. The GO stands for
      the transport itself, but the boundary behavior split by backend — see DD5.)*
- [x] `02-drag-layer-rewrite` *(RE-OPENED then REBUILT session 2 — root-cause hunt ripped the uncommitted
      polish to a probe6-minimal core; root cause proved environmental [DD5]; polish rebuilt [increment A],
      HAT passed; ghost pill retired per DD4 amend)* —
      replace the pointer-based drag (pointerdown/move/up/cancel, `armDrag`,
      `applyDragDisplacement`, `commitTabMove`, `cancelDrag`) with native HTML5 DnD for **in-window reorder +
      tear-off**: all tabs `draggable`, `dragstart` sets a custom drag image + the identity MIME, `dragover`
      recomputes the drop index via `classifyDragPoint` (+ `dropEffect='move'`), `dragend`/drop resolves
      reorder-vs-tear-off. **HIGH — re-litigates `tab-reorder`/`tab-drag-zone.test.js`/`tab-drag-invariants.test.js`/
      `tab-tearoff`; the reorder feel must be preserved.** Design review.
- [x] `03-cross-window-drop-adopt` *(landed — code + tests green; criterion-8 LIVE verification is the
      flight-level operator HAT, owed)* — the strip `drop` handler on ANOTHER window reads the payload and fires
      the new `tab-adopt-by-drop` IPC (DD1) reusing `moveTabIntoWindow`; the DD2 authority ruling. HIGH.
- [x] `04-verification` — a `cross-window-drag` behavior spec using the **HTML5-DnD** transport (NOT
      synthetic pointer injection — `tab-tearoff`'s banner warns synthetic goes green in fiction-space);
      rewrite that banner (criterion 8 finally satisfiable); the owed `tab-tearoff` clean re-run + row 8a.

### Prerequisites

- [ ] Live rig for the spike + verification (`npm run dev:automation` / a standalone probe). The spike is
      **key-free** (a throwaway Electron probe the operator interacts with — no MCP/admin key).
- [ ] The L5 design-review analysis (`missions/09-tab-management/flights/10-hat-and-alignment/legs/05-crosswindow-drag-html5.md`)
      is this flight's primary design input.

---

## Post-Flight

### Completion Checklist
- [ ] Coexistence spike GO/NO-GO recorded; mechanism locked
- [ ] In-window reorder/tear-off NOT regressed
- [ ] Cross-window drag moves a tab A→B keeping wcId/jar/history (criterion 8 satisfied) — witnessed live
- [ ] `tab-tearoff` banner rewritten; owed clean re-run + row 8a discharged

### Verification
Criterion 8 witnessed: drag a tab from window A's strip onto window B's strip; it moves, same `wcId`, jar
intact, `goBack` works — on the real HTML5 transport, not synthetic injection.
