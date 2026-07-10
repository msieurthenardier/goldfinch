# Leg: main-retirement-sweep

**Status**: completed
**Flight**: [Default-Jar Semantics](../flight.md)

## Objective

Retire the main process's reserved-default assumptions: delete `PAGE_PARTITION` and
its pre-warm/fallback/spellcheck uses (DD5), make the three privacy handlers strictly
per-tab (DD4), resolve the dev auto-mint target through the default flag (DD7), and
migrate the literal-default fixture text in the affected docs and behavior specs.

## Context

- **DD4**: privacy handlers answer "this tab's jar" — a missing/destroyed
  `webContents` returns the channel's empty/failure value; `privacy-clear-storage`
  today *always* acts on the legacy partition (a real cross-jar bug for non-legacy
  tabs) and gains `webContentsId`.
- **DD5**: the `session-created` hook (main.js:2405-2424) already applies Shields +
  download handling + spellcheck to every web session at first creation, and the
  spellcheck toggle's `getAllWebContents()` sweep (main.js:1638-1645) covers live
  sessions — so the pre-warm and the toggle's legacy-partition apply are redundant.
  Verified premise: the jars.js legacy probe rests on on-disk history, not the
  runtime pre-warm.
- **DD7**: auto-mint mints for the resolved default jar; Burner-default → skip the
  jar mint with one parseable stderr notice, surface still binds, admin mint
  unaffected. Behavior-spec fixtures that hardcode the mint target migrate to
  resolved-default phrasing (Architect review cycles 1+2).
- Leg 1 landed (uncommitted, deferred review): renderer routes through the flag,
  `DEFAULT_CONTAINER` gone, suite at 1142. **Leg 1 shifted renderer.js line numbers —
  renderer.js citations below are snippet-anchored, not line-anchored.** main.js is
  untouched by Leg 1; its line citations remain exact.
- Leg 1 design review carry-forward: `tests/behavior/settings-automation.md` Step 8
  anchors on "the `default` jar row" as a UI fixture — joins the spec-text sweep
  (assessed at this leg's design: it is NOT auto-mint-dependent; light-touch
  generalization only).

## Inputs

- Branch `flight/02-default-jar-semantics` with Leg 1 landed (uncommitted).
- jars.js lifecycle API (`getDefault`, `list`) loaded in main.js; `BURNER` constant
  at src/shared/burner.js (CJS export).
- `mintJarKey(jarId, settings, jars)` / `mintAdminKey(settings)` (main.js:2529-2530;
  guard refusing unknown/burner ids at mcp-server.js:870).

## Outputs

- `src/main/main.js` — no `PAGE_PARTITION`; per-tab privacy handlers; resolved
  auto-mint. Net-negative lines except the mint resolution.
- `src/shared/automation-dev.js` — new pure `resolveAutoMintTarget(jars)` helper
  (unit seam for the DD7 decision) + tests in its existing test file.
- `src/renderer/renderer.js` — one-line payload change (`privacyClearStorage`).
- `docs/mcp-automation.md` — auto-mint + default-container prose rewritten.
- Behavior-spec text migrations (no reruns this leg): `automation-key-gating.md`,
  `mcp-jar-scoping.md`, `mcp-auth-gating.md`, `farbling-correctness.md`,
  `settings-automation.md` (Step 8 fixture wording), `spellcheck.md` (Intent prose).
- README.md / CLAUDE.md swept for stale base-partition/pre-warm claims (update only
  if a claim is now false).
- Suite (>1142) + typecheck + lint green.

## Acceptance Criteria

- [x] `grep -rn "PAGE_PARTITION" src/ test/` → 0 matches.
- [x] `grep -n "'default'" src/main/main.js` → 0 matches.
- [x] `privacy-cookies` and `privacy-clear-cookies` return their empty/failure shapes
      (`{ firstParty: null, first: 0, third: 0, total: 0, list: [] }` /
      `{ removed: 0 }`) when the `webContentsId` resolves to no live `webContents` —
      no `session.fromPartition` fallback anywhere in the three handlers.
- [x] `privacy-clear-storage` resolves `wc.session` from a `webContentsId` payload
      field (renderer passes `tab.wcId`) and returns `{ ok: false, error: 'no-tab' }`
      when it resolves to no live `webContents`; the `url`-origin scoping behavior is
      unchanged on the happy path.
- [x] whenReady no longer creates/pre-warms any jar session; `session.defaultSession`
      wiring (main.js:2433-2435) is untouched.
- [x] Spellcheck toggle applies to `session.defaultSession` + the
      `getAllWebContents()` sweep only (legacy-partition line gone); the
      session-created comment trail still explains coverage for not-yet-created jar
      sessions.
- [x] Auto-mint: `resolveAutoMintTarget(jars)` returns the default jar's id, or
      `null` when Burner holds the flag (id-comparison against `BURNER.id`); main.js
      mints for the resolved id, and on `null` prints exactly one stderr line
      `[mcp] dev auto-mint skipped: default is Burner (no persistent jars)` while
      still printing the parseable `AUTOMATION_DEV_MINT { key: null, adminKey }`
      stdout line (admin mint behavior unchanged). Unit tests pin the helper's truth
      table.
- [x] docs/mcp-automation.md: no claim that auto-mint targets the literal `default`
      jar; the fresh-install "INTERIM GAP" language is gone; the omitted-`jarId`
      `openTab` row documents "current default jar (a fresh burner tab when Burner
      holds the flag)" with the admin-only scope note.
- [x] Behavior-spec text migrations done: no spec precondition asserts the auto-mint
      provisions the literal `default` jar; `mcp-jar-scoping.md`/`mcp-auth-gating.md`
      mint-target references say "the resolved-default jar" and their preconditions
      add "verify (or set) that `personal` holds the default flag" where staged
      `personal` fixtures depend on the mint; `settings-automation.md` Step 8/
      key-row references generalize to "a persistent jar row"; `spellcheck.md` Intent
      prose no longer names `PAGE_PARTITION`. Staged-tab jar choices stay `personal`
      (deliberate fixtures).
- [x] `npm test` green (count strictly > 1142), `npm run typecheck` green,
      `npm run lint` green.

## Verification Steps

- Run the two greps; run `timeout 120 npm test`, `npm run typecheck`, `npm run lint`.
- `node -e "const a=require('./src/shared/automation-dev');const {BURNER}=require('./src/shared/burner');console.log(a.resolveAutoMintTarget({getDefault:()=>({id:'personal'})}), a.resolveAutoMintTarget({getDefault:()=>BURNER}))"`
  → `personal null`.
- `grep -rn "default. jar\|jar .default\|\`default\`" tests/behavior/*.md` →
  inspect every hit: none may assert that the auto-mint provisions, or a fixture
  requires, the literal reserved `default` jar (pattern deliberately broad — the
  narrower phrase-grep missed `farbling-correctness.md`'s "`default` jar key"
  wording; design review cycle 1). Mentions of the *migrated legacy jar named
  `default`* as one possible flag-holder are fine. Matches inside run logs under
  `tests/behavior/*/runs/` are historical records — exempt, do not edit them.
- Real-boot confirmation of the privacy panel and auto-mint is Leg 3's job.

## Implementation Guidance

1. **`resolveAutoMintTarget` helper** — add to `src/shared/automation-dev.js`
   (Electron-free, already has a test file):
   ```js
   const { BURNER } = require('./burner');
   /** @param {{ getDefault: () => { id: string } }} jars */
   function resolveAutoMintTarget(jars) {
     const d = jars.getDefault();
     return d && d.id !== BURNER.id ? d.id : null; // id-compare — same discipline as DD3
   }
   ```
   Export alongside the existing exports; extend the existing automation-dev unit
   file with the truth table (default jar → its id; BURNER sentinel → null;
   burner-id-shaped object → null).

2. **Auto-mint block** (main.js:2527-2537): resolve first, then branch:
   ```js
   if (shouldAutoMint(process.argv, process.env)) {
     try {
       const target = resolveAutoMintTarget(jars);
       if (target === null) console.error('[mcp] dev auto-mint skipped: default is Burner (no persistent jars)');
       const key = target === null ? null : mintJarKey(target, settings, jars);
       const adminKey = process.env.GOLDFINCH_AUTOMATION_ADMIN ? mintAdminKey(settings) : null;
       process.stdout.write('AUTOMATION_DEV_MINT ' + JSON.stringify({ key, adminKey }) + '\n');
     } catch (err) {
       console.error('[mcp] dev auto-mint failed:', err && err.message);
     }
   }
   ```
   Require the helper from `../shared/automation-dev` next to the existing
   `shouldAutoMint` import (grep for it). Rewrite the comment block
   (main.js:2506-2526): the "Mints for the literal jar id 'default' … INTERIM GAP:
   M06 Flight 2 retires this" bullet becomes a description of resolved-default
   behavior + the Burner-skip contract; keep the double-gate and
   least-privilege bullets.

3. **Privacy handlers** (main.js:2352-2400):
   - `privacy-cookies`: replace the `const ses = wc ? wc.session : session.fromPartition(PAGE_PARTITION);`
     with `if (!wc) return { firstParty: null, first: 0, third: 0, total: 0, list: [] }; const ses = wc.session;`
   - `privacy-clear-cookies`: same pattern, `if (!wc) return { removed: 0 };`
   - `privacy-clear-storage`: payload becomes `{ url, webContentsId }`; resolve
     `const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;`
     (the exact idiom of its two siblings, main.js:2353); `if (!wc) return { ok: false, error: 'no-tab' };`
     then `await wc.session.clearStorageData({ origin })` inside the existing
     try/catch. Keep the origin derivation and return shapes otherwise unchanged.
   - **Internal-session guard (design review cycle 1 — MEDIUM)**: after resolving
     `wc`, all three handlers must refuse an internal-session target — the privacy
     panel can stay open across a switch to the internal Settings tab
     (`els.togglePrivacy.disabled` only gates opening; `renderPrivacy()` doesn't
     disable the Clear buttons), and `privacy-clear-storage` never touched `wc`
     before this leg, so the reachability is NEW here. Use the codebase's canonical
     discriminator: `if (/** @type {any} */ (wc.session).__goldfinchInternal) return <that handler's failure shape>;`
     (same flag the session-created hook and the spellcheck sweep use,
     main.js:2412/:1642). Apply to all three for consistency.
   - Renderer call site (renderer.js, snippet-anchored:
     `await window.goldfinch.privacyClearStorage({ url: tab.url })`) → add
     `webContentsId: tab.wcId`. The preload wrapper passes payloads through
     unchanged (chrome-preload.js:33) — no preload edit.

4. **Pre-warm removal** (main.js:2436-2439): delete the `pageSession` block
   (`const pageSession = session.fromPartition(PAGE_PARTITION);` + the three apply
   lines). `grep -n "pageSession" src/main/main.js` — expect exactly ONE other hit
   (design review cycle 1 — MEDIUM): the session-created hook's defensive-read
   comment at main.js:2420 ("whenReady re-applies the correct state to
   defaultSession/pageSession after stores load anyway") — reword it to
   defaultSession-only. Leave the `session.defaultSession` lines (:2433-2435)
   exactly as-is.
   Add a brief comment where the block was, or extend the session-created hook
   comment, stating jar sessions (including the migrated legacy jar) get
   Shields/downloads/spellcheck at first `session-created` — no pre-warm needed
   since routing goes through the default flag (M06 F2 DD5).

5. **Spellcheck toggle** (main.js:1633-1646): delete
   `applySpellcheck(session.fromPartition(PAGE_PARTITION), enabled);` (:1637) and
   reword the "Base web sessions (always present)" comment (:1635) — only
   `defaultSession` is unconditionally present now. The existing premise comment
   (:1624-1632) stays.

6. **Constant deletion** (main.js:65): delete `const PAGE_PARTITION = 'persist:goldfinch';`
   after steps 3-5 remove all uses; run the grep AC.

7. **docs/mcp-automation.md**: rewrite :124-127 (the `key` bullet: minted for the
   resolved default jar — the flagged jar; on a profile with no persistent jars the
   jar mint is skipped with a stderr notice and `key` is `null`; drop the
   "Fresh-install gap (interim, M06 F1)" block); adjust :60-62 (pick-a-jar guidance:
   the auto-mint follows the default flag — `default` on migrated profiles until the
   operator moves it, `personal` on fresh installs); update :363's omitted-`jarId`
   parenthetical ("open in the default container" → "open in the current default jar;
   a fresh evaporating burner tab when Burner holds the flag — admin identity only;
   a jar key's omitted `jarId` still forces that key's own jar"). Grep the doc for
   any other literal-`default` mint claims.

8. **Behavior-spec text migrations** (text-only; do NOT touch files under
   `tests/behavior/*/runs/`):
   - `automation-key-gating.md`: Preconditions bullet (:38-47) and Steps 1/2/6 —
     replace "the **`default`** jar" mint-target/fixture language with "the
     resolved-default jar (the jar `jarsGetDefault()` reports; the legacy `default`
     jar on this migrated dev profile unless the flag has been moved)"; the
     precondition gains an explicit "record which jar holds the default flag; the
     spec's jar-row references mean that jar".
   - `mcp-jar-scoping.md` (:24, :36, :55, :59 and any other mint-target mentions):
     the mint provisions the resolved-default jar; add to Preconditions: "verify (or
     set via `jarsSetDefault`) that `personal` holds the default flag before launch —
     the staged in-jar fixtures below assume the minted key is `personal`'s". Staged
     `personal`/`work` tab fixtures stay as-is.
   - `mcp-auth-gating.md` (:40, :66-67): same treatment ("mints a jar key for the
     resolved-default jar; this spec's Run B assumes `personal` holds the flag —
     verify or set it").
   - `settings-automation.md` Step 8 (and its Step-2 kebab row if it names
     `default`): "find the `default` jar row" → "find a persistent jar row with no
     key (on this dev profile e.g. the legacy `default` jar)" — pure fixture
     generalization, the step's mint/revoke assertions are row-relative already.
   - `farbling-correctness.md` (:16, design review cycle 1 — HIGH; a recon miss,
     same defect class as the three specs above): "the **`default`** jar key
     authorizes the core reads… mints only the one `default` jar key" → the
     resolved-default jar's key, with the same "record which jar holds the flag"
     precondition note. Draft spec, not run this flight — text-only.
   - `spellcheck.md` Intent (:25): "across `defaultSession` + `PAGE_PARTITION` +
     every live web jar" → "across `defaultSession` + every live web jar session,
     never the internal session (jar sessions get the setting at creation via the
     session-created hook)".
   - Migration-strategy note (deliberate, so review doesn't flag inconsistency):
     `automation-key-gating.md` gets exhaustive rewording (its steps assert on the
     mint-target row itself); `mcp-jar-scoping.md`/`mcp-auth-gating.md`/
     `farbling-correctness.md` keep their pervasive staged-`personal`/`default`
     fixture mentions and instead gain the single verify-or-set-the-flag
     precondition that makes those mentions true by construction.
   - Update each spec's `Status`/staleness only if the file carries a
     last-verified marker — do not bump `Last Run`.

9. **README.md / CLAUDE.md sweep**: `grep -n "persist:goldfinch\|base partition\|pre-warm" README.md CLAUDE.md docs/*.md`
   — update any sentence that states the app pre-warms the base partition or that
   the `default` jar is always present. Comment-accuracy only; do not restructure.

## Edge Cases

- **Destroyed-tab race**: `webContents.fromId` returns `null`/destroyed contents for
  a just-closed tab — all three handlers take the failure branch; the renderer
  privacy panel renders an empty/failed state rather than operating cross-jar (DD4
  trade-off, accepted at flight design).
- **`wc.isDestroyed()` between resolve and use**: the existing handlers already
  tolerate this via their try/catch (clear-storage) or would throw into the invoke
  rejection (cookies) — match the siblings' current posture; do not add new
  try/catch beyond what exists (keep the diff minimal). If the Developer finds the
  cookies handlers can reject on a destroyed session, containing that with the
  same failure shapes is in-scope.
- **Empty-registry launch under `dev:automation`**: jar mint skipped (stderr
  notice), `key: null` in the stdout line, admin key still minted when
  `GOLDFINCH_AUTOMATION_ADMIN=1` — the MCP surface binds regardless (mint has no
  enable side-effect; enablement is the dev override). Leg 3 proves this live.
- **Migrated profile where the operator already moved the flag**: auto-mint follows
  the flag (that is the feature); the spec-text migrations make the three
  auto-mint-dependent specs state that dependency instead of assuming a literal id.

## Files Affected

- `src/main/main.js` — :65, :1633-1646, :2352-2400, :2436-2439, :2506-2537
- `src/shared/automation-dev.js` + its unit test file — new helper + truth table
- `src/renderer/renderer.js` — `privacyClearStorage` payload (snippet-anchored)
- `docs/mcp-automation.md` — :60-62, :124-127, :363, sweep
- `tests/behavior/automation-key-gating.md`, `mcp-jar-scoping.md`,
  `mcp-auth-gating.md`, `settings-automation.md`, `spellcheck.md` — text-only
- `README.md` / `CLAUDE.md` — only if the sweep finds stale claims

---

## Citation Audit

main.js citations verified this session against `d1e6be0` (main.js untouched by
Leg 1): :65 — `const PAGE_PARTITION = 'persist:goldfinch';`; :1633-1646 — spellcheck
toggle incl. :1637 legacy apply; :2352-2400 — three privacy handlers (fallback idiom
`wc ? wc.session : session.fromPartition(PAGE_PARTITION)` at :2354/:2372; clear-storage
always-legacy at :2395); :2405-2424 — session-created hook; :2433-2439 — defaultSession
wiring + pre-warm block; :2506-2537 — auto-mint comment block + `mintJarKey('default', settings, jars)`
at :2529. chrome-preload.js:33 pass-through wrapper. Behavior-spec citations
(automation-key-gating.md:38-47/:71-76; mcp-jar-scoping.md:24/:36/:55/:59;
mcp-auth-gating.md:40/:66-67; settings-automation.md Step 8; spellcheck.md:25)
verified by direct read this session. renderer.js `privacyClearStorage` call
snippet-anchored (line drifted by Leg 1). 0 gone, 0 unverifiable; 1 drifted-and-
re-anchored (renderer.js call site).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (suite + typecheck + lint)
- [x] Update flight-log.md with leg progress entry (append-only)
- [x] Set this leg's status to `landed` (deferred-review mode: `completed` at the
      flight-level commit)
- [x] Do NOT commit — the flight uses a single deferred review + commit
