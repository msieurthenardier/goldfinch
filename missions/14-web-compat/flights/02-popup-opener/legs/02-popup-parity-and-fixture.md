# Leg: popup-parity-and-fixture

**Status**: landed
**Flight**: [Popup & Opener Ruling + Implementation](../flight.md)

## Objective

Make popups first-class for challenges and agents per DD1a/DD1b — challenge-store popup contract, census rows, jar addressability — and prove the OAuth flow end to end with the fixture behavior spec.

## Context

- Leg 01 landed the mechanics: popup registry (`src/main/popup-registry.js`: `getByWcId`/`isPopupWcId`/`listForRecord`/`rekeyForRecord`/`closeAllForRecord`, entries `{popupWcId, openerWcId, openerRecord, partition, win}`, tolerated-dead `openerWcId`), the stub cancel seam (`main.js:1073 — "cancelChallengesForPopup: () => {}"`), guest discipline, close handling. 3025 tests green.
- DD1b names the store-contract changes (design-review walls): routing (popup → opener's record), **eligibility** (`presentNext`'s `c.wcId === record.activeTabWcId` test at `auth-challenges.js:150` can never match a popup), **presentation** (`chromeForTab(popup)` misses), popup-destroyed cancel. Leg-01 seam note: eligibility must tolerate a dead `openerWcId`.
- DD1a addressability: `resolve.js:98/141` refuses non-`isTabViewWcId` wcIds for jar keys before session identity matters; widen with the popup predicate honoring `scope.js`'s three-place registration discipline (comment at `:45-49`).
- Census: `enumerateTabs` assembles from chrome round-trips (engine `:57`) — popups are chrome-invisible, so popup rows come from the main-side registry; `enumerateWindows` is main-side topology (engine `:62`) — gains popup entries. Jar-visibility: popup rows visible to a jar key iff the popup's captured partition matches (same rule as tabs); window topology stays admin-only.
- DD4: fixture spec's core observables are jar-runnable page-DOM reads; census assertions are admin-tier and join the Flight 3 bundle if the run-time key is jar-scoped.

## Inputs

- Branch `flight/02-popup-opener` with leg 01 landed (uncommitted); 3025 tests green.
- Fixture server `tests/behavior/fixtures/web-compat/serve.mjs` (extended by three legs already; README lists endpoints).

## Outputs

- Challenge-store popup contract (kind-agnostic: applies to basic-auth AND client-cert challenges arriving from popup contents)
- `cancelChallengesForPopup` real wiring (replaces the main.js stub; DD1f order preserved)
- Census: `enumerateWindows` popup entries; `enumerateTabs` popup rows (jar-filtered by main-side **jarId mapping** per guidance #4 — never a partition-string filter); addressability widening in `resolve.js` + engine deps
- Fixture: `/oauth/opener.html` + `/oauth/popup.html` (postMessage round-trip, self-close, `#result` seam; JSONL logging)
- New behavior spec `tests/behavior/web-compat-oauth-popup.md` (status `active` on landing)
- Docs: `docs/mcp-automation.md` popup addressability/census semantics; README popup note
- Unit matrices + gates green

## Acceptance Criteria

- [x] A challenge from a popup's contents enqueues on the popup's **owning record** (registry-first routing in `handleLogin`/`handleSelectClientCertificate`); presentation resolves the **owning window's chrome**; sheet copy carries a popup marker
- [x] Eligibility: a popup challenge is eligible when its owning window has no other presented challenge and the standard sheet/fullscreen eligibility holds — **independent of `activeTabWcId`, of the opener tab's liveness, and of popup occlusion** (dead-`openerWcId` case unit-pinned). *This is a DD1b refinement (flight-logged per the disposition-axis precedent): DD1b's "opener tab is active" eligibility rule is replaced — a popup is a floating always-visible surface and the tolerated-dead-`openerWcId` seam forces independence.*
- [x] Popup destroyed with challenges queued/presented → resolve-cancel via the real `cancelChallengesForPopup` (DD1f order: cancels precede destroys; stub replaced; order unit-pinned)
- [x] Every DD2 bucket behavior applies to popup challenges (parametric matrix extension — occlusion re-present, fail-safe cancel, window-teardown cancel, **navigation-away cancel**, **re-key cancel**)
- [x] Jar-key addressability: `click`/`typeText`/`evaluate`/`vaultFill` etc. work on a popup wcId whose partition matches the key's jar; foreign-jar popups refused; internal never applicable (popups are never internal by DD3) — `resolve.js` widening + engine dep threading unit-pinned per the three-place discipline
- [x] `enumerateTabs` (jar key): popup rows appear with a `popup: true` marker and correct jar filtering; `enumerateTabs`/`enumerateWindows` (admin): popups across all jars; `enumerateWindows` popup entries carry `openerWindowId`
- [x] `vaultAnswerAuth` answers a basic-auth challenge on a popup wcId (origin-matched against the challenge URL; kind filter still excludes cert challenges)
- [x] Behavior spec `web-compat-oauth-popup` authored per ARTIFACTS.md format: fixture OAuth flow — popup opens (real window), opener handle live, token delivered to `#result`, popup self-closes, focus/opener state sane; census steps marked admin-tier; spec `active`
- [x] `timeout 300 npm test`, lint, typecheck green

## Verification Steps

- Extended `auth-challenges.test.js` popup matrix; new/extended `resolve.test.js`, engine/census suites; full gates
- Fixture endpoints curl-verified; behavior run FD-owned post-landing (core steps jar-runnable per DD4)

## Implementation Guidance

1. **Store contract** (`src/main/auth-challenges.js`): thread `popupRegistry` in. Routing ladder gains registry-first lookup (before `getWindowForGuest`). Challenge records gain `isPopup: true`; the challenge lives in its owning record's queue as today. **Re-key ruling (FD): cancel-on-rekey** — the `moveTabIntoWindow` re-key hook additionally calls `cancelForTab(popupWcId, 'moved')` for the moved opener's popups, byte-consistent with the store's existing cross-window-move contract for tabs (`'moved'` reason at `:284`); no state-map reshaping, no migration seam. The no-hung-callback property across a re-key is unit-pinned. `presentNext` eligibility becomes: next = first queued challenge that is (tab challenge with `wcId === activeTabWcId`) OR (`isPopup` — popup challenges are eligible independent of `activeTabWcId`, of opener-tab liveness, **and of popup window occlusion/minimization** (the sheet renders on the owner window, which is what the user interacts with)); presentation for popup challenges uses `record.chromeView.webContents` directly (guarded — the record is in hand); sheet payload gains `popup: true` for the marker copy (template model tweak only — no new sheet; DD5 respected). **Navigation-away**: popup wiring (leg-01's slim variant in `guest-wiring.js`) gains `did-start-navigation` → `cancelForTab(popupWcId, 'navigated')` — DD2's max-staleness contract must hold for popups.
2. **`cancelChallengesForPopup(popupWcId)`**: thin delegation to `cancelForTab(popupWcId, reason)` — it already handles queue scan, exactly-once resolution, and the visible-sheet close via `AUTH_MENU_TYPES` (the popup's sheet lives on the owning record). Replace the main.js stub; DD1f order already pinned in `closeAllForRecord`.
3. **Addressability** (`src/main/automation/resolve.js`): membership rides the **existing session-identity check untouched** — the popup's session IS the interned opener-jar session, so `resolveContentsForJar`'s `wc.session === fromPartition(...)` comparison already passes (do NOT add any partition-string comparison — the module's DD7 discipline forbids it; the captured partition is census-only). The only resolve-side change: the `:141` refusal widens to "not a tab AND not a popup → refuse" via an injected `isPopupWcId`. **Dual injection sites**: thread the new deps at BOTH `main.js:867` and `app-lifecycle.js:211`, grep-pinned per the engine's silent-fallback dual-injection discipline (`listWindows` precedent, engine `:57-61`). Update the `scope.js` three-place-discipline comment if it enumerates predicates.
4. **Census**: `src/main/window-census.js` (the pure `enumerateWindows` backing — zero-state, live-registry reads) gains popup entries `{popupWcId, openerWindowId, url, title}`; `tabs.enumerateTabs` merges main-side popup rows via an injected `listPopups`-style dep (conditional-spread, absent → no rows, grep-pinned at both injection sites). Row shape matches tab rows (`{wcId, url, title, jarId, active: false, windowId (owner's), popup: true}`); **jarId mapped main-side from captured partition via `jars.list()`**; jar tier filters on `jarId` exactly as tab rows do. **Burner-opened popups**: burner partitions aren't in the jar registry → jarId unmappable → admin-only visibility — pinned as intended.
5. **Fixture + spec**: opener/popup pages under `/oauth/`; opener button triggers `window.open('/oauth/popup.html','oauth','width=420,height=520')`; popup posts `{token}`, waits for `{ack}`, self-closes; opener writes token to `#result` and acks. JSONL logs page hits. Behavior spec rows: open opener → click → popup appears (admin census step marked; jar path asserts via opener-side `window.open` return + `.closed` transitions) → token in `#result` → popup closed → (admin) census clean after close. Author per ARTIFACTS.md spec format; `Cache: cold`.
6. **Docs**: `docs/mcp-automation.md` — popup rows/addressability semantics + admin-vs-jar census note; README — one-line popup feature note (OAuth popups work).

## Edge Cases

- Two popups from one opener, both with challenges: FIFO on the owning window's single queue; one sheet at a time.
- Popup challenge queued, opener tab moved cross-window: **cancel-on-rekey** (`'moved'`, tab parity) — no strand, no migration; the page re-challenges on next request (unit-pinned: no hung callback across a re-key).
- Popup navigates away with a challenge pending: `did-start-navigation` cancel (DD2 max-staleness holds for popups).
- Popup closes itself while its challenge is presented: `cancelChallengesForPopup` resolves; sheet closes with a resolution-family reason.
- Jar key enumerates while a foreign-jar popup exists: row absent (filter pinned).
- `vaultAnswerAuth` on a popup with no challenge: `{answered:false, reason:'no-challenge'}` (existing contract holds).

## Files Affected

- `src/main/auth-challenges.js`, `src/main/guest-wiring.js` (popup `did-start-navigation` cancel), `src/main/register-tab-ipc.js` (re-key cancel call in `moveTabIntoWindow`'s hook, `:390` region — synchronous), `src/main/main.js` (stub replacement + dep threading at `:867`), `src/main/app-lifecycle.js` (second engine-deps injection site, `:211`), `src/main/automation/resolve.js`, `src/main/automation/tabs.js` (row merge), `src/main/window-census.js` (popup entries), `src/main/automation/mcp-tools.js` (descriptions incl. `activateTab(popup)` → false and no-`raiseWindowForTab` notes), `src/main/automation/scope.js` (comment only, if predicate list enumerated)
- Audit `tests/behavior/popup-jar-inheritance.md` (predates leg 01 — if its fixture uses features/named-target opens, its deny-convert premise broke; update or annotate)
- `src/shared/auth-basic-template.js` / `cert-picker-template.js` model tweak for the popup marker (copy only)
- `tests/behavior/fixtures/web-compat/serve.mjs` + README; `tests/behavior/web-compat-oauth-popup.md` (new)
- `docs/mcp-automation.md`, `README.md`
- Test suites: `auth-challenges.test.js`, `resolve`/engine/census suites, template tests

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header — `completed` follows the FD's flight close, batched workflow)
- [x] Check off this leg in flight.md
- [ ] Final leg: flight.md → landed handled by FD at flight close (batched workflow)

## Citation Audit

Verified at design time (grep, post-leg-01): `auth-challenges.js:144/150` (`presentNext` + eligibility find), `:188` (`handleLogin`), `:286` (`cancelForTab`), `:469/490` (`getPendingChallenge`); `resolve.js:98` (`resolveContents` deps), `:141` (refusal); engine header `:57-64` (census assembly + `enumerateWindows` accessor notes); `main.js:1073` (`cancelChallengesForPopup` stub); `scope.js:45-49` (three-place discipline comment). All OK.
