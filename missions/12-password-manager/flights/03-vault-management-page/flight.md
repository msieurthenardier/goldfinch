# Flight: Vault Management Page

**Status**: landed
**Mission**: [Built-in Password Manager](../../mission.md)

## Contributing to Criteria

- [ ] **First-run setup** establishes the manager: choose a master password, recovery key shown
      exactly once — **the UI half** (F1 built `setup()`; F2 deferred the UI).
- [ ] **TOTP works end-to-end**: enroll a TOTP secret (paste `otpauth://` or base32), live rotating
      code with countdown, offered for fill/copy — **the enrollment + display half** (F1 built
      `parseOtpauth`/`totp`).
- [ ] **`goldfinch://vault` is a first-class trusted internal page** (four gates,
      `registerInternalHandler`, strict CSP, `npm run a11y` via the chrome-state path): item CRUD
      with reveal/copy, per-vault access-key management (mint/list/revoke), the auto-lock duration
      setting, and a password generator — **fully** (export/import, rotation, master-password change
      move to F4).
- [ ] **Durable-grant operations demand step-up re-auth**: minting an access key requires a fresh
      master-password confirmation even while unlocked — **the UI half** (F1 built the `mintAccessKey`
      step-up gate).

Deferred to **F4** (documented, not dropped): per-vault export/import + the MRK-bundle format;
recovery-key / master-password / admin-key rotation; the registrable-domain PSL fill opt-in; the
audit-origin fix; the jar-delete → vault-removal (offer-export-first) hook (coupled to export); the
docs + threat-model page.

---

## Pre-Flight

### Objective

Build `goldfinch://vault` — the first-class trusted internal management page for the password
manager — following the exact four-gate internal-page recipe (settings/downloads/jars precedent),
with first-run setup, item CRUD (login/card/note) with reveal/copy, TOTP enrollment + live display,
a password generator, per-vault access-key management (list/mint-with-step-up/revoke), and the
auto-lock duration setting. All management IPC is `registerInternalHandler`-gated; the page reuses
F1's already-built store/crypto primitives (unwired until now) and F2's chrome-owned
master-password sheet family. Also lands the reserved-id single-source-of-truth guard (F1 debrief).

### Open Questions

- [x] Does `goldfinch://vault` need new gate code → **DD1** (no — add to the existing allowlists;
      the four gates key on session identity)
- [ ] **Where is the master password entered for setup / step-up mint?** — the mission's load-bearing
      invariant is "master password only in chrome-owned UI, never page DOM." The vault page is a
      *trusted* internal page (internal session, contextIsolation, strict CSP) — is that "chrome-owned"
      enough, or must master-password entry route through F2's chrome-owned menu-overlay sheet? →
      **DD5** (provisional: route through the chrome-owned sheet family; **flagged for the Architect
      review**)
- [ ] TOTP live display: compute codes in main (secret stays in main) vs. hand the seed to the
      trusted page → **DD4** (compute in main; page shows code + countdown; seed reveal is an explicit
      opt-in like password reveal)
- [ ] `saveItem` merge-vs-replace for the editor → **DD3** (the editor is a *full-item* editor —
      load-edit-save-full — so replace is correct and lossless; the "class" is that *partial*-update
      callers must merge, now documented)

### Design Decisions

**DD1 — `goldfinch://vault` follows the four-gate internal-page recipe verbatim; no new gate code.**
Add `'vault'` to `INTERNAL_HOSTS` (`url-safety.js:84`) and `'goldfinch://vault'` to `INTERNAL_ORIGINS`
in **both** `internal-ipc.js:25` and `internal-preload.js:24`; add a `vault:` route (+ each shared
module it imports) to `internal-page-map.js`; serve `src/renderer/pages/vault.{html,css,js}`;
compose `src/main/register-vault-ipc.js`; expose bridge wrappers in `internal-preload.js`; add an
`openVaultPage()` trusted-`createTab` entry (`overlay-menus.js` + `renderer.js` dispatch). The four
gates (call-site provenance, allowlist, session-aware `will-navigate`, internal-session protocol
handler) then admit it by session identity — no new security code.
- Rationale: the settings/downloads/jars precedent is exact and audited; `CLAUDE.md:70,74` is the
  recipe. Reuse the trust model rather than inventing one.
- Trade-off: the "three-point onboarding seam" (map entry, module tag/import, script-contract test)
  must be honored for every shared module the page imports, or the strict CSP blocks it.

**DD2 — All vault management IPC goes through `registerInternalHandler` (origin + session-identity
gated).** `register-vault-ipc.js` mirrors `register-settings-ipc.js`: `internal-vault-list`,
`internal-vault-item-save`, `internal-vault-item-delete`, `internal-vault-reveal`,
`internal-vault-totp-code`, `internal-vault-accesskeys-*`, `internal-vault-generate-password`,
`internal-vault-setup`, `internal-vault-autolock-*` — each wrapped so a non-internal sender is
rejected (`internal-ipc.js:68`). Injects the vault store singleton.
- Rationale: the internal page is trusted, but the IPC guard is the belt to the session-identity
  suspenders — the established convention for every internal page.
- Trade-off: a new composition module; no new gate logic (the guard is shared).

**DD3 — The item editor is a *full-item* editor; `saveItem`'s full-replace contract stays and is
documented.** The editor holds the complete item in its form (non-secret fields from the DD10
metadata read; secret fields pulled only on explicit reveal per DD6) and saves the **whole** item
back — so `saveItem`'s replace-on-update is correct and lossless (and lets the user *clear* a field,
which a blind merge could not). The F2 capture data-loss was a *partial*-update caller; the durable
rule is **partial-update callers must read-merge** (F2 capture already does). F3 documents
`saveItem`'s full-replace contract at its definition, does not change it, and re-asserts (a test)
that the one partial-update caller — capture — still read-merges, so the class is *verifiably* closed.
- Rationale: closes the F2-debrief concern correctly — a full-item editor needs replace semantics;
  making `saveItem` always-merge would break field-clearing. The class is "partial updates merge,"
  now explicit and tested.
- Trade-off: the editor must always send the complete item (it holds every field, secret ones only
  if the user revealed them — an unrevealed secret is carried through untouched, not blanked); a
  future partial-update caller must remember to merge (documented at `saveItem`).

**DD4 — TOTP codes are computed in main; the seed stays in main.** The page requests
`internal-vault-totp-code(itemId)` and main returns `{ code, secondsRemaining }` (reusing F1's
`totp`); the page polls/refreshes each period with a countdown. The TOTP **seed** is revealed to the
page only via the explicit reveal path (like the password), never for the live display.
- Rationale: minimizes secret exposure — the live code display needs no seed in the renderer.
- Trade-off: a per-period IPC round-trip (cheap; internal page).

**DD5 — No master-equivalent secret ever touches the vault page DOM: master-password entry AND
recovery-key display both live on the chrome-owned sheet (Architect-ruled).** Master-password entry
for **first-run setup** and **step-up access-key minting**, *and* the one-time **recovery-key
display**, all happen on the chrome-owned menu-overlay sheet (extending F2's `vault-unlock` family:
`vault-set` / `vault-confirm` / `vault-stepup` / `vault-recovery-show`), triggered from the vault
page; the page orchestrates and shows only **non-secret** results. The interpretation of the mission
invariant is recorded as: *"no master-equivalent secret — the master password OR the recovery key —
ever enters the vault page DOM; both live on the minimal chrome-owned sheet."*
- Rationale (the Architect's TCB argument): the vault page *renders user-controlled content* (item
  titles/usernames/origins/TOTP issuers) — a DOM-injection surface the sheet never has (it renders
  only constrained templates, never vault item content). Keeping the most sensitive secrets on the
  minimal surface that never co-renders attacker-influenced strings is the conservative choice, and
  it reuses F2's already-audited zeroized-`Buffer` invoke channel. On the "could automation read the
  typed secret back" axis the page is actually *stronger* (the op-local `isInternalContents` refusal
  fires even for admin) — but TCB size, not reachability, is decisive. The earlier draft's split
  (password on sheet, recovery on page) was incoherent — the recovery key is master-equivalent
  (`vault-store.js:384`); this unifies the rule.
- **Template-registry refactor folded in (F2-debrief carry-forward).** F3 pushes the sheet past the
  "8th template kind" line the F2 debrief flagged; **leg 4** lands a small shared modal-card /
  template-registry factor (co-located with the new vault sheet kinds it precedes, where the a11y
  SHEET_STATES + HAT that guard sheet-controller changes actually run — the F2 card *builders* are
  already factored, so this is a controller-wiring refactor). Note the picker (roving) won't fold
  onto the same helper as the dialog-style unlock/capture/set/stepup kinds.
- Trade-off: setup/step-up/recovery are multi-surface (page orchestrates, sheet collects/shows the
  secret); more wiring, but the invariant holds literally and the master secret stays on one hardened
  surface.

**DD6 — Secrets reach the page only on explicit reveal — never on list render or editor open.** The
item list and the editor's non-secret fields render from a **metadata-only** read (DD10); the
password and TOTP seed are fetched via `internal-vault-reveal(itemId)` (main returns the secret under
the MRK) **only** on an explicit in-editor/in-list reveal click (masked `●●●` + reveal button); copy
uses the existing `clipboard:write` sink. A dedicated single-item reveal op is net-new. This closes
the Architect's DD3↔DD6 conflict: **the editor does NOT populate from `listItems` (full plaintext) on
open** — it loads metadata, and pulls a secret only when the user reveals it.
- Rationale: minimizes secret exposure (F2's grep-AC-for-secret-egress discipline) — no plaintext in
  the page DOM until an explicit gesture; the trusted internal page is the right surface for reveal
  (not the sheet — reveal isn't a master-equivalent secret and the page is MCP-unreadable even by
  admin, `observe.js:43-44`).
- **Save contract for unrevealed secrets (reconciles DD3 replace with DD6 no-secret-in-DOM):** on
  save the editor sends the full item, but a secret field the user never revealed/edited is sent as
  an **"unchanged" sentinel**; the `internal-vault-item-save` handler resolves the sentinel against
  the existing item's secret in main. An explicit *clear* sends an empty value (not the sentinel), so
  field-removal still works. This keeps the plaintext out of the DOM for untouched secrets while
  preserving `saveItem`'s full-replace semantics.
- Trade-off: the revealed secret lives in the page DOM while shown (bounded to the trusted page,
  cleared on hide/blur) — acceptable for an explicit reveal.

**DD10 — A net-new metadata-only, all-types, per-vault list op backs the page item list.** Today the
human/MRK path has only `listItems` (full plaintext, `vault-store.js:665`) and the login-only,
origin-filtered `reachableLoginItems` (`:694`). The page item list needs neither — add a metadata-only
op returning `{ vaultId, id, type, title, username, origin, hasTotp }` for **all** item types, no
origin filter, **no secret fields** (generalizing `reachableLoginItems`). Full plaintext is reserved
for the explicit DD6 reveal.
- Rationale: rendering the list from `listItems` would ship every item's password + TOTP seed into
  the page DOM just to draw titles — directly against DD6/the secret-egress discipline.
- Trade-off: a third list path (metadata-all-types) beside `listItems` (full) and `reachableLoginItems`
  (login/origin) — but they sit on distinct secret-exposure contracts and must not be conflated.

**DD7 — Password generator is a pure, in-page module using `crypto.getRandomValues`.** A new pure
`src/shared/password-generator.js` (length + charset options) produces a candidate password for a new
login, run in the trusted page (no secret involved — it's fresh randomness). Unit-tested.
- Rationale: a generator needs no main round-trip and no vault key; pure + unit-testable.
- Trade-off: none; it's a self-contained utility.

**DD8 — Reserved-id single-source-of-truth guard (F1 debrief carry-forward).** Put the reserved-id
constant in a **standalone `src/shared/reserved-ids.js` (CJS)** — **not** exported from `jars.js`,
which `require`s `./app-db` and would couple `vault-store`'s Electron-free purity to it — and have
both `vault-store.js` and `jars.js` consume it; add a cross-module consistency test asserting
`vault-store`'s sentinel ∈ jars' reserved ids. Cheap; lands in leg 1 because F3's page touches the
vault/jars namespace.
- Rationale: the two literals could silently drift (F1 debrief recommendation, still unimplemented).
- Trade-off: a small shared-constant refactor with two consumers + a test.

**DD9 — Verification apparatus (Architect-corrected): the vault *page* cannot be axe-audited at all;
only the new *sheet* states can. Page a11y rests on unit DOM/aria tests + the F5 HAT.** The
correction to the initial premise: the MCP `evaluate`/`injectScript`/`readDom` tools carry an
**op-local `isInternalContents` refusal that fires even under admin's `allowInternal`**
(`observe.js:43-44,55-56`, `readDom` `:180-181`), so `goldfinch://vault` — an internal-session page,
same class as `goldfinch://settings/downloads/jars` — **cannot be `npm run a11y`-audited by any admin
path**. Therefore:
- **The F3 sheet templates** (`vault-set`/`vault-confirm`/`vault-stepup`/`vault-recovery-show`, per
  DD5) **are** auditable — they are chrome-class overlay views; add them to `a11y-audit.mjs`'s
  `SHEET_STATES` (the real, precedented chrome-state path).
- **The vault page proper** (item list, editor, TOTP display, generator, access-key UI, autolock) is
  **not** `npm run a11y`-coverable — the same standing gap that already applies silently to
  settings/downloads/jars. Its a11y rests on **unit DOM-shape / aria tests** on the pure page-logic
  + template modules and the **F5 HAT** keyboard/focus pass (the find-overlay a11y precedent).
- **Operator-facing:** the mission criterion "`goldfinch://vault` … passes `npm run a11y` (via the
  chrome-state path)" is **not literally achievable for the page portion** under the current
  harness+security model — a pre-existing methodology gap shared with the other internal pages, not
  an F3 regression. Recorded here for the go/no-go; either accept the settings-class gap (recommended)
  or scope security-preserving harness work (not F3).
- Rationale: the internal-session eval exclusion is a *security property* — the very reason the page
  can't be driven for a11y; don't weaken it for test reach.
- Trade-off: honest coverage is "sheet states axe-audited; page DOM via unit + F5 HAT," not a live
  page axe run.

### Prerequisites

- [ ] F1's store/crypto primitives present (verified by recon): `setup`, `changeMasterPassword`,
      `mintAccessKey`, `revokeAccessKey`, `listItems`, `saveItem`, `parseOtpauth`, `totp`,
      `listEnvelopeKeyIds`, the `vaultAutoLockMinutes` setting.
- [ ] The internal-page infra present (settings/downloads/jars precedent) — the recipe to follow.
- [ ] F2's chrome-owned `vault-unlock` sheet family present (to extend for setup/step-up per DD5).
- [ ] `npm run a11y` tooling (ATTACH model, live GUI, admin key) — for the new chrome-state hook.
- [ ] No new runtime dependency (the generator uses `crypto.getRandomValues`; no PSL here — that's F4).

### Pre-Flight Checklist

- [x] All open questions resolved (DD5 master-password-surface ruled by the Architect: sheet-only,
      recovery display moved to the sheet)
- [x] Design decisions documented (DD1–DD10; DD9 a11y premise corrected)
- [x] Prerequisites verified (recon)
- [x] Validation approach defined (unit + integration + a11y for the new sheet states; page DOM via
      unit + F5 HAT — DD9)
- [x] Legs defined (5 legs; one Architect design-review pass, approve-with-changes, all incorporated)

---

## In-Flight

### Technical Approach

Five legs (leg 4 split at design review — first-run setup and access-key management are each a
security-critical flow deserving its own review gate, mirroring F2's `chrome-unlock`/`pick-and-fill`
split). The page is a trusted internal surface; every management IPC is `registerInternalHandler`-gated;
F1's unwired primitives get their surface; no master-equivalent secret touches the page DOM (DD5);
secrets reach the page only on explicit reveal (DD6/DD10).

1. **`vault-page-infra`** — the `goldfinch://vault` four-gate onboarding (allowlists ×3, route map +
   each shared module, `vault.{html,css,js}` shell, `register-vault-ipc` scaffold, `internal-preload`
   bridge + `renderer-globals.d.ts` types, `openVaultPage()` entry, strict CSP) + the **reserved-id
   SSOT guard** (DD8, standalone `src/shared/reserved-ids.js`). Lands a trusted page that renders the
   vault list (**labels only** — counts are leg 2; locked/unlocked + the **not-set-up state**, with
   the setup CTA and locked-unlock affordance **stubbed**, their real flows in leg 4) and is reachable
   from the chrome. `internal-vault-state` injects `jars` to enumerate `'global' + jars.list()`.
   *(HIGH — trust-boundary infra.)*
2. **`item-management`** — the net-new **metadata-only all-types list op** (DD10) + **delete-item** +
   **single-item reveal** store ops; the item list + full-item editor (metadata-populated, secrets
   only on explicit reveal with the unchanged-sentinel save contract, DD3/DD6); reveal/copy. Re-assert
   (test) that capture still read-merges. *(HIGH — vault-store surface + secret reveal.)*
3. **`totp-and-generator`** — TOTP enrollment (editor totp field + `parseOtpauth` normalization,
   range-validated, stored as the canonical `otpauth://` string so F1's automation read is unbroken),
   live rotating code display with a local countdown (codes computed in main, seed stays in main,
   per-period poll, DD4), and the pure `password-generator.js` (DD7, `globalThis.crypto`) offered in
   the editor. *(HIGH — TOTP 2FA-secret handling.)*
4. **`first-run-setup`** — the **template-registry / modal-card refactor** (DD5, co-located here
   before the new kinds); the chrome-owned sheet collects the master password
   (`vault-set`/`vault-confirm`) → `setup()` → the recovery key shown once on the **sheet**
   (`vault-recovery-show`); the **request-unlock path** (page→main→chrome→F2 sheet) that leg 1
   stubbed; the page orchestrates and shows only non-secret results. *(HIGH — the master-secret
   first-run flow.)*
5. **`access-keys-autolock`** — per-vault access-key management (net-new **list-access-keys** op +
   mint-with-step-up via the sheet `vault-stepup` + revoke) and the auto-lock duration setting UI
   (`vaultAutoLockMinutes`). *(HIGH — step-up mint is a durable-grant flow.)*

Verification: unit for the pure modules (generator, page-logic/aria, reserved-id SSOT) + the
`register-vault-ipc` handlers (integration with a fake store, each rejecting a non-internal sender);
a11y for the **new sheet states** via the chrome-state path (the page DOM is not axe-coverable, DD9);
the true human end-to-end + page keyboard/focus at the F5 HAT.

### Checkpoints

- [ ] **(a)** `goldfinch://vault` loads as a trusted internal page reachable from the chrome, passes
      the four-gate discipline, renders the not-set-up/locked/unlocked states, and the reserved-id
      SSOT guard + cross-module test + the template-registry refactor are green.
- [ ] **(b)** Item CRUD works from a **metadata-only** list: create, edit (full-item, lossless, with
      the unchanged-secret sentinel), delete, explicit reveal/copy — via `registerInternalHandler`-gated
      IPC, no plaintext in the DOM until reveal (grep AC); capture still read-merges (test).
- [ ] **(c)** TOTP enrolls + displays live codes (computed in main) with a countdown; the generator
      produces configurable passwords.
- [ ] **(d)** First-run setup completes through the chrome-owned sheet (password + confirm) and shows
      the recovery key once **on the sheet**; the page shows only non-secret results.
- [ ] **(e)** Access-key mint (step-up via the sheet) / list / revoke work; the auto-lock setting
      persists; `npm run a11y` passes for the **new sheet states** (the page DOM is unit + F5-HAT
      covered, DD9).

### Adaptation Criteria

**Divert if**:
- A trusted internal page turns out to be an acceptable master-password surface (DD5 relaxed at
  review) — then fold setup/step-up password entry into the page and drop the extra sheet types.
- The strict internal-page CSP blocks a needed page capability (revisit the module map, never relax
  the CSP without a security review).

**Acceptable variations**:
- Page layout/component structure; which shared modules are factored.
- Whether TOTP live display polls per-second or per-period with a client countdown.
- Generator charset/length defaults.

### Legs

> **Note:** Tentative; planned one at a time as the flight progresses.

- [x] `vault-page-infra` — four-gate `goldfinch://vault` onboarding (allowlists ×3 + route map + shared
      modules + d.ts) + page shell (not-set-up/locked/unlocked, labels-only, CTAs stubbed) +
      `register-vault-ipc` scaffold (jars-injected `internal-vault-state`) + `internal-preload` bridge +
      `openVaultPage()` + CSP + reserved-id SSOT guard (standalone module) (DD1, DD2, DD8).
- [x] `item-management` — metadata-only all-types list op + delete-item + single-item reveal ops; item
      list + full-item editor (metadata-populated, explicit reveal, unchanged-secret sentinel); reveal/copy
      (DD3, DD6, DD10).
- [x] `totp-and-generator` — TOTP enrollment + live code display (main-computed, seed stays in main) +
      pure password generator (DD4, DD7).
- [x] `first-run-setup` — template-registry/modal-card refactor (DD5) + not-set-up → chrome-owned
      sheet (password + confirm) → `setup()` → recovery key shown once on the sheet + the request-unlock
      path leg 1 stubbed; page shows non-secret results (DD5).
- [x] `access-keys-autolock` — access-key management (list-op + mint-step-up-via-sheet + revoke) +
      auto-lock duration setting UI (DD5).

*(No per-flight HAT leg — the mission's closing HAT is Flight 5. Legs 1-3 run against an
F1-fixture-provisioned set-up manager; the first-run path lands in leg 4.)*

---

## Post-Flight

### Completion Checklist

- [x] All legs completed (5/5)
- [x] Code committed on `flight/03-vault-management-page`; draft PR opened (stacked on F2)
- [x] Unit + integration suites passing (`npm test` **2522/2522**), typecheck clean, lint clean;
      whole-diff flight-end security review passed (`[HANDOFF:confirmed]`, no blocking issues — full
      secret-inventory trace, channel-trust, whitelist/preserve complement, dual-zeroize, step-up gate,
      F2-refactor preservation all verified)
- [ ] `npm run a11y` for the **four new vault sheet states** — **deferred: live-GUI step** (the page
      DOM is not axe-coverable at all — unit DOM/aria + F5 HAT; the sheet states audit at the F5-HAT
      GUI session, DD9). `a11y-audit.mjs` wired (SHEET_STATES/NODE_IDS/DISMISS_EXPR) but not run headless.
- [ ] Flight debrief written (the go/no-go before F4) — next step.

### Verification

- **Unit**: the pure password generator (length/charset, randomness source); page-logic modules
  (item-list/editor state, TOTP countdown); the reserved-id SSOT shared constant + cross-module
  consistency test.
- **Integration**: `register-vault-ipc` handlers against a fake store — list/save(full-item)/delete/
  reveal/totp-code/accesskeys-list-mint-revoke/setup/autolock; each rejects a non-internal sender
  (`registerInternalHandler` guard); reveal returns the secret only for the requested item; the
  full-item editor round-trips without dropping fields; step-up mint refuses a wrong password.
- **a11y** (`npm run a11y`): the new `goldfinch://vault` chrome-state passes axe via the admin
  chrome-driving path (never `--target`).
- **F5 HAT**: the true human end-to-end (real page interactions, first-run setup, reveal, TOTP).
