# Leg: multi-hold

**Status**: completed
**Flight**: [Identity Fill and Capture](../flight.md)

## Objective

Let one tab hold a pending capture per FAMILY instead of one per tab, release
them all at settle, and queue the resulting offers serially in the chrome —
including the locked-vault unlock-to-save path, where a scalar currently drops
every offer but the last. Proven with **login + card only**; identity does not
exist yet.

## Context

- **Flight DD1**, including its design-review amendment (the two-queue
  requirement and the unlock-prompt-once rule). Read DD1 in full before starting.
- Leg 1 landed: both sheet templates now dispatch by type, and `renderer.js` sits
  at 1550/1550. **This leg adds no renderer.js lines** — all chrome work lands in
  `vault-controller.js`, which has no budget.
- **2 unproven adversarial axes**: the re-key itself, and the locked-mode
  pending-unlock queue.

### ⚠ How this leg differs from Leg 1 on test edits

Leg 1's AC9 made "an existing assertion had to change" a failure signal. **That
does not apply here.** This leg deliberately changes a function's return
contract (`captureRelease`), so tests asserting the OLD contract must change —
that is the interface change landing, not a regression. The discipline instead:
every such edit is a contract update with the same assertion strength, never a
loosened or deleted assertion. If a test can only be made to pass by asserting
LESS than it did, stop and report.

## Inputs

- `src/main/vault/vault-human.js` — **FOUR** family-blind supersession loops
  (`capture` `:430-432`, `holdGestureLogin` `:509-511`, `holdGestureCard`
  `:562-564`, and — found at design review, missed by this leg's first draft —
  **`captureCard` `:765-767`**, which uses `prior.wcId === wcId` rather than
  `rec.wcId === wcId`, which is why a `rec.wcId`-shaped grep missed it);
  `captureRelease`
  (`:607`, returns the FIRST pending-settle record or null); the three
  family-blind bulk drops (`dropCapturesForTab` `:1024`, `dropCapturesForWindow`
  `:1046`, `dropAllCaptures` `:1064`).
- `src/main/guest-wiring.js:739` — navigation-commit settle, consumes one offer.
- `src/main/register-browser-ipc.js:228-236` — detachment settle, consumes one
  offer.
- `src/renderer/chrome/vault-controller.js` — `pendingCaptureId` /
  `pendingCaptureUnlock` scalars (`:66-70`), `onVaultCaptureOffer` (`:303`),
  `onVaultLockState`'s continuation (`:344-360`), `openCaptureSheet` (`:112`),
  `handleClosed`'s `vault-capture` branch (`:640`).
- `src/preload/webview-preload.js:499-524` — ONE `watchedGestureFields` array and
  ONE `gestureDetachObserver`; `armGestureDetachWatch` replaces the array
  wholesale and early-returns if the observer exists.
- Existing consumers of `captureRelease`: `test/unit/guest-wiring.test.js`,
  `test/unit/register-browser-ipc.test.js`, `test/unit/vault-gesture-capture.test.js`
  (30 references total). Chrome-side: `test/unit/vault-controller-capture.test.js`.

## Design Decision (leg-scoped)

**LD1 — The detach watch becomes PER-FAMILY; the settle IPC stays payload-free
and tab-scoped.** This settles the flight's open question.
- Today one gesture arms one field set; a second gesture on the same tab replaces
  the array wholesale (`watchedGestureFields = fields.filter(Boolean)`) and
  early-returns on the existing observer — so under multi-hold the FIRST family's
  detach signal is silently lost.
- **Decision**: keep a `Map<kind, fields[]>` of watched sets; the single
  MutationObserver fires `guest-vault-gesture-settle` when **any one set** is
  fully detached, and that set is then cleared. The IPC stays a bare,
  payload-free trigger and main keeps releasing **every** pending record for the
  tab.
- **Rejected: adding a `kind` to the settle payload.** It would let main release
  only that family, but it makes a guest-supplied value steer which held record
  is released, against the channel's own documented "main derives the trusted
  wcId from `event.sender.id`; no payload" shape. The gain does not justify
  re-opening that.
- **Named cost, accepted**: one family's fields detaching releases the sibling
  family's hold slightly early, so an offer may appear for a form still on
  screen. That is **wrong-moment** (DD4's budget), never wrong-value — the values
  are still the operator's own, still provenance-gated, and nothing is written
  without an explicit yes.

**LD2 — An occlusion-class close drops the whole queue, matching what already
happens to the head offer.** Today a blur / tab-switch close of an open
`vault-capture` sheet already dismisses its held record (`handleClosed` dismisses
on every reason except `superseded` and `activated`). So the operator alt-tabbing
away ALREADY loses the offer in front of them. Extending that to the queued
siblings is consistent, leaves no orphaned queue entry that nothing will ever
advance, and needs no new re-presentation machinery. The alternative — leaving
them queued for some later resolution-class event — invents a deferred-offer
lifecycle this flight has no other use for, and would leave held secrets alive
chrome-side with no visible surface. **Cost, named**: an alt-tab mid-offer now
costs N dismissals instead of 1. Main's `CAPTURE_DROP_MS` and the bulk drops
would have reclaimed them anyway; this just makes it immediate and explicit.

## Acceptance Criteria

- [x] **AC1 — Supersession is family-scoped, at ALL FOUR loops.** A single
      `familyOf(rec)` helper (`rec.kind` defaulting to `'login'` — matching how
      card records already stamp `kind: 'card'` and login records omit it) is
      used by every supersession loop, which evict only same-family records for
      the wcId. The four loops are `capture` `:430-432`, `holdGestureLogin`
      `:509-511`, `holdGestureCard` `:562-564`, and **`captureCard` `:765-767`**.
      Pinned: a login hold and a card hold coexist on one tab; a SECOND login
      gesture evicts only the login record and leaves the card record intact.
- [x] **AC1b — The `captureCard` loop specifically, because it is the one that
      would have shipped the bug this leg exists to fix.** Design review walked
      AC3's scenario with `:765-767` left family-blind and found it defeats the
      whole leg: `capture`/`captureCard` have **no callers anywhere in `src/`
      outside `captureRelease`** (verified), so every card release re-enters that
      loop — where it finds the login offer `capture()` created moments earlier
      in the same synchronous pass, and zeroizes it. With the gesture order
      reversed it kills the still-*pending* login record even earlier. Fix:
      scope it to `familyOf(prior) === 'card'` (`captureCard` only ever creates
      card records). **Pinned by its own test**, distinct from AC3's: release a
      login-then-card pair AND a card-then-login pair, and assert both offers
      survive in both orders.
- [x] **AC2 — `captureRelease(wcId)` returns an ARRAY.** `[]` when nothing is
      pending (the common case), otherwise one entry per released record, in
      `captures` Map insertion order (gesture order). Each entry keeps today's
      `{ captureId, model }` shape. A record whose disposition yields no offer is
      simply absent from the array, exactly as it returns null today.
- [x] **AC3 — `captureRelease`'s own re-entry cannot evict its sibling.** It
      calls `capture`/`captureCard` per record, and those re-run the supersession
      loop; with AC1's family scope a card release can no longer evict a pending
      login record mid-loop. Pinned by a test that releases two families in one
      call and asserts BOTH offers come back.
- [x] **AC4 — Both settle call sites iterate.** `guest-wiring.js`'s
      `did-navigate` and `register-browser-ipc.js`'s `guest-vault-gesture-settle`
      each send one `vault-capture-offer` per returned entry, preserving order.
      The existing `vaultTrace` calls stay, reporting the count.
- [x] **AC5 — The chrome presents offers SERIALLY, through ONE advance point.**
      A single presentation queue in `vault-controller.js`: the first offer opens
      its sheet; each subsequent one waits until the current `vault-capture`
      sheet actually closes (`handleClosed`) before opening. Offer B never
      model-replaces offer A. Pinned: two offers pushed back-to-back open exactly
      one sheet; the second opens only after the first closes.
- [x] **AC5b — There is exactly ONE `advance()` function; it is IDEMPOTENT and
      SELF-GUARDING, and it has THREE callers.** Contract: a locked-mode entry,
      once `vaultCaptureFinalize` resolves it into a real model, is **pushed onto
      the SAME presentation queue** — so the "separate arrays" language refers
      only to the *unfinalized* locked half. `advance()` returns immediately if a
      `vault-capture` sheet is already open (`sheetOpen` flag); otherwise it
      shifts the presentation queue and opens; if that queue is empty and locked
      entries remain, it finalizes the next one (routing a no-offer result
      through `reportNoCaptureOffer`) and recurses.
      **⚠ CORRECTED at design review round 2 — my round-1 fix was unsatisfiable.**
      It said `advance()` is called "from `handleClosed`'s `vault-capture` branch
      and from nowhere else". Verified false in two ways: (a) a SUCCESSFUL unlock
      closes the **`vault-unlock`** sheet, not `vault-capture`
      (`vault-controller.js:604-606` says so in as many words), so that branch
      never fires for it and the locked drain could never START; (b) a fresh
      already-unlocked offer arriving while idle has no sheet to close either.
      Restricting CALLERS was the wrong mechanism. **Safety comes from the
      `sheetOpen` no-op guard inside `advance()`**, which makes extra callers
      harmless. The three callers are:
      1. `handleClosed`'s `vault-capture` branch — **resolution-class reasons
         only** (AC5c);
      2. `onVaultLockState`'s unlock-success continuation — starts the drain;
      3. `onVaultCaptureOffer`'s already-unlocked branch — opens immediately when
         idle.
- [x] **AC5c — `advance()` runs ONLY on resolution-class close reasons, never on
      occlusion-class ones.** The codebase already owns this vocabulary:
      `auth-challenges.js` buckets every close reason into **resolution**
      (escape / outside-click / activated / tab-close, plus the fail-safe
      default) versus **occlusion** (blur / superseded / tab-hide / tab-switch —
      "the challenge re-presents later"). Apply the same split here.
      **Why this is not theoretical** (design review round 2, verified):
      `vault-capture` is DELIBERATELY absent from
      `VAULT_BLUR_SURVIVAL_MENU_TYPES` (`src/shared/vault-blur-survival.js:24`
      names it as an explicit exclusion), and `register-tab-ipc.js` closes any
      open sheet unconditionally on `tab-set-active` / `tab-hide`. The existing
      branch guards only `reason !== 'superseded'`, so blur, tab-switch,
      tab-hide and teardown all reach it. With `advance()` sitting there
      unfiltered, alt-tabbing away would pop the NEXT save-password sheet open on
      an unfocused window, and a tab switch would pop it open over whatever tab
      the operator just moved to (the queue is chrome-wide, not tab-scoped).
- [x] **AC5d — An occlusion-class close DISMISSES the remaining queue rather than
      orphaning it (LD2).** See LD2 below. Pinned: a blur with two offers queued
      dismisses both captureIds and leaves the queue empty; nothing re-opens
      later.
- [x] **AC6 — The locked-mode path uses an ARRAY, not a scalar.**
      `pendingCaptureUnlock` becomes a list. Every locked-mode offer appends.
      A successful unlock drains it **serially** — each `vaultCaptureFinalize`
      resolving, and its sheet closing, before the next is finalized — with each
      per-offer failure routed through the existing `reportNoCaptureOffer`
      rather than aborting the drain. Pinned: **two** locked-mode offers, one
      unlock, **both** reach a sheet.
- [x] **AC7 — The unlock prompt opens ONCE per drain.** The second and later
      locked-mode offers append without re-calling
      `openOverlayMenu('vault-unlock', …, { keepFocus: true })`. Pinned by
      asserting the open count is 1 for two offers.
- [x] **AC8 — An abandoned unlock drops EVERY queued record.** The unlock sheet
      dismissed while still locked dismisses all queued captureIds, not just the
      last. Pinned.
- [x] **AC9 — `pendingCaptureId` stays a scalar, and stays correct.** Serial
      presentation means at most one `vault-capture` sheet is open, so the
      dismiss-drop path needs no change in shape. `handleClosed`'s
      `reason !== 'superseded'` carve-out must still hold for a genuine
      same-family model-replace. Pinned: closing a sheet dismisses the record it
      was showing, and then presents the next queued offer.
- [x] **AC10 — Per-family detach watch (LD1), EXTRACTED into a pure,
      injected-deps module.** The kind-keyed arm/clear/fire state machine moves
      into its own `require()`-able module (suggested
      `src/preload/vault-gesture-detach-watch.js`) taking an injected
      `MutationObserver` constructor and an injected `onSettle` callback, so it
      unit-tests under `node --test` against plain `{ isConnected }` stand-ins.
      `webview-preload.js` keeps only the thin real-DOM + `ipcRenderer` wiring.
      **⚠ CORRECTED at design review — the first draft resigned this to a
      grep-AC.** It is true that `webview-preload.js` cannot be `require()`d
      under `node --test` (it `require('electron')` at `:10` and has top-level
      `window.addEventListener` calls), but the LOGIC touches only
      `MutationObserver` and `.isConnected` — neither Electron-specific, both
      trivially injectable. CLAUDE.md names Electron-free injected-deps modules
      the DEFAULT for exactly this class, and `vault-entry-tracker.js` is the
      standing precedent for this same preload/DOM boundary. This is one of the
      leg's two unproven axes, which makes it the worst possible candidate for
      "verify by reading".
- [x] **AC10b — The extracted watch is unit-tested**: arming two kinds keeps both
      sets; one set fully detaching fires settle exactly once and clears only
      that set; the sibling set stays armed and fires on its own later
      detachment; a partially-detached set does not fire.
- [x] **AC11 — The drop rules still cover every record.** The three bulk drops
      are already family-blind and need no change — pin that explicitly with a
      test asserting a lock / tab close / window close drops BOTH families' held
      records for the tab, and that each record's own `CAPTURE_DROP_MS` timer
      still fires independently.
- [x] **AC12 — No identity anywhere.** `grep -rn "identity" src/main/vault/vault-human.js
      src/renderer/chrome/vault-controller.js src/preload/webview-preload.js`
      returns nothing new from this leg.
- [x] **AC12b — `captureRelease`'s loop stays fully SYNCHRONOUS end to end** (no
      `await` between records). AC3's correctness argument — that family-scoping
      alone prevents cross-family eviction — depends on there being no
      interleaving opportunity for an external bulk-drop (lock / tab close /
      window close) mid-loop. True today; stated so a later refactor cannot
      quietly break it.
- [x] **AC13 — Contract-update discipline.** Every edited existing test asserts
      the NEW contract with the same strength as before (an array of one where it
      asserted an object; a count where it asserted a singleton). No assertion is
      deleted or weakened. Report the before/after count of assertions in the
      three affected test files.
- [x] **AC13b — `eslint.config.mjs` gains the new module** (design review round
      2, verified empirically by the reviewer with a throwaway probe file):
      `eslint.config.mjs` has NO `src/preload/**` wildcard — only explicit
      `files:` lists — so a new `require()`-able CJS module under `src/preload/`
      falls through to the flat-config default `sourceType: 'module'` and fails
      `npm run lint` with `'module' is not defined  no-undef`. Add
      `src/preload/vault-gesture-detach-watch.js` to the existing
      CJS-required-by-the-preload `files:` array. **This is the load-bearing
      block CLAUDE.md flags** — keep the module out of any later `src/shared/**`
      ESM binding.
- [x] **AC14 — Gates clean**: `npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check`. `renderer.js` still 1550 and both line-count pins
      still match (this leg must not touch it).

## Verification Steps

- AC1/AC3/AC11: new unit tests in `test/unit/vault-gesture-capture.test.js`.
- AC2/AC4: updated `guest-wiring.test.js` / `register-browser-ipc.test.js`.
- AC5/AC6/AC7/AC8/AC9: new + updated tests in
  `test/unit/vault-controller-capture.test.js`.
- AC10/AC10b: a real unit-test file for the extracted
  `src/preload/vault-gesture-detach-watch.js`, driven with an injected
  `MutationObserver` constructor and plain `{ isConnected }` stand-ins — the
  `vault-entry-tracker.js` injected-deps precedent. *(This bullet previously
  described a grep-AC and a "not directly reachable" limitation; that was the
  pre-amendment framing AC10 was corrected away from, and leaving it here left
  two contradictory instructions in one document. Design review round 2 caught
  the stale text.)* Only the thin real-DOM + `ipcRenderer` wiring left in
  `webview-preload.js` stays unit-unreachable; say that precisely in the flight
  log, rather than the whole feature.
- AC12: the stated grep, compared against the **baseline count of 4**, not
  against empty — `card-identity` (an import), "PAN identity" and
  "node-identity-crosses-the-boundary" (comments) already match `identity` in
  these three files on a clean tree. The AC asks for "nothing NEW".
- AC14: run all four gates, plus
  `node -e "console.log(require('fs').readFileSync('src/renderer/renderer.js','utf8').split(/\r?\n/).length)"`
  → 1550.

## Implementation Guidance

1. **Main first, chrome second.** `vault-human.js`'s `familyOf` + the three
   supersession loops + `captureRelease`'s array return, with its tests green,
   before touching either settle site or the chrome.
2. **`captureRelease`'s aliasing hazard is already solved and must stay solved** —
   it copies each record's secret Buffer(s) BEFORE `dropCapture`, because
   `dropCapture` zeroizes. With a loop, do the copy per record, inside the
   iteration, and never hold a reference to a dropped record's Buffer.
3. **Iterate over a SNAPSHOT of the pending records**, not the live `captures`
   Map — the loop body drops and re-adds entries, and mutating a Map mid-iteration
   is how this class of loop goes subtly wrong.
4. **Chrome queue shape**: one presentation array of `{ captureId, model }` plus
   a boolean for "a capture sheet is currently open", and one array of
   *unfinalized* locked captureIds. `handleClosed`'s `vault-capture` branch calls
   `advance()`, and `advance()` is the ONLY place a sheet is opened from a queue
   — never a timer, never the activation path, or two sheets race open.
5. **The two arrays are NOT two advance points** (AC5b). A locked entry, once
   finalized, is pushed onto the presentation array and travels the same path as
   any other offer. `advance()`'s order: presentation queue first; if empty and a
   locked drain remains, finalize the next locked entry and recurse.

## Edge Cases

- **A lock DURING a serial drain.** `captureFinalize` re-checks `isUnlocked()`
  and returns `{ reason: 'locked' }`; the drain must report via
  `reportNoCaptureOffer` and continue rather than throwing.
- **A tab closing mid-queue.** `dropCapturesForTab` drops the held records;
  queued offers whose records are gone resolve to `{ saved:false }` /
  `{ reason:'expired' }` on interaction. Ensure a queued offer for a dead tab
  cannot open a sheet indefinitely — drain it through the same no-offer report.
- **Two gestures of the SAME family in a row.** Unchanged behaviour: last wins,
  the earlier record is evicted and zeroized.
- **A record that disposes to null** (unchanged login / unchanged card) is absent
  from `captureRelease`'s array — it must not occupy a queue slot or block the
  sibling offer.
- **Two kinds' field sets detaching in ONE MutationObserver callback** (a
  whole-page teardown removing a login form and a card form at once): both sets
  fire; a redundant `guest-vault-gesture-settle` is a harmless main-side no-op
  (the second finds nothing pending). Cover it with an explicit AC10b case.
- **A lock landing while an already-unlocked offer is mid-presentation.**
  `dropAllCaptures()` invalidates the held records main-side while they are still
  queued chrome-side. The queued entries must degrade through the existing
  no-offer reporting on interaction, never open a sheet backed by a dropped
  record. (`closeMenuOverlay('vault-lock')` already force-closes vault sheets —
  that close is occlusion-class-adjacent and must NOT advance, per AC5c.)
- **`vaultTrace` calls** are diagnostic; keep them, but they must not log a
  secret or a captureId count that implies one.

## Files Affected

- `src/main/vault/vault-human.js` — `familyOf`, three supersession loops,
  `captureRelease`
- `src/main/guest-wiring.js` — settle site iterates
- `src/main/register-browser-ipc.js` — settle site iterates
- `src/renderer/chrome/vault-controller.js` — both queues, `onVaultCaptureOffer`,
  `onVaultLockState` drain, `handleClosed` advance
- `src/preload/webview-preload.js` — per-kind detach watch (LD1)
- `src/preload/vault-gesture-detach-watch.js` — **new** (AC10)
- `eslint.config.mjs` — CJS `files:` entry for the new module (AC13b)
- `test/unit/vault-gesture-capture.test.js`, `guest-wiring.test.js`,
  `register-browser-ipc.test.js`, `vault-controller-capture.test.js`, plus a new
  test file for the extracted detach watch
- `missions/.../flight-log.md`

## Citation Audit

Re-probed against the working tree at 2026-09-20 on branch
`flight/03-identity-fill-and-capture` (Leg 1 landed, uncommitted):

- **FOUR** supersession loops: `vault-human.js:430-432`, `:509-511`, `:562-564`
  (all `rec.wcId === wcId`) and `:765-767` (`prior.wcId === wcId`). The first
  draft cited three — the fourth was missed because the audit grepped the
  `rec.wcId` spelling, and `captureCard` binds the loop variable as `prior`.
  Found at design review by grepping the SHAPE (`\.wcId === wcId`) rather than
  the spelling. **This is the third enumeration miss in this flight** (after the
  renderer line-count pin, squawk 0096, and the audit-hooks location in Leg 1) —
  recorded rather than quietly fixed.
- `captureRelease` at `:607`, returning the first pending record or null —
  **confirmed**.
- Bulk drops family-blind at `:1024`, `:1046`, `:1064` — **confirmed**.
- Settle sites at `guest-wiring.js:739` and `register-browser-ipc.js:228-236` —
  **confirmed**.
- Chrome scalars at `vault-controller.js:66-70`; `onVaultCaptureOffer` `:304`;
  unlock continuation `:345-361`; `openCaptureSheet` `:113`; `handleClosed`
  vault-capture branch `:641` — **confirmed** (the first draft cited each one
  line short, landing on the comment above it; corrected at design review.
  Guidance stands: resolve these by grepping the symbol, never by line number).
- Detach watch at `webview-preload.js:499-524` — **confirmed**.
- `captureRelease` test consumers: 30 references across `guest-wiring.test.js`,
  `register-browser-ipc.test.js`, `vault-gesture-capture.test.js` — **confirmed
  by grep count**. *(Leg 1's lesson applied: this audit searched for UNCLAIMED
  consumers by grepping the symbol across the whole tree, not only the sites the
  flight spec already named — that is exactly the search Leg 1's audit failed to
  run for the renderer line-count pin, per squawk 0096.)*

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit — review and commit come after the last autonomous leg (honored: nothing committed)
