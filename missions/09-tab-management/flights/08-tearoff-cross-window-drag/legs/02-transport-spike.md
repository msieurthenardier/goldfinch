# Leg: 02-transport-spike

**Status**: landed
**Flight**: [Tear-off and Cross-Window Drag](../flight.md)

## Objective

Record eight empirical verdicts on the live rig that decide whether F8's transport is
buildable as designed — and re-scope the flight honestly if any gate is negative.

## Context

**This leg gates legs 3-5.** DD1 and DD3 were locked on premises probed during recon;
this leg confirms them **inside the flight's own rig** rather than trusting a recon
transcript — the failure that produced ~20 wrong citations in the draft spec.

**V1, V4, V5, V8 are gates.** Their negatives are already designed for (flight spec →
Adaptation Criteria); a negative is a **re-scope, not a failure**, and must be recorded
as a verdict with its scope stated — never as "it didn't work."

## Inputs

- A running instance: `npm run dev:automation` (Wayland path, `--ozone-platform=wayland`).
- **Bind-probe for a free port.** `ss -ltn` **cannot see WSL2 ports held by Windows-side
  listeners** — a port can read free and be `EADDRINUSE` on bind (F7 rig finding). The
  bind probe is the only authoritative instrument.
- A live sibling Goldfinch may hold a port on the **default** profile. **Leave it
  untouched**; use a fresh scratch profile.
- Admin-tier MCP. **Admin keys via env-var reference ONLY, never a command literal**
  (standing carry — an F6 executor leaked one).

## Outputs

- Eight verdicts in the flight log under `### Leg 2 — Transport Spike`, each with its
  **measurement, its scope, and its falsifier**.
- No product code. **This leg writes zero lines of `src/`.**

## Acceptance Criteria

> **DD10 governs every verdict: a reading is evidence only if the instrument has been
> shown to VARY with the property — on the real artifact, in the same run, in both
> directions.** A verdict recorded without its discrimination shown is not a verdict.
> **Run each `grep -c` standalone** (exits 1 on zero, silently breaks `&&`).

- [x] **V1 (GATE) — does the source chrome renderer receive `pointermove` AND `pointerup`
      while the pointer is over another window?**
      Two windows, side by side. Arm a drag on a tab in window A (pointer capture is set
      in `armDrag`). Move the pointer over window B. Record: does A's renderer keep
      receiving `pointermove`? Does it receive `pointerup` on release?
      **Both halves are required.** *(The `pointerup` half was missing from the draft: if
      capture is broken by the OS, the source may get **neither** → `drag` never clears →
      **a stuck drag with the tab frozen mid-gesture**, an outcome DD5 claims cannot
      exist.)*
      **Discrimination**: show the instrument reporting `pointermove` when the pointer is
      **inside** A (positive control) in the **same run** — otherwise "no events" is
      indistinguishable from a dead listener.
      **Note**: `renderer.js`'s own comment claims capture *"retargets subsequent events
      to the dragged tab's own element **regardless of where the cursor visually sits**"*
      — that is a claim about **within-window** retargeting. **Do not read it as an
      answer to V1.** It is the hypothesis, not the evidence.
- [x] **V2 — is `window.screenX + e.clientX` globally consistent across two windows?**
      Move both windows by a known delta; compare renderer-computed globals against each
      other. **Recon measured `delta_renderer === delta_main` = [1100,600] — confirm or
      refute in-rig.**
      **V2 is V8's positive control and must run BEFORE it.**
- [x] **V3 — `screen.getCursorScreenPoint()` → `{0,0}`?** Confirm in-rig, with the cursor
      demonstrably NOT at the origin (that is the discrimination — a reading of `{0,0}`
      with the cursor at `{0,0}` proves nothing). Also record `screenToDipPoint` and
      `dipToScreenPoint`.
      *(`dipToScreenPoint`'s Wayland behavior is **undocumented** — the typings say only
      "not currently supported", with **no identity clause**, unlike `screenToDipPoint`.
      Measure it; do not assume it mirrors its sibling.)*
- [x] **V4 (GATE) — `getBounds()` for hit-test, THREE readings.**
      **`getBounds()` carries the SAME documented Wayland failure as `getPosition`**:
      *"On Wayland, this method will return `{ x: 0, y: 0, … }`."* Recon probed
      `getPosition`, **not `getBounds`** — the evidence for DD3's primary mechanism is
      currently **inference**.
      1. A point inside window B resolves to **B**.
      2. A point on empty desktop resolves to **none**.
      3. **Two windows at known-different positions resolve to DIFFERENT records.**
      **Reading 3 is the one that matters**: under the documented failure every window
      reports origin `{0,0}`, so every point resolves to the **first record** — and
      **readings 1 and 2 both PASS under that failure.** A false positive that looks
      exactly like a working feature.
      Record the raw `getBounds()` of both windows.
- [x] **V5 (GATE) — can `sendInputEvent` drive a synthetic cross-window drag, and does
      Chromium CLIP injected coordinates to the view bounds?**
      Inject a `mouseMove` with `x` beyond window A's viewport width into A's chrome.
      Read back `e.clientX` in A's renderer.
      **The falsifier**: if `e.clientX` reads ≤ viewport width, coordinates are clipped,
      **the synthetic cross-window path is dead**, and leg 6's spec cannot verify the
      cross-window half at all.
      **Discrimination**: an in-bounds injection must read back its exact `x` in the same
      run — otherwise a clipped reading is indistinguishable from a broken injector.
- [x] **V6 — `setPosition` placement, READ BACK.** Place a window at a known point; read
      the position back. **Do not assume the call worked** (DD4/DD10). Record whether the
      read-back matches, and by how much if not (the CSD shadow margin).
- [x] **V7 — does a DRAG-DRIVEN window activation deliver a real OS blur under WSLg,
      where a SCRIPTED `win.focus()` does not?**
      **The qualifier is load-bearing and the F7 debrief's gloss dropped it.** F6 spike
      verdict 4 says *"WSLg delivers no OS blur **to a scripted stimulus**"*; the debrief
      re-stated it as *"WSLg has no OS blur, and it's the only desktop"* — platform-
      permanent. The F7 flight log explicitly speculates a real human alt-tab **would**
      deliver blur.
      **Discrimination**: in the same run, show the blur listener firing for *some*
      stimulus (or prove no stimulus fires it). A silent listener and a real absence of
      blur read identically — that is exactly the DD7 gap's original sin.
      **Record the verdict with its scope. Do NOT inherit the accepted-gap ruling, and do
      NOT assume the gap is now reachable.** The ruling rests on **two independent**
      premises and F8 defeats only the structural one.
- [x] **V8 (GATE, ordered AFTER V2) — does crossing `#tabstrip-drag` hand the gesture to
      the OS window-move?**
      `#tabstrip-drag` is a `flex:1` spacer inheriting `-webkit-app-region: drag`, and it
      is what a torn-off tab must cross. Record `window.screenX` **before / during /
      after** the crossing.
      **V2 is the positive control**: a `window.screenX` that never updates reads
      **identically** to "the OS didn't take the gesture" — discrimination zero.
      **Predicted NEGATIVE**: `-webkit-app-region` hit-tests at **pointerdown**, and the
      drag arms on a `.tab`, which is `no-drag`. **The prediction does not discharge the
      verdict** — measure it. If POSITIVE, DD15's `no-drag` suppression becomes leg 3's
      work; if negative, leg 3 must NOT build it.

## Out of Scope

- Any product code. Any `src/` change. This leg **measures**.
- Fixing anything a verdict reveals — that is legs 3-5's work, scoped by these verdicts.

## Verification Steps

1. Every verdict carries its measurement, its **discrimination** (both directions, same
   run), its scope, and its falsifier.
2. A verdict that could not be measured is recorded **`UNMEASURED` with the reason** — not
   guessed, not inferred from typings, not carried over from recon.
3. Flight log updated; the flight's Adaptation Criteria consulted for every negative gate
   and the re-scope stated explicitly.

---

## Outcome (leg 2, landed)

All eight verdicts are **recorded** in the flight log under `### Leg 2 — Transport Spike` —
each with its reading, its discrimination (both directions, same run), its scope, and its
falsifier. **A ticked box above means the verdict was RECORDED, not that it was answered
positively.** Read the log before citing any of them.

| verdict | outcome |
|---|---|
| **V1** (gate) | **`UNMEASURED`** (real-OS half) — no injector reaches WSLg's RDP input path. Synthetic half positive. **HAT owns V1**; DD9 already concedes the apparatus cannot answer it. |
| **V2** | POSITIVE as specified — **and a false positive**: `screenX` and `getBounds` are the same cached value ±16. Zero discrimination. |
| **V3** | **CONFIRMED** — `getCursorScreenPoint()` → `{0,0}` at three distinct, independently-witnessed cursor positions. `dipToScreenPoint` identity reading is **UNDISCRIMINATED** (scale=1). |
| **V4** (gate) | **NEGATIVE in substance.** The three specified readings pass — against **fictional** rects. `getBounds` diverges from real geometry by **−363px at birth**. |
| **V5** (gate) | **POSITIVE** — coords are **not clipped** (binary: exact, or dropped). DD9's falsifier refuted; its unstated precondition (active drag session) named. |
| **V6** | **NEGATIVE** — `setPosition` is a no-op; the read-back DD4 mandates returns the cached write and **lies**. |
| **V7** | Drag-driven case **`UNMEASURED`**; but **WSLg DOES deliver real OS blur** — the F7 debrief's platform-permanent gloss is **refuted**. F6's qualifier confirmed intact. |
| **V8** (gate) | **`UNMEASURED`** — the positive control failed (synthetic input cannot trigger `-webkit-app-region`). **Both** spec-designated instruments (`screenX`, and V2 as its control) are **invalid**. |

**Central finding**: Electron's window coordinates on this rig are a **cached fiction** —
`setPosition` is a no-op, `getBounds`/`getPosition`/`window.screenX` echo Electron's own
bookkeeping, and **a real OS window move updates none of them and fires no event**. **DD1's
coordinate authority and DD3's hit-test both rest on it.** See the log's rulings section:
legs 3-5 do **not** proceed as designed; V5-positive does **not** rescue leg 6.

**Scope**: WSLg RAIL, Electron 42.6.1, `--ozone-platform=wayland`. **Not generalized to
native Wayland.**
