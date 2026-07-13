# Behavior Test: Per-Jar Data Controls

**Slug**: `jar-data-controls`
**Status**: active
**Created**: 2026-07-10
**Last Run**: 2026-07-13-15-09-25

## Intent

Verifies the jar-scoped data-clearing surface added by M06 Flight 4: granular clears
act on exactly the requested data class (cookie clear leaves site storage), stay
contained to the target jar (another jar's cookies survive), the full identity wipe
clears everything AND CLOSES the jar's open tabs (the `jar-wiped` broadcast sweep —
H6, M08 Flight 6 HAT: the sweep used to RELOAD matching tabs, which re-recorded a
fresh visit in the just-cleared history; it now CLOSES them instead, observed via
the tab's `wcId` disappearing from `enumerateTabs`), and the Burner identity plus
unknown ids are rejected (pinning the partition-less Burner identity shape — the
`jar-delete-closes-tabs` run-1 Validator carry-forward). Also pins burner STORAGE
isolation directly (cookie written in one burner tab not readable in another) —
closing the `popup-jar-inheritance` Validator carry-forward, which noted that only
partition NAMING distinctness was asserted. Real-environment behavior spanning the
twin-registered IPC handlers, Electron session storage, the broadcast path, and the
chrome renderer's close sweep — no unit seam covers the cross-process composition.

## Preconditions

- Goldfinch dev build launched against a **fresh scratch profile** (`XDG_CONFIG_HOME`
  pointed at an empty directory) with the automation surface enabled and keys minted:
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`
  (admin key required — the test evaluates inside tabs across jars).
- MCP client attached (bound port may be a free-port fallback — discover it).
- Fresh-profile seed is Personal (default) + Work. No other jars.
- A navigable http(s) URL that accepts JS-set first-party cookies (any stable public
  page; the URL is immaterial — only per-jar data state is asserted).

## Observables Required

- app tab/jar state (per-tab `jarId` + `wcId` — via the goldfinch MCP
  `enumerateTabs` tool)
- in-page script execution inside specific tabs (via the goldfinch MCP `evaluate`
  tool with the admin key: `document.cookie`, `localStorage`, window expandos)
- chrome-renderer jar data-control wrappers (via `getChromeTarget` + `evaluate` on
  `window.goldfinch.jarsClearData` / `jarsWipe` — same chrome-eval route as
  `popup-jar-inheritance` step 3)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Enumerate tabs (boot baseline). Open a tab via `openTab` with `jarId: "work"` at the fixture URL; record its `wcId`. Via `evaluate` on that tab: set `document.cookie = 'bt_probe=work1; path=/'`, `localStorage.setItem('bt_probe', 'work1')`, and `window.__bt_alive = 1`; read all three back. | All three values read back (`bt_probe=work1` in `document.cookie`, `work1` from localStorage, `1` from the expando) — the work jar is staged. |
| 2 | Open a tab via `openTab` with `jarId: "personal"` at the fixture URL; record its `wcId`. Via `evaluate`: set `document.cookie = 'bt_probe=personal1; path=/'` and `window.__bt_alive = 1`; read both back. | Both values read back — the personal jar is staged with its own cookie. |
| 3 | Via chrome-target `evaluate`: `window.goldfinch.jarsClearData({ id: 'work', classes: ['cookies'] })`. Then via `evaluate` on the work tab: read `document.cookie`, `localStorage.getItem('bt_probe')`, and `window.__bt_alive`. Via `evaluate` on the personal tab: read `document.cookie`. | The call resolves `{ ok: true, ... }`. Work tab: `document.cookie` no longer contains `bt_probe` (cookies cleared), localStorage still returns `work1` (class independence — storage untouched), `window.__bt_alive` is still `1` (granular clears do NOT reload). Personal tab: cookie still `bt_probe=personal1` (cross-jar containment). |
| 4 | Via chrome-target `evaluate`: `window.goldfinch.jarsClearData({ id: 'work', classes: ['storage'] })`. Via `evaluate` on the work tab: read `localStorage.getItem('bt_probe')`. | The call resolves `{ ok: true, ... }` and localStorage now returns `null` — the storage class cleared independently of the earlier cookie clear. |
| 5 | Via chrome-target `evaluate`: `window.goldfinch.jarsWipe({ id: 'personal' })`. Settle (~1-2s). Enumerate tabs. Attempt an `evaluate` against the personal tab's PRE-WIPE `wcId` (recorded in step 2). | The call resolves `{ ok: true }`. The enumeration no longer contains the personal tab's pre-wipe `wcId` — the tab was CLOSED, not reloaded (H6, M08 Flight 6 HAT — supersedes the earlier reload sweep: closing means no reload → no re-recorded visit → history stays cleared). The stale `evaluate` against the closed `wcId` errors/fails (no such WebContentsView) rather than reading a reloaded page's state. The wipe closes ALL of the personal jar's tabs — both the step-2 staged tab AND the personal boot tab (a personal-jar tab) — so the post-wipe enumeration retains only the WORK tab from step 1 (a different jar). (If the personal jar had been the ONLY jar with open tabs, `closeTab`'s last-tab fallback would open a fresh tab instead — not exercised here, since the step-1 WORK tab keeps the overall tab set non-empty.) |
| 6 | Via chrome-target `evaluate`, all four rejection combinations: `window.goldfinch.jarsWipe({ id: 'burner' })`, `jarsClearData({ id: 'burner', classes: ['cookies'] })`, `jarsWipe({ id: 'no-such-jar' })`, `jarsClearData({ id: 'no-such-jar', classes: ['cookies'] })`. Then `window.goldfinch.jarsList()`. | All four mutating calls resolve `{ ok: false }` — the Burner identity (no `partition` field) and unknown ids are rejected on BOTH channels. `jarsList()` still shows exactly Personal + Work, unchanged. |
| 7 | Open two burner tabs via chrome-target `evaluate`: `window.createTab('<fixture-url>', window.makeBurner())`, twice (both reachable via the evaluate-reachable seam renderer.js publishes on the chrome's global scope). Enumerate; record both `wcId`s and `jarId`s. Via `evaluate` on burner tab A: set `document.cookie = 'bt_burner=A; path=/'` and read it back. Via `evaluate` on burner tab B: read `document.cookie`. | Both tabs' `jarId`s match `^burner-\d+$` and differ from each other. Tab A reads back `bt_burner=A`; tab B's `document.cookie` contains NO `bt_burner` — burner tabs do not share storage (direct isolation pin, beyond partition naming). |

## Out of Scope

- HTTP-cache clearing (no cheap in-page observable; the `cache` class is unit-verified
  at the handler — it calls `clearCache` — per flight DD9).
- The management page's data-controls UI (confirms, nav tree, instant apply, focus
  preservation) — internal-page DOM is not automation-observable by design (DD9);
  operator-judged at the flight's HAT.
- Fingerprint-seed reroll observability (the persona is per-session in-memory state;
  reroll is unit-verified in the wipe handler's composition).
- Delete semantics (owned by `jar-delete-closes-tabs`) and default routing (owned by
  `new-tab-default-routing`).
- Automation-key survival across a wipe (key stays valid by design — DD3; Flight 5
  candidate for an explicit degradation test).

## Variants

None.
