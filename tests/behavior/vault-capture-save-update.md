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

**Apparatus boundary (mirrors `vault-human-fill-boundary`, Flight 2 DD8):** the chrome-owned
menu-overlay **"Save password?" / "Update password?" sheet is MCP-unreachable** — no tool exposes
its WebContents. Its presence/absence is observed **only** via an admin `captureWindow` pixel
screenshot; the captured password never enters page DOM. The sheet **interior** (choosing a vault,
clicking Save) is verified by main-process integration tests + the Flight 4 HAT and is **staged**
here via the fixture/integration seam — this test does not type into or read the sheet.

## Preconditions

- Goldfinch dev build running with the MCP automation surface (`npm run dev:automation`, loopback
  49707).
- An **admin** transport key is minted (`GOLDFINCH_AUTOMATION_ADMIN` set) — needed for
  `captureWindow` (the sole MCP observation of the chrome sheet).
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
- image (the chrome save/update sheet rendered over the guest — **presence AND absence**) —
  measured via goldfinch MCP admin `captureWindow` (pixel evidence; the sheet is not DOM-reachable).
- filesystem (optional: the stored vault item's password before/after) — measured via the vault
  read seam / integration, never by reading the sheet.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a tab in the fixture jar and navigate it to the login fixture. Wait for the form to render. Confirm the vault is UNLOCKED (toolbar lock indicator unlocked). | Page loads; a `<input type=password>` + username field are present. The manager is set up and unlocked (the capture gate needs unlocked; a locked vault is the variant below). |
| 2 | **NEW login (save).** Type a brand-new credential into the form — `username: "bob@example.com"`, `password: "s3cret-new"` — and submit the form. Immediately `captureWindow` (admin). | A chrome-owned **"Save password?"** sheet renders over the guest (pixel evidence): a save offer, since no stored login matches this username at this origin. Re-read the guest DOM in full: **no** prompt node, and **no** password value, exists anywhere in page DOM (the offer is chrome-owned; the captured password lives only main-side). |
| 3 | Complete the save (staged via the fixture/integration seam — the sheet interior is out of MCP scope): choose the fixture jar and Save. Read the jar vault back via the vault seam. | The jar vault now holds a login `{ username: "bob@example.com", password: "s3cret-new", origin }` in addition to alice's. The held capture record is dropped (no lingering password). |
| 4 | **UNCHANGED re-login (NO offer — the regression guard).** Reload the fixture. Type the **already-stored, unchanged** credential — `username: "alice@example.com"`, `password: "correct-horse"` (the seeded item) — and submit. `captureWindow` (admin) after the submit settles. | **No** save/update sheet appears — the screenshot shows the plain page with **no** chrome prompt over it. The submitted `{username, password}` exactly matches the stored item, so there is nothing to save. The guest DOM likewise has no prompt node. *(Before the fix this wrongly showed an "Update password?" sheet.)* |
| 5 | **CHANGED password (update).** Reload the fixture. Type `username: "alice@example.com"` with a **different** password — `password: "rotated-9000"` — and submit. `captureWindow` (admin). | A chrome-owned **"Update password?"** sheet renders over the guest (pixel evidence): the username matches a stored login at this origin but the password differs, so an update is offered. Guest DOM still contains no prompt node / no password value. |
| 6 | Dismiss the update sheet WITHOUT saving (Escape targeting the chrome / window blur). Re-read the jar vault via the seam. | The sheet closes; the stored alice login is **unchanged** (`password` still `"correct-horse"`) — dismissing offers nothing and the held capture record is dropped. |

## Out of Scope

- **Sheet interior**: choosing the destination vault, clicking Save/Update, and the Buffer
  secret-channel zeroization — verified by main-process integration tests and the Flight 4 HAT.
  Steps 3 and 6 stage/read around the sheet, never through it (MCP-unreachable by design, DD8).
- **Disposition unit logic** (`disposeCapture` → save / update / null; the exact-password no-op;
  active-jar-over-global tie-break) — exhaustively covered in `test/unit/vault-capture.test.js`.
- **Automation fill path** and the decorative lock icon / gesture-gated fill — covered by
  `vault-mcp-surface` and `vault-human-fill-boundary`.

## Variants (optional)

- **Locked vault → unlock-to-save.** Lock the manager, then submit a NEW credential on the fixture.
  Expected: an **unlock** prompt is raised first (the credential is held main-side); on a successful
  unlock the flow continues to the **"Save password?"** sheet. If the submitted credential turns out
  to be the seeded, **unchanged** one, the post-unlock disposition offers **nothing** (the no-op
  guard applies after unlock too). Abandoning the unlock drops the held credential.
- **Prompt survives the submit navigation.** On a fixture whose submit navigates the page, confirm
  (via `captureWindow`) that the "Save password?" sheet **stays up** after the page finishes loading
  — it is not torn down by the focus-steal of the spawning navigation (it dismisses only on an
  explicit Save/Cancel/Escape or a real app-switch).
- **Sheet chrome.** Confirm (pixel evidence) the save/update sheet reads as a real modal: a titled
  header with a visible **close (X)** button and comfortable spacing (parity with the picker/unlock
  sheets).
- **Burner tab (DD9 suppression).** Submit a login on the fixture opened in a **burner** partition.
  Expected: **no** capture offer of any kind — burner partitions have no vault, so capture is
  structurally absent.
