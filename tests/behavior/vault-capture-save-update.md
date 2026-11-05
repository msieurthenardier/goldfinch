# Behavior Test: Capture Save / Update Disposition

**Slug**: `vault-capture-save-update`
**Status**: draft
**Created**: 2026-07-24
**Last Run**: never

## Intent

Verifies the password manager's **capture disposition** end-to-end (Mission 12, Flight 2 Leg 4):
when a login form is submitted, Goldfinch decides — from the submitted `{origin, username,
password}` against what is already stored — whether to offer to **save** a new login, offer to
**update** an existing one, or **offer nothing at all**. The load-bearing case, and the reason
this spec exists, is the **no-op**: re-submitting a login whose `{username, password}` are
**already stored unchanged** must raise **no prompt** — a stored credential that hasn't changed
has nothing to save. (Regression: it previously offered a pointless "Update password?" on every
re-login because the match was computed on username+origin only, ignoring the password.)

This needs real-environment observation — a real page submit, the real guest→main capture hook,
and the real chrome-owned save/update sheet rendering (or NOT rendering) over the guest — that
unit tests cannot provide. The disposition *logic* is unit-tested in `test/unit/vault-capture.test.js`
(`disposeCapture` → save / update / null); this spec proves the same outcomes drive the live sheet.

**Apparatus boundary (mirrors `vault-human-fill-boundary`, Flight 2 DD8) — UPDATED Sortie 06:** the
"Save password?" / "Update password?" offer is no longer a centered menu-overlay sheet. It is the
non-blocking **corner save prompt**, its own per-window view, and it is **fail-closed to every
automation op AND excluded from `captureWindow`** (the prompt renders the origin, username and
vault choice and takes the operator's Save click). So the old pixel evidence is GONE: its
presence/absence is observed through `enumerateWindows().savePromptVisible` (an always-present
admin boolean, zero cached state) and, for what it looks like, **by eye** (`[by-eye]`/HAT) — never
through `captureWindow`. The captured password never enters page DOM. The prompt **interior**
(choosing a vault, clicking Save) is verified by main-process integration tests + the HAT and is
**staged** here via the fixture/integration seam — this test does not type into or read the prompt.
Steps 2/4/5/6 below were retargeted from `captureWindow` pixels to `savePromptVisible` plus
`[by-eye]`; use the fixture's **capture mode** (`capture.html` → `landed.html`) so the submit
actually navigates and releases the offer (`index.html` suppresses its submit).

## Preconditions

- Goldfinch dev build running with the MCP automation surface (`npm run dev:automation`, loopback
  49707).
- An **admin** transport key is minted (`GOLDFINCH_AUTOMATION_ADMIN` set) — needed for
  `enumerateWindows` (`savePromptVisible`, the sole MCP observation of the corner prompt).
- A **jar** transport key + a **jar vault access key** for the fixture jar (drives the guest tab;
  reads/writes the form fields).
- The push-button vault-fixture builder has provisioned a **set-up, UNLOCKED manager** and the
  fixture jar's vault. The vault starts with **exactly one** Login item for the fixture origin:
  `{ username: "alice@example.com", password: "correct-horse", origin: <fixture origin> }`.
- The login-form fixture is served (reuse `tests/behavior/fixtures/vault-login/` — the normal login
  page). Origin is stable (fixed loopback port).

## Observables Required

- browser (guest DOM: the login form, typed field values, submit, and the **absence** of any
  save/update prompt node in page DOM) — measured via the goldfinch MCP `readDom` / `evaluate` /
  `fill` / `click` (jar key, jar-membership-gated).
- window topology (the corner save/update prompt over the guest — **presence AND absence**) —
  measured via goldfinch MCP admin `enumerateWindows().savePromptVisible`. Its pixels are
  **`[by-eye]`** only: the prompt is excluded from `captureWindow` and refused to every op.
- filesystem (optional: the stored vault item's password before/after) — measured via the vault
  read seam / integration, never by reading the sheet.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a tab in the fixture jar and navigate it to the login fixture. Wait for the form to render. Confirm the vault is UNLOCKED (toolbar lock indicator unlocked). | Page loads; a `<input type=password>` + username field are present. The manager is set up and unlocked (the capture gate needs unlocked; a locked vault is the variant below). |
| 2 | **NEW login (save).** Type a brand-new credential into the form — `username: "bob@example.com"`, `password: "s3cret-new"` — and submit the form (capture mode). Immediately read `enumerateWindows().savePromptVisible`. | `savePromptVisible` is `true` and **[by-eye]** a chrome-owned **"Save password?"** prompt shows in the corner over the guest: a save offer, since no stored login matches this username at this origin. Re-read the guest DOM in full: **no** prompt node, and **no** password value, exists anywhere in page DOM (the offer is chrome-owned; the captured password lives only main-side). |
| 3 | Complete the save (staged via the fixture/integration seam — the sheet interior is out of MCP scope): choose the fixture jar and Save. Read the jar vault back via the vault seam. | The jar vault now holds a login `{ username: "bob@example.com", password: "s3cret-new", origin }` in addition to alice's. The held capture record is dropped (no lingering password). |
| 4 | **UNCHANGED re-login (NO offer — the regression guard).** Reload the fixture. Type the **already-stored, unchanged** credential — `username: "alice@example.com"`, `password: "correct-horse"` (the seeded item) — and submit. `captureWindow` (admin) after the submit settles (wait past the ~10 s prompt lifetime if in doubt). Read `savePromptVisible` throughout. | **No** save/update prompt appears — `savePromptVisible` stays `false` and **[by-eye]** the page shows no prompt over it. The submitted `{username, password}` exactly matches the stored item, so there is nothing to save. The guest DOM likewise has no prompt node. *(Before the fix this wrongly showed an "Update password?" sheet.)* |
| 5 | **CHANGED password (update).** Reload the fixture. Type `username: "alice@example.com"` with a **different** password — `password: "rotated-9000"` — and submit. Read `savePromptVisible`. | `savePromptVisible` is `true` and **[by-eye]** an **"Update password?"** prompt shows in the corner: the username matches a stored login at this origin but the password differs, so an update is offered. Guest DOM still contains no prompt node / no password value. |
| 6 | Dismiss the update prompt WITHOUT saving (**[by-eye]** click ✕ / "Not now", or let the ~10 s timer expire — MCP cannot click the prompt). Re-read the jar vault via the seam. | `savePromptVisible` becomes `false`; the stored alice login is **unchanged** (`password` still `"correct-horse"`) — dismissing offers nothing and the held capture record is dropped. |

## Out of Scope

- **Prompt interior**: choosing the destination vault, clicking Save/Update, and the Buffer
  secret-channel zeroization — verified by main-process integration tests and the HAT.
  Steps 3 and 6 stage/read around the prompt, never through it (MCP-unreachable by design, DD10).
- **Disposition unit logic** (`disposeCapture` → save / update / null; the exact-password no-op;
  active-jar-over-global tie-break) — exhaustively covered in `test/unit/vault-capture.test.js`.
- **Automation fill path** and the decorative lock icon / gesture-gated fill — covered by
  `vault-mcp-surface` and `vault-human-fill-boundary`.

## Variants (optional)

- **Locked vault → unlock-to-save.** Lock the manager, then submit a NEW credential on the fixture.
  Expected (INTERIM, Sortie 06 Leg 1; Leg 2 replaces the auto-raise with consent): an **unlock**
  sheet is raised first (the credential is held main-side); on a successful unlock the flow
  continues to the **"Save password?"** corner prompt (`savePromptVisible`, **[by-eye]**). If the submitted credential turns out
  to be the seeded, **unchanged** one, the post-unlock disposition offers **nothing** (the no-op
  guard applies after unlock too). Abandoning the unlock drops the held credential.
- **Prompt survives the submit navigation.** On the capture-mode fixture, confirm
  `savePromptVisible` is `true` after the page finishes loading — the corner prompt is not torn
  down by the focus-steal of the spawning navigation (it closes only on Save/Not now/✕, the ~10 s
  timeout, a tab switch, a lock, or window teardown; a window blur only PAUSES its timer).
- **Prompt chrome.** **[by-eye]** Confirm the corner prompt reads as a small non-modal card: a
  titled header with a visible **close (X)** button, a countdown bar, and "Not now" / "Save".
  (Pixels are out of MCP reach; the old sheet-pixel check is retired.)
- **Burner tab (DD9 suppression).** Submit a login on the fixture opened in a **burner** partition.
  Expected: **no** capture offer of any kind — burner partitions have no vault, so capture is
  structurally absent.
