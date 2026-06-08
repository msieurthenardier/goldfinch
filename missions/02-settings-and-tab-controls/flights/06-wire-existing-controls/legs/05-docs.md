# Leg: docs

**Status**: completed
**Flight**: [Wire Existing Controls (Shields + Home Page) into Settings](../flight.md)

## Objective
Document what Flight 6 added: the durable/secure **settings store**, the **origin-checked internal bridge**
(real IPC now — and the security model that gates it), the **home-page setting**, and **Shields-in-settings**
— in `README.md` (user/contributor) and `CLAUDE.md` (architecture/patterns). Symbols/DD ids, no line numbers.

## Context
Flight 6 (legs 1–4) added, on top of the Flight-5 settings shell:
- **`src/main/settings-store.js`** (leg 1) — durable, schema-versioned, atomic, validated preferences store
  in `userData/settings.json`; Electron-free + injected path; pluggable `{serialize,deserialize}` seam
  (future safeStorage). Holds `homePage`.
- **`src/main/internal-ipc.js`** (leg 2) — `isTrustedInternalSender(origin, isInternalSession)` +
  `registerInternalHandler` (main-side `event.senderFrame.origin === 'goldfinch://settings'` + internal-session
  check; rejects otherwise). `internal-preload.js` exposes `window.goldfinchInternal` (settingsGet/Set,
  shieldsGet/Set, onSettingsChanged/onShieldsChanged) guarded by `location.origin`. **This closes the
  Flight-4/5 internal-bridge Known Issue.**
- **Home page** (leg 3) — `HOMEPAGE` promoted to the store value (live cache + race-safe initial tab); chrome
  `settings-get` channel; `broadcastToChromeAndInternal` fan-out; editable validated control in settings.
- **Shields-in-settings** (leg 4) — global toggles in the settings Privacy & Shields section via the bridge;
  `shields-changed` now fans out to both the chrome panel and the settings guest (two-way sync). Per-site
  pause stays in the panel.

## Acceptance Criteria
- [ ] `CLAUDE.md` documents: (a) the **settings store** (`settings-store.js` — durable/atomic/validated/
  schema-versioned, `userData/settings.json`, the future-safeStorage seam); (b) the **internal-bridge
  security model** — `internal-ipc.js`'s `registerInternalHandler` main-side origin+session check as the
  authoritative boundary, the preload `location.origin` defense-in-depth, the **separate internal-* vs chrome
  shields-* trust domains**, and that the **Flight-4/5 internal-bridge Known Issue is now CLOSED** (real IPC
  is gated); (c) the home-page setting + `broadcastToChromeAndInternal` two-audience fan-out.
- [ ] `README.md` mentions (user/contributor altitude): the Settings page now has **working** Privacy &
  Shields toggles + an editable **Home page**, persisted and consistent with the Shields panel.
- [ ] References use **symbols / DD ids**, not line numbers. No operator identity / absolute home paths.
- [ ] The CLAUDE.md "Internal-tab navigation lock" Flight-6-TODO note (added Flight 5) is **updated** to
  reflect that the origin-check **landed** in Flight 6 (the lock's companion security gate now exists).
- [ ] `npm run lint` stays green. Docs only — no source/behavior changes.

## Verification Steps
- `git diff` shows only `README.md` / `CLAUDE.md`.
- Read both: the four areas are accurate vs landed code; the Known-Issue-closed + origin-check-landed updates
  are present; symbol references resolve (`settings-store.js`, `internal-ipc.js`, `registerInternalHandler`,
  `broadcastToChromeAndInternal`, `goldfinchInternal`).
- `npm run lint` green.

## Implementation Guidance
1. **CLAUDE.md** — extend the internal-`goldfinch://`-pages / patterns area: add the settings-store model and
   the internal-bridge security model (the `registerInternalHandler` boundary + the two trust domains). Find
   the Flight-5 "Internal-tab navigation lock — security-critical bridge origin-check remains a Flight-6 TODO"
   note and **update it**: the origin-check now exists (`internal-ipc.js`), so internal pages' privileged IPC
   is gated; the navigation lock is the UX half, this is the security half — both now present.
2. **README** — in Features / the settings/internal-pages area, note the Settings page's now-working Shields
   toggles + editable home page (persisted, consistent with the panel). Keep it user-facing and brief.
3. Symbols + DD ids; no line numbers; repo-relative paths only.

## Edge Cases
- **Don't overstate**: per-site Shields pause is still panel-only (settings has the global toggles).
- **Security accuracy**: the origin-check is the authoritative boundary (main-side); the preload guard is
  defense-in-depth — state both, don't imply the preload guard alone secures it.

## Files Affected
- `README.md` — settings controls (Shields + home page) now working (user-facing).
- `CLAUDE.md` — settings store, internal-bridge security model, home-page setting, Known-Issue-closed update.

---

## Post-Completion Checklist
- [ ] All acceptance criteria verified
- [ ] `npm run lint` green
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
