# Leg: restore-workflow-wiring

**Status**: completed
**Flight**: [Multi-Vault Portability](../flight.md)

## Objective

Wire the store surface leg 2 built into the one restore workflow: file
pick → bundle secret → decrypted-labels mapping → commit with per-vault
outcomes (DD2), the held-bundle lifetime matrix (DD5), the single-sheet
adopt with the reveal joining stash/resurface and the two-sheet chain
machinery deleted (DD6 wiring half), the sever offer card routing to
the existing step-up ops (DD7), and the DD11 budget/lockstep/refresh
accounting — with docs telling the new truth.

## Context

- **DD2/DD5/DD6/DD7/DD11** (flight.md) are the charter; leg 2's eleven
  rulings (legs/02-bundle-v2-store.md) are settled upstream facts —
  `restoreProfile`/`exportProfile`/`decryptJarMeta` exist, adopt mints
  no admin anywhere, `importVault` still exists v1-single-vault.
- **DD9 tie-in**: every NEW delegate this leg writes routes its error
  ladder through `src/main/vault/vault-sheet-errors.js` (leg 1) — a
  new named config per delegate, never an inline ladder.
- **DD8 tie-in**: `vault-import` / `vault-import-unlock` are in leg
  1's blur-survival allowlist and close on `'vault-lock'` — the DD5
  lifetime hooks below must stay consistent with that (lock closes the
  sheet AND drops the held bundle).
- This leg is the LAST autonomous leg — the flight-end Reviewer and
  single commit follow it (legs 4-5 are operator legs).

## Inputs

(Citations verified 2026-09-02 on the post-leg-2 working tree.)

- Held-import store: `src/main/vault/pending-imports.js` (whole file —
  record shape `{ bundle, destinationTarget, overwrite, handle }`
  keyed by chrome id, `hold/setOverwrite/clear/take/peek`); wired in
  `main.js:862-863`; pick+hold `vaultImportBeginFromFile`
  (`main.js:1065-1098` — destination validated at pick, 16 MiB cap,
  overwrite bound at Continue `:1100-1104`)
- Import sheet channel: `register-overlay-ipc.js:380-425`
  (`menu-overlay:vault-import` — token+sender guards, dual-zeroize,
  collision reason forward; fresh-adopt branch `:408-411` stashes the
  admin key + sends `vault-recovery-show`)
- Adopt chain to DELETE: `_pendingAdoptAdminKeys` + stash/take
  (`main.js:879-904+`, suppression halves on the refcounted holder);
  ack-chained admin send (`register-overlay-ipc.js:171-197` — the
  `vault-recovery-show` activated branch: adopt marker checked first,
  compromise second)
- Reveal stores: `vault/pending-compromise-reveals.js`
  (`COMPROMISE_REASON = 'compromise'` baked at `:31`; `ack()` returns
  a bare boolean); main's `ackCompromiseReveal` (`main.js` H1 region —
  boolean interpreted as specifically-compromise, fires the completion
  broadcast); leg 1's extracted resurface unit
  (`vault/resurface-compromise-reveal.js`)
- Window teardown: `releaseVaultHoldsForWindow` (wired
  `main.js:1533`) — drops adopt keys + suppression holds; held
  bundles NOT included (the recon leak, DD5 closes it)
- Sever state idiom: `_compromiseReport` session variable (declared
  `main.js:944` — cycle-1 drift fix; survives page reloads, clears on
  relaunch); `secretKind` is the literal third parameter of the
  vault-import delegate (`main.js` `vaultImport: (chromeId, buf,
  secretKind)`); page state served by `internal-vault-state`
  (`register-vault-ipc.js:112-156` — the severOffer anchor, cycle-1
  verified)
- Bare triggers to reuse: `internal-vault-request-change-master`
  (`register-browser-ipc.js:336-339`), `internal-vault-request-recover`
  (`:340-343`); `changeMasterPassword` requires unlocked
  (`vault-store.js:1306` — post-leg-2 position),
  `recoverMasterPassword` works from locked (`:1433`); delegate
  success anchors `main.js:1947-1984` (`vaultChangeMaster` /
  `vaultRecover` — recover broadcasts at `:1976`, change-master
  broadcasts nothing today)
- Safety-drop precedent: `vault-human.js:35-37` (`CAPTURE_DROP_MS` —
  bounded dwell for a held credential spanning a multi-step UI flow)
- Labels-ready transport: `broadcastToChromeAndInternal`
  (`broadcasts.js:29-41`) is PROFILE-WIDE (every chrome + internal
  page), not targeted — the page's follow-up fetch is window-scoped
  and must no-op cleanly on null
- Page: single modal split by `opts.fresh` (`vault.js:644-669`), entry
  buttons (`vault.js:824-829`, `:1185`); lock-state refresh
  (`:2231-2237`); focus-driven access-key refresh (`:2239-2244`);
  `vault.js` ≈ 2255 lines, currently unpinned
- Budgets: `renderer.js` 1835/1836 (`seam-contract.test.js:168`) —
  ZERO headroom, expected untouched
- Pinned-shape casualties (flight DD2): `vault-pending-imports.test.js`
  (whole file pins the `{ bundle, destinationTarget }` hold),
  `vault-request-triggers.test.js:207-208` (fakes
  `vaultImportBegin(destinationTarget, chromeId)`); squawk-0051 adopt
  pins `window-factory.test.js:301-366` + the
  `clearPendingAdoptAdminKey` injectable in
  `test/unit/helpers/window-factory-harness.js`; two-sheet-chain
  expectations in `vault-import-handler.test.js` /
  `vault-compromise-handlers.test.js`

## Leg-Level Design Rulings

1. **Held-record shape + the commit secret.** `_pendingVaultImports`
   records become `{ bundle, handle }` at pick — destination and
   overwrite leave the hold entirely (commit-time binding). After a
   successful secret step the record GAINS
   `{ secret (Buffer), secretKind, labels }`: the commit re-runs the
   restore with that held secret (one extra scrypt derive at commit —
   accepted; the store API stays as leg 2 built it), and every DD5
   drop path ZEROIZES the held secret buffer. `labels` (non-secret:
   per-vault sourceId, jar name/color or global, item count) ride the
   record for the page to fetch. No key material, decrypted items, or
   secrets ever cross to the renderer.
2. **Secret verification = a store preview op (mechanism corrected at
   cycle-1 review).** A `previewRestoreBundle(bundle, { secret,
   secretKind })` store method built on leg-2 pieces: bundle
   normalization/validation, the master/recovery unwrap discipline
   with zeroized transients, `decryptJarMeta` for jar labels. Item
   counts CANNOT come from ciphertext shape — `doc.items` is ONE
   AES-GCM blob (`vault-crypto.js:715-723`; `encryptItems` /
   `decryptItems` `:252-271`), so the preview is
   **decrypt-then-discard**, the `listItemsMeta` precedent
   (`vault-store.js:2616-2635` fully decrypts and projects a
   non-secret whitelist): per bundle vault, unwrap the vault key,
   decrypt the blob, **run `validateImportedItems` on the decrypted
   array (cycle-2 HIGH: commit runs it at
   `vault-store.js:2289`, and a malformed-plaintext vault must fail
   at the SECRET step — where nothing is written — not mid-commit
   after earlier vaults landed)**, take `.length`, discard the
   plaintext — the per-vault key zeroized in a per-iteration
   `finally` (leg-2 ruling 11's policy), the decrypted item objects
   dropped by scope (JS strings, not zeroizable — the accepted
   `listItemsMeta` posture).
   Honest cost note: preview performs a per-vault unwrap+decrypt for
   every bundle vault, repeated at commit — accepted (cheap AES; the
   scrypt derive is the expensive step and runs once per phase).
   Gated via `_enterGatedOp` — NOT for exportVault's local-read
   rationale (preview touches no local vault state) but deliberately:
   an operator must not START a multi-step import while a compromise
   rotation is rewriting the profile, only for commit to refuse
   later. Errors map via the leg-1 mapper (auth → bare re-prompt,
   format/busy/state as reasons). Main.js composes — it never touches
   vault-crypto directly.
3. **Workflow sequence (DD2).** Page entry (both existing buttons, one
   flow): (a) pick file → hold `{bundle, handle}`; (b) Continue →
   vault-import-unlock sheet; (c) sheet submit → preview op; on ok the
   record gains secret+labels, the sheet closes, and the page is
   NOTIFIED labels-ready (a chrome→page send following the
   vault-lock-state bridge idiom, carrying NO payload — the page then
   INVOKES a new window-scoped internal handler to fetch its own
   record's labels + handle); (d) the page's mapping modal (Flight 1
   O4 calmed baseline) renders one row per vault — directive
   existing-jar / new-jar (prefilled name+color from labels) / skip,
   Replace-or-Merge where the destination holds a vault, every row
   explicit before Commit enables; (e) Commit → internal invoke with
   `{ handle, mapping }` → main consumes the record, calls
   `restoreProfile`, zeroizes the secret, returns the per-vault
   outcomes + generation to the page invoke reply (non-secret); page
   renders the completion surface from the reply. Fresh profile: same
   flow; destinations are new-jar/Global only; commit's fresh result
   triggers the adopt surfacing (ruling 5).
4. **DD5 lifetime matrix, implemented as ONE drop helper.**
   `dropPendingVaultImport(chromeId, why)` zeroizes the held secret
   and clears the record. Wired at: vault lock — the SAME store
   `onLock` callback leg 1 hooked (autolock included; sheet already
   closes via leg 1's `'vault-lock'` reason; the hook is GLOBAL and
   zero-arg, so `pending-imports.js` gains a `chromeIds()` (or
   `dropAll()`) enumeration mirroring the reveals store — cycle-1
   review); owning-window close — `releaseVaultHoldsForWindow` gains
   the call (closing the recon leak); explicit cancel/dismiss — the
   existing clear channel and modal-close path; successful commit —
   consume; app quit — process memory. **Two additional drop paths
   for the secret-bearing phase (cycle-1 HIGH — tab-close and
   navigate-away have no trigger above, and post-preview the record
   holds a live secret): (a) the vault page clears its window's
   record on `pagehide` once past pick (the page-side listener-handle
   idiom already used at `vault.js:2234-2237`), AND (b) the record
   gains a bounded safety-drop timer once the secret is stashed —
   the `vault-human.js` captured-credential precedent
   (`CAPTURE_DROP_MS`, constant at `vault-human.js:39`) — at 5
   minutes (mapping is operator-paced reading, longer than a capture
   decision; still bounded), on whose expiry the secret zeroizes,
   the record drops, and a later commit gets the stale-handle
   "start over" refusal.** Both are matrix rows. **Timer mechanics
   (cycle-2 HIGH — the take()/timer race): `take()` CANCELS the
   timer as part of consuming the record, exactly as
   `vault-human.js` cancels at its `dropCapture` choke point
   (`_clearTimeout`, `:139`) — otherwise a commit started at 4:59
   holds the buffer by reference while the dangling timer zeroizes
   it mid-scrypt, surfacing as a spurious wrong-password error.
   Every consume/clear path cancels; expiry itself is a normal
   drop. Timer injection mirrors `vault-human.js`'s deps shape
   (injected `setTimeout`/`clearTimeout`, `vault-human.js:81-82`) so
   the Electron-free suite runs wall-clock-free. Pagehide is
   BEST-EFFORT (cycle-2: no send-on-pagehide precedent exists in
   this codebase — existing pagehide handlers are local-only
   cleanup); the timer is the authoritative bound.** NO autolock
   suppression is ever acquired for a held bundle. Re-entering the
   flow after any drop fully resumes from pick.
5. **DD6 wiring: one sheet, one generalized reveal store.**
   `pending-compromise-reveals.js` generalizes: `stash` takes a
   `reason` (`'compromise'` | `'adopt'`), the holder pair uses that
   reason, and `ack(chromeId)` returns `{ reason }` | `null` instead
   of a boolean — main's ack handler fires the completion broadcast
   for BOTH flows (adopt ends unlocked too) but keeps any
   compromise-only behavior keyed on the returned reason. The
   fresh-restore success path stashes the recovery key under
   `'adopt'` BEFORE sending `vault-recovery-show` (the H2
   stash-before-sheet ordering — this is what makes the adopt reveal
   window-death-safe, the F2-debrief gap), and leg 1's resurface unit
   generalizes to re-key ANY orphaned reveal, reason preserved.
   DELETED: `_pendingAdoptAdminKeys` + stash/take + its harness
   injectable, the ack-chained `vault-adminkey-show` send
   (`register-overlay-ipc.js:171-197` collapses to
   ack-the-reveal-store), and the `'adopt'` suppression acquire at the
   old stash site (the reveal store's hold replaces it — same reason
   string, now refcounted through one path). Pinned-test casualties
   renamed/inverted or re-modeled per the standing rule.
6. **DD7 sever offer.** On any fresh adopt, main stashes
   `_severOffer = { secretKind, generation }` (the `_compromiseReport`
   idiom — in-memory, survives page reloads, gone on relaunch; the
   generation field is DD3's timestamp+nonce, and the SAME field is
   added to `_compromiseReport` in this touch — the F2 debrief
   evidence-cheapening item). The page's state projection gains a
   non-secret `severOffer: { route }` where main computes `route` at
   query time: `secretKind === 'master'` AND unlocked →
   `'change-master'`; otherwise (recovery-kind, or any kind while
   locked) → `'recover'`. The card's action fires the EXISTING bare
   trigger for that route (`internal-vault-request-change-master` /
   `-recover`) — no new sheet, no new store op. **Generation sourcing
   (cycle-1 question, ruled): main.js MINTS the
   `{ completedAt, nonce }` pair itself at both stash sites
   (`_severOffer` on fresh adopt, `_compromiseReport` at
   `stashCompromiseReveal`) — no vault-store touch; the restore
   result's own generation comes from `restoreProfile` (leg 2) and
   is distinct.** The offer clears on: explicit dismiss (one new
   window-scoped internal handler, `internal-vault-sever-dismiss` —
   display-state plumbing, not a secret channel), a successful
   change-master or recover completion (hook the delegates' success —
   sever accomplished; **`vaultChangeMaster`'s success branch gains a
   `broadcastVaultLockState()` call, the squawk-0059
   inert-duplicate idiom — cycle-1 review: unlike `vaultRecover`
   (`main.js:1976`) it broadcasts nothing today, so other windows'
   cards would linger**), and relaunch.
   Declining leaves everything usable. The card copy states what it
   severs (donor's master password).
7. **Export UI goes whole-profile — scoped to the VAULT PAGE's Export
   modal (cycle-1 HIGH correction).** The vault page's Export flow
   calls `exportProfile()` (v2) — one bundle, one secret, the
   operator's mission ruling; the per-vault source select is retired
   from THAT modal. **`exportVault` keeps one intentional UI caller:
   the jars page's delete-time "Export vault first" offer
   (`jars-section-controller.js:638`, modal copy `:632-638`) — a
   deliberately single-vault safety action, untouched by this leg
   and exempt from the retirement grep.** `vaultPickSavePath`'s
   target-keyed default filename stays (the jars flow passes a real
   target); the whole-profile flow's default becomes a
   profile-shaped name (leg-level copy). The export result surface
   states which vaults were carried (lazy jars absent). OPERATOR MAY
   VETO at the HAT (leg 4) — flagged there.
8. **DD11 accounting.** No new menuType (mapping modal + completion
   surface + sever card are ALL page DOM; DD7 reuses existing
   sheets) → no lockstep registration. `renderer.js` expected
   untouched (chrome's `vault-controller.js` already handles the
   reused `vault-request-*` sends); ANY renderer.js line is a named
   budget bump. `vault.js` gains a seam-contract line budget pin at
   its landed size + ~10% headroom (the flight's "evaluated at leg
   design" — ruled YES: the file crosses ~2500 lines this leg and is
   the page most likely to accrete). Completion-surface freshness:
   the commit reply renders directly, the fresh-adopt unlock
   broadcast re-queries state, and the access-key focus-refresh
   (`vault.js:2239-2244`) is unaffected — verify the completion
   surface reflects post-restore state without a manual reload.
9. **Broadcast-close vs the mapping modal (cycle-2 HIGH, FD-ruled:
   ACCEPT + cheap resume).** The vault page's `render()`
   unconditionally runs `closeActivePageModal()` on every
   `vault-lock-state` push (`vault.js:2168-2170` — the shipped
   autolock-mid-modal security invariant), and broadcasts are
   profile-wide — so ANY broadcast (including ruling 6's new
   change-master one) closes another window's in-progress mapping
   modal. Ruled: the invariant stands unexempted — carving a hole in
   the one mechanism that guarantees no stale modal survives a
   security event is worse than the collateral. The collateral is
   made cheap instead: a forced (non-cancel) modal close does NOT
   drop the held record (only the matrix's paths do — cancel is the
   operator's explicit drop), and while a labels-bearing record is
   held the page shows a "resume restore" affordance that re-enters
   the mapping step from the held record (labels re-fetched via the
   window-scoped invoke; NO secret re-entry). Selections made before
   the forced close are lost — accepted; the record's timer keeps
   the whole thing bounded. Pinned: broadcast closes the modal;
   resume re-enters mapping; cancel-then-resume is impossible
   (record gone).
10. **Delegate error configs.** New/changed delegates (`preview`,
   `restore commit`) get NAMED `vault-sheet-errors.js` configs:
   preview → auth bare (re-prompt), format/'busy'/'state' as reasons;
   commit → 'busy'/'state' reasons + unknowns propagate (per-vault
   failures are OUTCOMES in the reply, not thrown errors — only
   whole-op failures map). The old `vaultImport` delegate config
   adjusts to the reshape (collision leaves the secret step — it is
   now a per-vault outcome at commit).

## Outputs

- `pending-imports.js` re-modeled (new record lifecycle + zeroize) +
  its suite re-modeled
- `pending-compromise-reveals.js` generalized (reason-parameterized,
  `ack` → `{reason}|null`) + resurface unit generalized + suites
- main.js: pick/preview/commit/labels/sever handlers + delegates (on
  the mapper), `_severOffer`, drop wiring, chain deletion
- `register-overlay-ipc.js`: vault-import channel reshaped
  (preview), ack branch collapsed
- `register-browser-ipc.js` / internal handlers: labels fetch, commit,
  sever dismiss (window-scoped, sender-validated like siblings)
- `vault.js`: unified flow, mapping modal (O4 baseline), completion
  surface, sever card, whole-profile export
- Docs: `docs/vault.md` portability workflow + threat-model
  donor-password bullet answered; CLAUDE.md if counts/commands change
- Tests: re-modeled + new handler/page-model suites; pinned casualties
  processed; `vault.js` budget pin added

## Acceptance Criteria

- [x] One workflow, both entries: pick holds `{bundle, handle}` only
      (no destination at pick — `vault-request-triggers.test.js`
      re-modeled); secret step returns ONLY non-secret labels to the
      page (pinned: the labels payload contains no key material, no
      item content); every mapping row requires an explicit directive
      before commit; commit binds destinations and returns per-vault
      outcomes + generation to the page.
- [x] v1 bundles ride the same flow as the one-row case (labels list
      of one; no jarMeta label — global row).
- [x] Preview runs `validateImportedItems` per vault: a
      GCM-authentic bundle whose plaintext is malformed
      (non-array / oversized / bad item / duplicate id) fails AT THE
      SECRET STEP with nothing written — pinned.
- [x] Timer race pinned: a `take()` at T-1s followed by the timer's
      original expiry leaves the consumed buffer INTACT for the
      commit (cancel-on-consume); expiry without consume zeroizes
      and drops; injected timers keep the suite wall-clock-free.
- [x] Broadcast-close + resume pinned per ruling 9: a lock-state
      push closes the mapping modal in every window; a
      labels-bearing record surfaces the resume affordance;
      resume re-enters mapping without secret re-entry; cancel
      drops the record and kills the affordance.
- [x] Held-bundle lifetime pinned as a matrix test: drop + secret
      zeroize on lock (manual AND idle-timer path; via the store's
      new `chromeIds()`/bulk-drop enumeration), window close (leak
      closed — `releaseVaultHoldsForWindow` covers imports), tab
      `pagehide`, safety-drop timer expiry (secret-bearing phase
      only; commit afterwards → stale-handle refusal), cancel,
      successful commit; resume-from-pick works after each drop; no
      autolock suppression ever held for a bundle.
- [x] Fresh adopt surfaces EXACTLY ONE dismiss-locked
      `vault-recovery-show` sheet; no `vault-adminkey-show` send
      exists on any adopt path; the reveal is stashed (reason
      `'adopt'`) BEFORE the sheet send and survives owning-window
      death via the generalized resurface (pinned both ways:
      orphaned-adopt re-keys; ack releases exactly the
      `(chromeId,'adopt')` hold).
- [x] `ack` discrimination pinned: adopt ack and compromise ack each
      fire the completion broadcast for their own flow;
      setup/rotate-recovery acks remain strict no-ops
      (`vault-import-handler.test.js` /
      `vault-compromise-handlers.test.js` expectations re-modeled,
      renamed per the rule).
- [x] Chain machinery GONE: `_pendingAdoptAdminKeys`, stash/take, the
      harness injectable, the 0051 adopt-caller pins
      (`window-factory.test.js:301-366`) retired by rename/invert;
      grep proves no `adminPrivateKeyB64` reaches any IPC reply or
      chrome send.
- [x] Sever offer: set on every fresh adopt with `secretKind` +
      generation; state projection computes the route (master+unlocked
      → change-master; recovery or locked → recover — BOTH pinned,
      including the lock-state flip on the same offer); card action
      fires the existing trigger only; offer clears on dismiss, on
      successful change-master/recover, and is absent after relaunch;
      decline leaves the profile fully usable. `_compromiseReport`
      gains the same generation field.
- [x] Whole-profile export from the vault page's Export modal (v2),
      result states carried vaults; no VAULT-PAGE caller of
      single-vault `exportVault` remains — the jars page's
      delete-time export (`jars-section-controller.js:638`) is the
      one intentional retained caller, untouched.
- [x] New delegates route through `vault-sheet-errors.js` named
      configs — zero inline ladders (grep).
- [x] DD11: no renderer.js change (or a named bump); no new menuType;
      `vault.js` budget pin added; completion surface reflects
      post-restore state without manual reload.
- [x] Docs: `docs/vault.md` describes the workflow (pick → secret →
      mapping → outcomes → sever offer) and answers the threat-model
      donor-password bullet (alive until sever, dead after — DD4
      residual + DD7).
- [x] Full suite + lint + format + typecheck green.

## Verification Steps

- Matrix/adversarial suites in isolation, then `npm test`,
  `npm run lint`, `npm run format:check`, `npm run typecheck`.
- `grep -rn "adminPrivateKeyB64" src/main/main.js src/main/register-overlay-ipc.js`
  → only historical comments, no live sends/replies.
- `grep -n "vault-adminkey-show" src/` → only the rotate-admin
  provision path remains.
- `wc -l src/renderer/renderer.js` unchanged (or named bump).

## Edge Cases

- **Secret step ok, window dies before mapping**: record drops via
  window-close (secret zeroized); adopt not yet run — nothing
  stashed, nothing to resurface. Re-run from pick.
- **Commit arrives with a stale handle** (record dropped by lock
  meanwhile): refuse loudly (the existing handle-mismatch no-op
  idiom → an `{ ok:false, reason:'state' }`-shaped reply so the modal
  can say "start over"), never a partial restore.
- **Lock fires DURING commit's scrypt**: the store's gate/second-wall
  semantics govern (leg 2); the reply maps 'busy'/'state'; the held
  record was already consumed — the page's retry is a fresh pick
  (stated in the modal copy).
- **Fresh adopt where commit succeeds but the window dies before the
  reveal ack**: reveal survives via resurface (that is the point of
  ruling 5); suppression hold rides the reveal store.
- **Sever card while locked**: card persists (session state), route
  flips to recover; acting from locked opens vault-recover (reachable
  from locked by design).
- **Two windows**: records, reveals, and offers are all
  chrome-id-scoped except `_severOffer`, which is profile-global
  (like `_compromiseReport`) — the card shows in every window's page;
  acting in one clears it everywhere (broadcast refresh).
- **Mapping modal open when a second pick starts in the SAME window**:
  re-pick replaces the record (existing hold semantics) and the modal
  restarts — pinned.
- **Labels-ready fan-out**: the broadcast reaches every window's
  vault page; a page whose window-scoped fetch returns null treats
  the event as a strict no-op (never assumes the event implies its
  own record) — pinned.
- **Mapping-modal jar picker**: `buildVaultSelect` (`vault.js:496-505`)
  backs the retiring single-select flows — reuse it for the per-row
  existing-jar picker or retire it deliberately; never leave it
  orphaned.

## Files Affected

- `src/main/vault/pending-imports.js`, `pending-compromise-reveals.js`,
  `resurface-compromise-reveal.js`, `vault-store.js` (preview op only),
  `vault-sheet-errors.js` (new configs)
- `src/main/main.js`, `register-overlay-ipc.js`,
  `register-browser-ipc.js`
- `src/renderer/pages/vault.js`
- `docs/vault.md`, `CLAUDE.md` (if counts change)
- `test/unit/`: `vault-pending-imports.test.js` (re-model),
  `vault-request-triggers.test.js`, `vault-import-handler.test.js`,
  `vault-compromise-handlers.test.js`, `window-factory.test.js` +
  harness, `pending-compromise-reveals.test.js`,
  `resurface-compromise-reveal.test.js`, `seam-contract.test.js`
  (vault.js pin), new page-model/handler suites

---

## Citation Audit

All main.js / register-overlay-ipc.js / register-browser-ipc.js /
vault.js / pending-imports.js citations read directly from the
post-leg-2 + typecheck-fix working tree on 2026-09-02. Casualty-test
line ranges (`window-factory.test.js:301-366`,
`vault-request-triggers.test.js:207-208`) carry over from the flight
spec (verified at flight design review; legs 1-2 did not modify those
suites) — the design reviewer re-verifies them.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (suite + typecheck + lint + format)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Do NOT commit — the flight-end review/commit covers all legs
