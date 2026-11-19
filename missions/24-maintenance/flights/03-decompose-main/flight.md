# Flight: Decompose main.js and Restore renderer.js Headroom

**Status**: completed
**Mission**: [Maintenance](../../mission.md)

## Contributing to Criteria

- [x] `main.js` no longer owns the window-capture, vault-wiring and human-wiring blocks, and `renderer.js` has at least 40 lines of budget headroom, with every gate green and both `createEngine` grep pins intact.

---

## Pre-Flight

### Objective

Return `main.js` to being the composition root CLAUDE.md says it is, and unblock the next chrome feature. `main.js` has grown 2,014 → 3,263 lines since 2026-08-27. It now owns about 530 lines of vault wiring, 260 of window capture and 150 of reveal-gate / gesture / injected-input wiring, and has 12 module-level late-bound `let`s written through setter closures. `renderer.js` is at 1,504 of its 1,505-line budget, so a feature that touches it needs an extraction first anyway. Every move is behavior-neutral.

### Open Questions

N/A: maintenance flight. The extraction map is in the maintenance report.

### Design Decisions

**Order: lowest hazard first.** Window capture first; then vault wiring with human wiring; then `renderer.js`. The MCP-host block and the inline IPC glue (map blocks 4 and 5) are deliberately not in this flight.
- Rationale: blocks 4 and 5 need the `let`→holder conversion and touch every channel's class registration. Do them after the first three have proven the pattern.
- Trade-off: `main.js` is still about 2,300 lines after this flight.

### Prerequisites

- [x] Squawks 0210–0221 that touch `main.js` or `renderer.js` are completed or explicitly sequenced after this flight, so the two do not collide (none of them is planned to touch either file).

### Pre-Flight Checklist

- [x] All open questions resolved: N/A
- [x] Design decisions documented
- [x] Prerequisites verified: none of 0210–0221 targets `main.js` or `renderer.js`
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

All three legs are verbatim moves under the CLAUDE.md **TDZ checklist**: anything referenced above the construction site needs a getter or a hoisted declaration. Line numbers are as of 2026-11-18; re-read them at leg design.

- **Block 2: `grabWindow` / `captureWindow` composite** (`main.js` ~779–1038) → `src/main/window-capture.js` (`createWindowGrabber`).
  - Closes over: the registry, `desktopCapturer`, `app`, `captureFailure`, capture-timeout.
  - Hazard (low): a hoisted function declaration passed as `grabWindow` into the `app-lifecycle` deps and consumed only by `observe.captureWindow`. The embedded canvas script string's backslash escaping must survive the move.
  - Make it Electron-free with injected deps where practical, and unit-test it.
- **Blocks 1 + 3: vault store, lock fan-out, holds, compromise/sever state, import delegates (~1040–1572), plus the reveal gate, gesture witness, injected input, document marks, `getVaultHuman` and `getBrowserImportFlow` (~1574–1720)** → `src/main/vault/vault-wiring.js` (and `vault/human-wiring.js` if the split reads better).
  - **First**, hoist the late requires at ~1196–1197 (`pending-browser-imports`, `browser-import-flow`).
  - `lockVaultForQuit: () => _vaultStore?.lockNow()` reads the raw slot and must not construct, so expose a `peekVaultStore()`.
  - `resurfaceCompromiseReveal` is passed as `onChromeBooted`.
  - `getVaultStore` is also consumed by `registerOverlayIpc`, `registerVaultIpc` and the lock channels.
  - **Grep-pinned:** `markScripted` and `injectedInput` must stay threaded at BOTH production `createEngine` sites (`main.js` and `app-lifecycle.js`), and `hasAdminSession` stays a late-bound getter on `mcpServer`.
  - `gestureWitness` is consumed by `guest-wiring`.
  - Fix the orphaned "Create + start a fresh MCP server instance" comment (it belongs above `startMcpServerInstance`) and the stale line-number references (finding #23).
- **`renderer.js` headroom:** move the context-menu and overlay-dispatch cluster (`openToolbarContextMenu`, `openTabContextMenu`, the `closedTabStackSize` / `moveTargets` seeds and their wrappers, the leftover bookmark-edit and star handlers) into `src/renderer/chrome/overlay-menus.js` or a new `chrome/tab-context-controller.js`.
  - Rules: the seam set stays at 41 (`SEAM_COUNT`). Retarget `RENDERER_LINE_BUDGET` in `test/helpers/renderer-line-budget.js` to the new count with zero headroom, per the CLAUDE.md rule.
  - Add `.catch` to the two seed calls on the way (finding #31, two of its seven sites).
  - The `menu-overlay.js` header ("FIVE templates") is corrected here only if that file is touched; otherwise it waits for the `menu-overlay.js` split.

### Checkpoints

- [x] `window-capture.js` extracted, unit-tested, and `captureWindow` live-smoked.
- [x] Vault and human wiring extracted; `ipc-gate-invariant`, `reveal-gate-wiring-invariant` and both `createEngine` grep pins green.
- [x] `renderer.js` at most 1,465 lines, budget retargeted, seam contract green.

### Adaptation Criteria

**Divert if**:
- A move needs a channel to change class or switches, or changes any IPC payload: the change is not behavior-neutral, so stop and re-plan.
- The `let`→holder conversion turns out to be required for blocks 1 and 3 (not only block 4): split it into its own leg first.

**Acceptable variations**:
- Blocks 1 and 3 as one module or two.
- The `renderer.js` cluster going to `overlay-menus.js` or a new controller.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses. This list will evolve based on discoveries during implementation.

- [x] `window-capture` - Extract the `grabWindow` / `captureWindow` composite into `window-capture.js`.
- [x] `vault-wiring` - Hoist the late requires; extract the vault and human wiring into `vault/`; `peekVaultStore()`; fix the stale comments.
- [x] `renderer-headroom` - Move the context-menu / overlay-dispatch cluster out of `renderer.js`; retarget the budget.

Every leg's live smoke exercises every existing apparatus primitive against the new state (census, windows, capture, evaluate, …) per the CLAUDE.md planning rule. `window-capture` in particular must live-smoke `captureWindow`.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing
- [x] Documentation updated

### Verification

- `wc -l src/main/main.js` is about 2,300 or less, and `src/renderer/renderer.js` at most 1,465.
- `npm test`, `lint`, `typecheck` and `format:check` are green.
- A dev launch with admin automation: census, `captureWindow`, an evaluated reveal raising the native dialog (cancelled), and vault lock all behave as before.
- CLAUDE.md *Architecture* names the new modules.
