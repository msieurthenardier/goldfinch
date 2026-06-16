# Leg: settings-cleanup

**Status**: completed
**Flight**: [Chrome-driving affordance + behavior-spec dogfooding (scoped)](../flight.md)

## Objective
Consolidate the two independent `automationListKeys()` calls the settings page fires on load (one per IIFE) into a single shared page-scope fetch, distributed to both consumers — one fewer IPC round-trip, and a consistent snapshot across both.

## Context
- **DD6** (flight; F5 review cleanup): `src/renderer/pages/settings.js` has two IIFEs that each call `bridge.automationListKeys()` on load — the **key-management** IIFE (via `refresh()`, settings.js:547-552) and the **activity-viewer** IIFE (settings.js:600, seeding the `jarNames` id→name map). Two IPC round-trips for the same data; non-blocking debt flagged in the F5 review.
- **The correctness nuance**: the key-management `refresh()` is called not only on load (settings.js:580) but **also after mint/revoke** (settings.js:559, 565), where it MUST re-fetch fresh data (a key was just added/removed). So only the **initial load** should share a cached fetch — `refresh()` itself must keep re-fetching. The consolidation memoizes the *first* fetch only.
- Pure renderer-side cleanup, no behavior change for the operator — independent of the chrome-drive spike; last leg in the autonomous-first batch.

## Inputs
- `src/renderer/pages/settings.js`:
  - Key-mgmt IIFE (opens ~line 419, closes ~581): `refresh()` (547-552) calls `automationListKeys()` → `renderJars(jars)` (defined ~479) + `renderAdmin(adminEnabled, adminKeySet)` (defined ~533); on-load call at 580 (`refresh().catch(()=>{})`). **`refresh()` has FOUR call sites — all must keep re-fetching fresh**: **jar** mint (~507) + **jar** revoke (~519) inside `renderJars()` closures, and **admin** mint (~559) + **admin** revoke (~565). Only the on-load call (580) is consolidated.
  - Activity-viewer IIFE (~line 585-…): seeds `jarNames` from `automationListKeys()` at 600-609, then re-renders `lastSnap` if present.
  - Both IIFEs guard on `window.goldfinchInternal` and their own DOM elements; `bridge = window.goldfinchInternal`.
- `src/renderer/renderer-globals.d.ts:109` — `automationListKeys()` return type `{ jars: Array<{id,name,color,hasKey}>, adminEnabled, adminKeySet }`.

## Outputs
- A single page-scope memoized initial fetch (e.g. `automationKeysOnce()`) shared by both IIFEs' on-load paths; only **one** `automationListKeys()` IPC fires on page load.
- `refresh()` (key-mgmt) still re-fetches fresh on mint/revoke — unchanged behavior there.
- Both on-load consumers render from the **same** snapshot (consistency bonus).
- No operator-visible behavior change; typecheck + lint green.

## Acceptance Criteria
- [x] **AC1 (single on-load fetch)** — On settings-page load, `bridge.automationListKeys()` is invoked **exactly once** (shared between the key-mgmt initial render and the activity-viewer `jarNames` seed), down from twice. Implemented as a page-scope memoized promise both IIFEs consume for their initial fetch.
- [x] **AC2 (refresh still re-fetches)** — The key-mgmt `refresh()` continues to fetch **fresh** state every time it is called — from **all four** mint/revoke handlers (jar mint ~507, jar revoke ~519, admin mint ~559, admin revoke ~565), NOT the memoized initial promise — so a newly minted/revoked key is reflected. The memoization covers ONLY the initial on-load fetch (line ~580).
- [x] **AC3 (activity-viewer behavior preserved)** — The activity viewer still seeds `jarNames` (id→name) from the shared fetch and re-renders `lastSnap` once names load; the friendly-jar-name fallback to raw jarId is unchanged.
- [x] **AC4 (guards preserved)** — Both IIFEs keep their `window.goldfinchInternal` + DOM-element guards; the shared helper is null-safe when the bridge is absent (settings page rendered outside the genuine internal origin → no throw).
- [x] **AC5** — `npm run typecheck` + `npm run lint` pass; `npm test` unaffected (no main-process/unit surface touched — settings.js is renderer-only, verified live in the HAT/leg 7).

## Verification Steps
- AC1/AC2: read the consolidated code — confirm one memoized initial fetch feeds both IIFEs, and `refresh()` still calls `bridge.automationListKeys()` directly (fresh) on mint/revoke.
- AC3/AC4: confirm `jarNames` seeding + `lastSnap` re-render preserved; both guards intact; helper handles `!window.goldfinchInternal`.
- AC5: `npm run typecheck && npm run lint && npm test`. (settings.js has no offline unit harness — runtime behavior re-confirmed in the leg-7 verify / leg-8 HAT.)

## Implementation Guidance
1. **Add a page-scope memoized accessor** above both IIFEs (module scope of settings.js), e.g.:
   ```js
   // DD6 (Flight 6): one shared on-load fetch of automation key state, consumed by BOTH the
   // key-management and activity-viewer IIFEs (was two IPC round-trips). Memoizes the FIRST
   // call only — refresh() after mint/revoke still fetches fresh (it must reflect a new key).
   let _automationKeysOnce = null;
   function automationKeysOnce() {
     const bridge = window.goldfinchInternal;
     if (!bridge) return Promise.resolve(null);            // null-safe off-origin (AC4)
     if (!_automationKeysOnce) _automationKeysOnce = bridge.automationListKeys();
     return _automationKeysOnce;
   }
   ```
2. **Key-mgmt IIFE**: split the DOM work from the fetch. Keep `refresh()` doing a **fresh** `bridge.automationListKeys().then(render…)` (unchanged — mint/revoke rely on it). Change ONLY the **on-load** path (line ~580) from `refresh()` to consume the shared fetch:
   ```js
   // on load — use the shared single fetch (AC1); reveal stays hidden
   clearReveal();
   automationKeysOnce().then((info) => { if (info) { renderJars(info.jars); renderAdmin(info.adminEnabled, info.adminKeySet); } }).catch(() => {});
   ```
   (Extract the two render calls — they're already `renderJars` / `renderAdmin`. Do NOT route the initial load through `refresh()` anymore, or it re-fetches.)
3. **Activity-viewer IIFE**: replace the direct `bridge.automationListKeys()` at line 600 with `automationKeysOnce()`; keep the `info && Array.isArray(info.jars)` guard and the `lastSnap` re-render:
   ```js
   automationKeysOnce().then((info) => {
     if (info && Array.isArray(info.jars)) { for (const j of info.jars) jarNames.set(j.id, j.name); }
     if (lastSnap) renderActivity(lastSnap);
   }).catch(() => {});
   ```
4. **Null-safety (AC4)**: `automationKeysOnce()` returns `Promise.resolve(null)` when `!window.goldfinchInternal`, so the `if (info)` / `if (info && …)` guards in both consumers handle the off-origin case (matching today's early-return behavior — no throw). The IIFEs keep their own `if (!window.goldfinchInternal) return;` guards too (defense-in-depth; they also guard DOM elements).
5. **Do not** change `refresh()`'s signature or the mint/revoke flows — they must keep re-fetching.

## Edge Cases
- **Mint/revoke after load**: `refresh()` re-fetches fresh (NOT the memoized promise) — a new/removed key shows correctly (AC2). The memoization is initial-load-only.
- **Bridge absent (off-origin)**: `automationKeysOnce()` resolves `null`; both consumers no-op via their `if (info)` guards. No throw.
- **Activity-viewer mounts but key-mgmt didn't (or vice-versa)**: whichever calls `automationKeysOnce()` first creates the memoized promise; the other reuses it. If only one mounts, it still gets its single fetch. Order-independent.
- **`lastSnap` arrives before names**: unchanged — the post-fetch `if (lastSnap) renderActivity(lastSnap)` re-render still picks up the friendly names (AC3).

## Files Affected
- `src/renderer/pages/settings.js` — add the memoized `automationKeysOnce()`; route both IIFEs' on-load fetch through it; leave `refresh()` (fresh-fetch) and mint/revoke flows unchanged.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] `npm run typecheck` + `npm run lint` + `npm test` green
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md (at flight commit)
- [ ] Batched flight — do NOT commit per-leg

## Citation Audit
Source citations verified against current code at leg design time (2026-06-15), corrected per design review: `settings.js:547-552` (`refresh()` → `automationListKeys`); **all FOUR `refresh()` call sites** — jar mint ~507, jar revoke ~519 (inside `renderJars()`), admin mint ~559, admin revoke ~565 — plus the on-load call ~580 (the only one consolidated); `settings.js:600-609` (activity-viewer seed). Key-mgmt IIFE opens ~419 (not ~460 as first drafted). Return-type `renderer-globals.d.ts:109` confirmed. settings.js has no offline unit-test harness (renderer page) — runtime verification is the leg-7 verify / leg-8 HAT.

**Design-review note (2026-06-15)**: approve-with-changes — the [MED] finding (jar-level `refresh()` sites at :507/:519 were under-cited) is incorporated above; the implementer must leave **all four** mint/revoke flows on the fresh `refresh()` path and consolidate only the on-load fetch. HMR question (reviewer): the settings page is a full page-load (no HMR in this app), so `_automationKeysOnce` resets on every real reload — stale-memo across a perceived-fresh load is not a risk.
