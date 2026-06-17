# Leg: farbling-migration

**Status**: completed
**Flight**: [Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal](../flight.md)

## Objective
Migrate the `farbling-correctness` behavior-test spec's apparatus from `chrome-devtools` MCP `evaluate_script` attached to `:9222` to the **Goldfinch MCP `evaluate` tool evaluating in the guest main world** (where the farbling prototype hooks live), launched via `dev:automation` + a jar key — removing the spec's last `:9222` dependency and dogfooding the new eval tool on a real privacy-correctness assertion.

## Context
- **DD5 — farbling is (with the a11y gate) one of the two last `:9222` consumers; migrating it off is a prerequisite for `:9222` removal (leg 6).** This leg rewrites the spec's **apparatus** (transport/target/auth + the per-step Action wording); the *assertions* (navigator spoof = 8, canvas noise applied + stable + seed-dependent) are unchanged.
- **Guest main world is the right target.** The farbling hooks are installed as prototype patches inside the `<webview>` guest at document-start (`src/preload/webview-preload.js`); evaluating in the chrome shell would read unmodified real values. The Goldfinch `evaluate` tool runs in the **guest main world** (guests are `contextIsolation:false`), exactly where the hooks live — and the reads (`navigator.hardwareConcurrency`/`deviceMemory`, `canvas.toDataURL()`/`getImageData`) are JSON-serializable values returned directly by `evaluate` (no test-only seam), satisfying the tool's return contract.
- **Jar-key apparatus for the core reads (DD5).** A jar key authorizes driving that jar's own guest tabs — which is all the core reads (Steps 3-5) need, keeping them off the chrome surface. **The wrinkle is Step 6's seed reroll** (see DD-F): proving seed-dependence needs *two* distinct seeds, and the standard dev recipe mints only **one** jar key (`default`, `main.js:1038`) — so Step 6 needs an **admin** key (reaches both jars / drives chrome) or a manually-minted second jar key, regardless of which reroll path is chosen.
- **Depends on legs 1-2** (eval tool live). The leg-1 spike + leg-3 live a11y run already proved `evaluate` works on real guests.
- **This leg does NOT run the formal `/behavior-test farbling-correctness`** — that is leg 8 (verify-integration / DD9 dogfood). This leg rewrites the spec so it is *runnable on the new apparatus*; an optional live smoke (a few `evaluate` reads on a farbled guest) is encouraged to de-risk before leg 8, but the formal Witnessed/FD run is leg 8's.
- **`:9222` is NOT removed here** — leg 6. This leg makes farbling *stop depending on* `:9222`.

## Inputs
- `tests/behavior/farbling-correctness.md` (current, `Status: draft`): apparatus = `chrome-devtools` MCP `evaluate_script` attached to `:9222` (Observables `:23`, Preconditions `:16,19`, Step 1 `:31` probes `127.0.0.1:9222/json`); 7 steps; reads in the guest frame; Step 6 seed reroll via the chrome **New Identity** control; a **two-container cross-seed Variant** already offered (`:48`). *(NOTE: the current spec's Step 6 citations are stale — `renderer.js:1088` and `main.js:407-409,433` are wrong; correct them to the real locations below when rewriting that row.)*
- `src/renderer/renderer.js` — `newIdentity()` (`:1750`) → `tab.webview.reload()` (`:1756`) — the New-Identity reload (corrected citation).
- `src/main/main.js` — `rerollSeed` (`:806-808`), called from the `identity-new` handler (`:864`); `seedForSession` assigns a distinct per-session seed (`:797-808`); dev auto-mint of the `default` jar key (`:1038`), `AUTOMATION_DEV_MINT` stdout line (`:1042`).
- `src/preload/webview-preload.js` — farbling hooks: navigator spoof constants `8` (`:325,330`), per-`(seed,index)` canvas hash (`:241-246`), `SEED` captured at document-start (`:233`).
- `src/main/shields.js` — `shields.active('farble', site)` defaults `true` (`:16`).
- `src/main/automation/mcp-tools.js` — `evaluate` (`:343-360`) / `enumerateTabs` / `openTab` (jar-scoped: a jar key opens tabs only in its own jar, `:127-130`) shapes (post-legs 1-3).
- The dogfooding key recipe (legs 3 / F6-F7): `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` → `AUTOMATION_DEV_MINT {"key":…}` (the `default` jar key is always minted) → `Authorization: Bearer <key>`.
- `scripts/lib/mcp-client.mjs` (leg 3, new) — authenticated client helper, if any script-side smoke is wanted (the formal spec run uses the behavior-test crew's MCP apparatus, not this helper).
- Reference: an F6/F7-migrated spec (e.g. `tests/behavior/mcp-drive-end-to-end.md` or a Group-A spec reconciled to `$GOLDFINCH_MCP_PORT`) for the established migrated-apparatus wording + the readiness-probe pattern.

## Outputs
- `tests/behavior/farbling-correctness.md` rewritten onto the Goldfinch MCP `evaluate`-tool apparatus (guest main world, jar key) — no `:9222`, no `chrome-devtools` MCP.
- Spec remains `draft` (the formal run + promotion to `active` is leg 8 / the next-Electron-upgrade gate per the spec's own note).
- (Optional) a recorded live smoke of a few `evaluate` reads on a farbled guest, in the flight log.

## Acceptance Criteria
- [x] **AC1 — apparatus migrated, zero `:9222`/chrome-devtools.** The spec no longer references `:9222`, `--remote-debugging-port`, `--remote-allow-origins`, `chrome-devtools` MCP, or `evaluate_script`. Observables, Preconditions, and every Step's Action column use the **Goldfinch MCP `evaluate` tool** (and `enumerateTabs` for guest-wcId acquisition). `grep -ni "9222\|chrome-devtools\|evaluate_script\|remote-debugging" tests/behavior/farbling-correctness.md` returns nothing.
- [x] **AC2 — guest-target selection explicit.** The spec states the `evaluate` calls target the **guest `<webview>` wcId** (obtained via `enumerateTabs`, filtered to the jar's tab), NOT the chrome target — preserving the current "must select the guest, not the chrome shell" invariant.
- [x] **AC3 — assertions preserved.** Steps 3-7's *expected results* are unchanged in substance: navigator spoof returns `8`; canvas `A === A2` (stable within session); noise applied (non-trivial); seed-dependence (`B !== A`); optional farble-off control. Only the *Action* mechanics change (CDP → `evaluate`).
- [x] **AC4 — launch/auth recipe updated.** Preconditions describe `dev:automation` + the key(s) (via `AUTOMATION_DEV_MINT` — jar key for core reads, **admin for Step 6**), the endpoint at `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` (default `49707`, pin the var), the `Authorization: Bearer <key>` wiring, the fixture served over HTTP, and Shields `farble` active. Step 1's `:9222/json` probe is replaced by an **authenticated** MCP-surface readiness probe (an `initialize`/`tools/list` with the Bearer key attached — a keyless probe is a by-design 401, so "surface answers" means an authenticated handshake; assert `evaluate` is present, NOT an exact tool count) + the fixture HTTP 200.
- [x] **AC5 — seed-reroll path decided (DD-F).** Step 6 (seed-dependence) is rewritten to a path under the chosen key model, with the **admin-key (or 2nd-jar-key) precondition made explicit** (both paths need a 2nd seed → admin or a 2nd jar key; this is NOT a jar-key-only step). Recommended primary = two-container cross-seed (for determinism); New Identity kept as the Variant. Decision + rationale recorded.
- [x] **AC6 — spec validity + green gates.** The spec parses as a valid behavior-test spec per `.flightops/ARTIFACTS.md` (two-column Action | Expected table, Observables naming the apparatus). `npm test` + typecheck + lint stay green (this leg is spec-text; no source change expected — confirm no unit references the old apparatus).

## Verification Steps
- `grep -ni "9222\|chrome-devtools\|evaluate_script\|remote-debugging\|/json" tests/behavior/farbling-correctness.md` — nothing.
- `grep -ni "evaluate\|enumerateTabs\|dev:automation\|jar key\|guest" tests/behavior/farbling-correctness.md` — present.
- Spec shape: Observables name `evaluate` (Goldfinch MCP) + the apparatus that measures the chrome UI for the reroll path; Steps table intact; Out-of-Scope / Variants preserved.
- (Optional live smoke, if a display is available) `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, serve the fixture, attach a jar-key client, `evaluate(guestWcId, 'navigator.hardwareConcurrency')` → `8`; `evaluate(guestWcId, '<draw + toDataURL>')` twice → equal. Record in the flight log.
- `npm test`, `npm run typecheck`, `npm run lint` — green.

## Implementation Guidance

1. **DD-F — seed-reroll path for Step 6 (the design decision; corrected at design review).** The core reads (Steps 3-5) are jar-key-only on the guest. Step 6 (prove noise is seed-dependent) needs **two distinct seeds** — and **both** candidate paths need the **admin surface** (the dev recipe mints only the `default` jar key; a second seed requires admin to reach a second jar / drive chrome, or a separately-minted second jar key). So the choice is about **reliability, not auth cost**:
   - **(Recommended primary) Two-container cross-seed** (the spec's existing Variant): with an **admin** key (or a 2nd jar key), `openTab` the identical fixture in **two different jars** (distinct sessions → distinct seeds via `seedForSession`, `main.js:797-808`), draw the identical canvas in each, assert `toDataURL()` differs across them. **Deterministic** — no chrome-control driving, no New-Identity reload-timing window. Proves seed-dependence rigorously.
   - **(Alt / keep as Variant) Admin + chrome New Identity:** use the **admin** key to drive the chrome New Identity control (`newIdentity()` → `tab.webview.reload()`, `renderer.js:1750,1756`; reroll via `rerollSeed`, `main.js:806-808`, from the `identity-new` handler `main.js:864`), then re-read the guest after the reload settles. Tests the real "New Identity" UX the Intent emphasizes, but the reload-timing is fiddly/flakier.
   - **Recommendation:** two-container primary **for determinism** (NOT "no admin" — both need admin); keep New Identity as the documented Variant. **If avoiding admin is genuinely wanted**, note that a second jar key is mintable via the Settings automation UI (manual) — then two-container becomes pure-jar with two jar keys. Confirm at design review; record the choice + the admin/2nd-key precondition in the flight log.

2. **Observables Required** — rewrite to:
   - `browser (guest main-world JS values — navigator.hardwareConcurrency/deviceMemory, canvas.toDataURL()/getImageData — measured via the Goldfinch MCP **evaluate** tool on the guest <webview> wcId; the eval tool runs in the guest main world where the farbling hooks live)`.
   - If the New-Identity Variant is retained for chrome driving: `browser (chrome New Identity control — measured via the Goldfinch MCP admin surface: readAxTree/click)`.
   - `shell (readiness probes: MCP surface answers, fixture HTTP 200 — Bash/curl)`.

3. **Preconditions** — replace the `:9222`/`dev:debug` precondition with: app running via `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (jar key for the core reads; **`GOLDFINCH_AUTOMATION_ADMIN=1` too — Step 6 needs a 2nd seed → admin or a 2nd jar key**, regardless of reroll path), the key captured from the `AUTOMATION_DEV_MINT` stdout line; client connects to `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` (default `49707`) with `Authorization: Bearer <key>`; Shields `farble` active for the test origin (default `true`, `shields.js:16`); fixture served over HTTP at a known URL. Keep the "why HTTP not file://" rationale.

4. **Steps table** — rewrite the **Actions** column per step, preserving Expected Results:
   - Step 1: probe = **authenticated** MCP-surface handshake (`initialize`/`tools/list` over `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` with `Authorization: Bearer <key>` — a keyless probe is a by-design 401, so attach the key) + fixture HTTP 200, replacing the `:9222/json` curl. Assert presence of the `evaluate` tool, NOT an exact tool count. Pin `$GOLDFINCH_MCP_PORT` (default `49707`) and reuse it in every URL — matching the F6/F7-migrated specs.
   - Step 2: open + navigate the fixture in a jar's tab (via `openTab`/`navigate` MCP tools or operator setup); confirm farble active. Acquire the guest wcId via `enumerateTabs`.
   - Steps 3-5: `evaluate(guestWcId, '<expression>')` for the navigator reads and the canvas draw+`toDataURL()`/`getImageData` reads. The draw must be self-contained in the `evaluate` expression (define + draw + read in one expression, or `injectScript` a draw helper then `evaluate` the read).
   - Step 6: per DD-F (two-container primary): open the fixture in a second jar, draw the identical canvas, `evaluate` its `toDataURL()` as `B`, assert `B !== A`; navigator stays `8` in both.
   - Step 7 (optional control): farble-off → real navigator value + un-noised canvas.

5. **Keep** Intent, Out-of-Scope, and the (now-swapped) Variants section coherent. Update the Intent's apparatus sentence ("via `ipcRenderer.sendSync('shields-farble', …)`" stays — that's the mechanism under test; only the *measurement* apparatus changes). Update the draft note if it references `dev:debug`.

6. **Status** — leave `Status: draft`. The formal run + promotion to `active` is leg 8 / the next-Electron-upgrade gate (per the spec's own promotion note). Update `Last Run` only if you do the optional live smoke (and even then it's not the formal run).

## Edge Cases
- **Canvas draw inside `evaluate`** — the whole draw+read must happen in the guest (so the farbling hooks apply). Define the canvas, draw, and read `toDataURL()` within a single `evaluate` expression (returns the data-URL string, JSON-serializable). Re-running the identical expression must yield the identical string within a session (the stability assertion).
- **`getImageData` size** — return a small sampled subset (not the full pixel array) to stay comfortably JSON-serializable and within sane payload sizes.
- **Two-container seed distinctness** — ensure the two jars genuinely have distinct seeds (different containers → different per-jar seed); if the fixture is opened in the same jar twice, seeds match and `B === A` (false negative). Make the two-jar setup explicit.
- **`goldfinch://settings` / internal session** — not involved here (the fixture is a normal HTTP origin in a web jar). No internal-exclusion concern.
- **Spec is project-owned** — this is a sanctioned apparatus migration the flight explicitly calls for (DD5); editing the spec body is in-scope. Do not couple to other specs' counts.

## Files Affected
- `tests/behavior/farbling-correctness.md` — apparatus migration (Observables, Preconditions, Steps Actions, Variants swap); assertions preserved; status stays `draft`.
- (No source changes expected. Confirm no unit test references the old `:9222`/chrome-devtools farbling apparatus.)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to flight end per `/agentic-workflow`.)*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` + typecheck + lint)
- [x] Update flight-log.md with leg progress entry (DD-F decision + optional smoke result)
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
