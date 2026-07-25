# Leg: sandbox-flip-and-verify

**Status**: completed

> Developer design review: approve with changes (2026-07-25) — incorporated: AC6 verification made concrete (dev-gated `getOSProcessId` probe + non-`--no-sandbox` launch via `node scripts/dev-launch.mjs --automation-dev`); sandbox-pin citation corrected `:191`→`:190`. Grep confirmed no other web-content `sandbox:false` surface; both overlay preloads sandbox-safe.
**Flight**: [Renderer OS Sandbox](../flight.md)

## Objective

Flip the web-guest `WebContentsView` and the two overlay preloads (find, menu) to `sandbox: true`, update the unit pins and the now-inverted comments, revise CLAUDE.md (sandbox ruling + stale-doc fixes), and verify live that farbling, media scan, and vault fill/capture all work under sandbox with the OS sandbox confirmed active on the guest renderer.

## Context

- Flight DD4 (web guest + 2 overlays flip; chrome view deferred), DD5 (`getOSProcessId` + `/proc` seccomp diff as the sandbox-active check; WSL2 sandbox confirmed working at design review). Read the flight spec in full.
- Leg 1 landed: the web preload is now the bundled `webview-preload.bundle.js` (sandbox-loadable), and AC8 proved it behaves identically with sandbox still false. This leg flips the bit.
- The flip is one source line: `src/main/register-tab-ipc.js:88` `sandbox: false` → `true`. The pin at `test/unit/register-tab-ipc.test.js:190` flips to `true`; the comment block at `register-tab-ipc.test.js:185-188` currently asserts "the WEB guest runs with nodeIntegration AND sandbox off" as an invariant — **rewrite it** (the sandbox half inverts; `nodeIntegration:false` stays and is still the control that denies page JS an `ipcRenderer`).
- Overlay flips: `src/main/window-factory.js:70` (find) and `:94` (menu) `sandbox:false` → `true`; whole-object `deepEqual` pins at `test/unit/window-factory.test.js:39,42` flip too. Both overlay preloads are already sandbox-clean (electron-only requires + `process.platform`, which sandboxed preloads expose).
- Chrome view (`window-factory.js:178`) is **NOT** flipped this flight (DD4) — leave `sandbox:false`; its `deepEqual` pin at `window-factory.test.js:24` is unchanged.
- `contextIsolation:false` on web guests stays. The sandbox restricts the preload's Node surface, not world isolation; the guest↔preload trust boundary (nodeIntegration:false, the isTrusted caveats) is unchanged.

## Inputs

- Leg 1 landed on `flight/02-renderer-os-sandbox`; bundle builds; `npm test` green (2830).
- Design-review-confirmed: this WSL2 kernel engages Chromium's sandbox on a `sandbox:true` renderer.

## Outputs

- `src/main/register-tab-ipc.js:88` — web guest `sandbox: true`.
- `src/main/window-factory.js:70,94` — find + menu overlays `sandbox: true`.
- `test/unit/register-tab-ipc.test.js` — pin at `:191` → `true`; comment `:185-188` rewritten.
- `test/unit/window-factory.test.js` — pins at `:39,42` → `true` (chrome-view pin `:24` untouched).
- `CLAUDE.md` — sandbox ruling added; `:29` "opposite" sentence revised; `:32` stale `sendToHost` claim fixed.
- flight-log.md — leg entry + FD live-verification record.

## Acceptance Criteria

- [x] **AC1 (web guest flip + pin)**: `register-tab-ipc.js:88` is `sandbox: true`; `register-tab-ipc.test.js:190` asserts `sandbox === true`; the `:185-188` comment is rewritten to the correct post-flip invariant (nodeIntegration:false remains the ipcRenderer-denial control; sandbox now ON adds OS-level renderer containment).
- [x] **AC2 (overlay flips + pins)**: `window-factory.js:70` (find) and `:94` (menu) are `sandbox: true`; the `window-factory.test.js:39,42` deepEqual pins reflect `sandbox: true`. The chrome-view pin (`:24`) is unchanged (`sandbox:false` — deferred per DD4).
- [x] **AC3 (docs)**: CLAUDE.md gains a sandbox invariant note next to the `contextIsolation` material; the `:29` "Internal views are the opposite (isolated + sandboxed)" sentence is revised (web views are now *also* sandboxed, just not isolated — "opposite" is wrong); the `:32` `sendToHost` claim is corrected (web tabs use `ipcRenderer.send`, not `sendToHost`).
- [x] **AC4 (regression)**: `npm test`, `npm run lint`, `npm run typecheck` all pass.
- [ ] **AC5 (live — capabilities under sandbox)**: with `sandbox: true`, on a real page: (a) farbling active (canvas `toDataURL` unstable / fingerprint hooks installed), (b) media panel scans (cards populate), (c) vault fill **and** capture round-trip (a `guest-vault-capture` on a login form → chrome offer; a `vault-fill` → fields filled). The two synchronous preload-init `sendSync` calls (`vault-eligible`, `shields-farble`) return correctly under sandbox. FD-run (dev:automation); vault setup performed live if needed. *(behavior-test-backed for farbling: `/behavior-test farbling-correctness`.)*
- [ ] **AC6 (OS sandbox active)**: FD confirms the guest renderer is OS-sandboxed — its OS pid (via a temporary dev-gated `getOSProcessId()` probe, see guidance step 5), then `/proc/<pid>/status` shows `Seccomp: 2` (with an extra seccomp filter vs the main process), `NoNewPrivs: 1`, and a distinct user-namespace inode. Recorded in the flight log with the actual values. The probe must be launched WITHOUT `--no-sandbox` (see guidance).

## Verification Steps

- AC1/AC2/AC3/AC4: `npm test` + read diffs + full gate.
- AC5: FD `dev:automation` live probe (farble + media as in leg-1 AC8, plus a vault fill/capture round-trip); `/behavior-test farbling-correctness` for the farbling gate.
- AC6: FD reads `/proc/<guest-pid>/status` (guest pid via `getOSProcessId` over the automation eval seam or a main-side probe), diffs against the main process. Note: launch WITHOUT `--no-sandbox` for this check (dev:automation passes `--no-sandbox`, which would disable it) — use a plain `npm start`-style launch or a dedicated probe launch, or confirm the guest is sandboxed via a launch path that doesn't disable it.

## Implementation Guidance

1. **Flip** (developer): `register-tab-ipc.js:88` → `sandbox: true`; `window-factory.js:70,94` → `sandbox: true`. Leave the chrome view (`:178`) at `false`.
2. **Pins + comments**: `register-tab-ipc.test.js:190` → `true`, rewrite `:185-188`; `window-factory.test.js:39,42` → `sandbox: true`. Don't touch `:24`.
3. **CLAUDE.md** (AC3): add the sandbox ruling by the `contextIsolation` note (~`:29`); revise the "opposite" sentence; fix the `sendToHost` claim (~`:32`). Keep edits surgical and factual.
4. Run the gate (AC4). Hand to FD for AC5/AC6 (live).
5. **AC6 probe (design-review [high] — write it down, don't leave it to discover live)**: the automation `evaluate` seam runs guest-side JS and structurally cannot read `getOSProcessId()` (that's a main-process method). No main-side pid hook exists. So the FD adds a **temporary dev-gated** log near guest-tab creation in `register-tab-ipc.js` — `if (!app.isPackaged && isMcpAutomationEnabled(process.argv)) console.log('[sandbox-probe] guest pid', view.webContents.getOSProcessId());` (the exact dev-gate pattern already used at `main.js:1046`/`app-lifecycle.js:136`) — then launches **`node scripts/dev-launch.mjs --enable-logging --automation-dev`** (NOT `npm run dev:automation`, which injects `--no-sandbox`; the launcher itself does pure argv passthrough with no sandbox flag), opens a guest tab, reads the pid off stdout, and diffs `/proc/<pid>/status` vs the main process. The probe line is removed before commit (dev-only scaffolding, never ships).

## Edge Cases

- **`sendSync` under sandbox** (the core risk): `ipcRenderer.sendSync` is retained in sandboxed preloads (full `electron` module available) — AC8 already showed both init sendSyncs returning through the bundle; AC5 reconfirms under sandbox. If either hangs/returns undefined under `sandbox:true`, that is a divert condition (flight spec).
- **`Uint8Array` transfer** on `guest-vault-capture`/`vault-fill`: verify the typed array survives the sandboxed IPC boundary (structured clone) — part of AC5's vault round-trip.
- **`--no-sandbox` in dev:automation**: functional checks (AC5) run fine under it; the OS-sandbox-active check (AC6) must NOT use it — see verification note.
- **Chrome view unaffected**: it stays `sandbox:false`; nothing about the chrome/overlay UI should change behavior (overlays flip but are trusted `file://` surfaces with electron-only preloads).

## Files Affected

- `src/main/register-tab-ipc.js` — `:88`
- `src/main/window-factory.js` — `:70,:94`
- `test/unit/register-tab-ipc.test.js` — `:191` + comment
- `test/unit/window-factory.test.js` — `:39,:42`
- `CLAUDE.md` — sandbox ruling + two doc fixes
- flight-log.md — leg entry

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified (AC5/AC6 by FD)
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed`; check off in flight.md
- [ ] Final leg of flight → flight.md `landed`, mission checkbox (at flight-end commit stage)
- [ ] Commit batched at flight end (review first)

---

## Citation Audit

Verified at leg design time (2026-07-25, from flight-2 recon, re-confirmed post-leg-1) and corrected by design review: `register-tab-ipc.js:88` (sandbox line), `register-tab-ipc.test.js:185-190` (comment block + the `sandbox` pin at **:190**, not :191 — :191 is the `preload` assertion), `window-factory.js:70,94,178`, `window-factory.test.js:39,42` (find/menu pins exact; the chrome-view pin's `sandbox:false` key is at `:27` not `:24` — untouched this leg regardless), `CLAUDE.md:29,32`. Leg 1 changed only `main.js:1276` + scripts/config — no overlap with these edit targets. All other citations verified exact by design review.
