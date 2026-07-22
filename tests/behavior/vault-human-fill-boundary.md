# Behavior Test: Human Fill Trust Boundary

**Slug**: `vault-human-fill-boundary`
**Status**: draft
**Created**: 2026-07-20
**Last Run**: never

## Intent

Verifies the **guest-observable** half of the password manager's human trust boundary
(Mission 12, Flight 2): that a decorative lock icon injected into a login form triggers a
**chrome-owned** prompt without ever placing that prompt — or the master password — into page
DOM, that faking or hiding the icon gains a hostile page nothing, and that fill is
gesture-gated, exact-origin-matched, and top-frame only. This needs real-environment
observation (a real page, real main-world injection, a real chrome sheet rendering over the
guest) that unit/integration tests cannot provide.

**Apparatus boundary (Flight 2 DD8):** the chrome-owned menu-overlay **sheet is deliberately
unreachable via MCP** — no tool exposes its WebContents; the only MCP view of it is an admin
`captureWindow` pixel screenshot. So this test verifies everything observable **from the guest
side + the screenshot**: the icon, the trigger, the *absence* of any prompt/secret in page
DOM, and fill outcomes. The sheet **interior** (password entry, picker selection) is verified
by main-process integration tests and the Flight 4 HAT — **not** here. Steps that would
require typing into or reading the sheet DOM are intentionally out of scope.

## Preconditions

- Goldfinch dev build running with the MCP automation surface (`npm run dev:automation`,
  loopback 49707).
- An **admin** transport key is minted (`GOLDFINCH_AUTOMATION_ADMIN` set) — needed for
  `captureWindow` (the sole MCP observation of the chrome sheet) and `getChromeTarget`.
- A **jar** transport key + a **jar vault access key** for the fixture jar (drives the guest
  tab; reads filled fields).
- The push-button vault-fixture builder has provisioned a **set-up manager** and the fixture
  jar's vault with at least one Login item whose `origin` matches the fixture page origin.
- The login-form fixtures are served (reuse/extend `tests/behavior/fixtures/vault-login/`):
  a normal login page, a multi-form page, and a page embedding a **cross-origin iframe**
  login. Origins are stable (fixed loopback port).

## Observables Required

- browser (guest DOM state, injected-icon presence, filled field values, absence of any
  prompt node in page DOM) — measured via the goldfinch MCP `readDom` / `evaluate` (jar or
  admin key, jar-membership-gated).
- image (chrome sheet render over the guest) — measured via goldfinch MCP admin
  `captureWindow` (pixel evidence; the sheet is not DOM-reachable).
- filesystem (optional: assert no plaintext credential written on disk during the flow) —
  measured via Read / Bash against the vault dir.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a tab in the fixture jar and navigate it to the normal login fixture page. Wait for the login form to render. | Page loads; a `<input type=password>` and its username field are present in the guest DOM. |
| 2 | Focus the username field, then the password field (each is shown on focus). Read the guest DOM after each focus. Confirm the injected decorative lock icon appears anchored near the **focused** field. | The icon is an **inline SVG** lock glyph (renders correctly — no `🔒` tofu box), carrying `role="img"` + `aria-label="Fill login from vault"` + `data-goldfinch-vault-lock`. It appears **only while its field is focused** and is anchored near that field's right edge — for **both** the username and the password field. It carries no credential text/value. Blurring to a non-login element hides it. |
| 3 | Read the guest DOM in full and search it for any master-password prompt, unlock dialog, or vault picker. | **No** unlock prompt, master-password input, or picker node exists anywhere in page DOM (the prompt is chrome-owned, not in content). |
| 4 | Focus the password field so its icon is shown, then click the injected lock icon (guest `click`). Then capture the window via admin `captureWindow`. | The click triggers a **chrome-owned** prompt: the screenshot shows a master-password / unlock sheet rendered over the guest region. The click still lands even though the icon is shown-on-focus (the icon's mousedown keeps the field focused). The guest DOM (re-read) still contains no prompt node and the password field is still empty. |
| 5 | While the chrome prompt is up, read the guest DOM and evaluate `document.activeElement` and the password field value. | The guest page has **not** received focus of any master-password field and the login password field remains empty — the master password is being entered (if at all) only in the chrome sheet, invisible to the page. |
| 6 | Dismiss the flow (press Escape targeting the chrome, or trigger a window blur). Re-read the guest DOM and the password field. | The prompt closes; the guest login form is unchanged and unfilled — dismissing without completing the chrome flow fills nothing. |
| 7 | In the guest page, evaluate a script that **removes / hides / replaces** the injected lock icon (simulate a hostile page defacing it). Then re-read the DOM and confirm no credential or vault state leaked into the page. | Removing/faking the icon changes nothing observable to the page: no credential, vault key, item list, or master password is present anywhere in page-accessible JS/DOM. The icon is decorative (DD1). |
| 8 | (Setup: via the fixture/integration seam, complete an unlock + pick so a fill is dispatched to this exact-origin top-frame form — the sheet interaction itself is out of MCP scope; this row stages the fill.) | (empty — setup only) |
| 9 | After the staged fill, read the filled username and password field values in the guest DOM. | The correct credential is present in the top-frame login form's fields; the filled password value equals the fixture credential (the fill mechanism, proven in F1, works through the human path too). |
| 10 | Navigate a **different-origin** tab (or the cross-origin iframe fixture) and attempt the same lock-icon → fill for a credential whose stored `origin` does NOT match. | The fill is refused for the origin mismatch: the wrong-origin form is never populated, and a cross-origin iframe login is never filled (top-frame + exact-origin only, DD6). |
| 11 | (Optional) Inspect the vault directory on disk during/after the flow. | No plaintext credential appears on disk at any point (encrypted-at-rest holds through the human path). |

## Out of Scope

- **Sheet interior**: entering the master password into the unlock prompt, the badged picker's
  contents and selection, and the Buffer secret-channel zeroization — all verified by
  main-process integration tests (simulated sheet IPC) and the Flight 4 HAT. The sheet is
  MCP-unreachable by design (DD8); this test does not read or type into it.
- **Capture** save/update prompt behavior — covered by its own steps in integration + the F4
  HAT; a capture-specific behavior slice may be added when Leg 3 lands.
- **Automation fill path** — covered by F1's `vault-mcp-surface` behavior test.
- **First-run setup** (master password chosen, recovery key shown once) — Flight 3.

## Variants (optional)

- **Multi-form page**: repeat steps 1–4 on the multi-form fixture; confirm a decorative icon
  appears on focus for the username and password field of each detected login form, and each
  triggers the chrome-owned flow.
- **Burner tab (DD9 suppression)**: open the same login fixture in a **burner** (non-persistent)
  partition and read the guest DOM. Expected: **no** lock icon is injected, and clicking where
  the icon would be (or dispatching a synthetic gesture) raises **no** chrome prompt — burner
  partitions have no vault, so the human fill surface is structurally absent.
- **Scripted click (DD3 `isTrusted`)**: in the guest page, call `iconEl.click()` (a synthetic,
  untrusted click) rather than a real pointer gesture. Expected: **no** chrome prompt is raised
  — only a genuine user gesture (`event.isTrusted`) triggers the unlock sheet.
- **Right-click icon → NATIVE menu, no guest DOM (M12 F5 HAT batch 1, I8)**: right-click (real
  `contextmenu`) the injected lock icon. Expected: a **native OS context menu** appears (top row
  "Lock now") — verified via admin `captureWindow` pixels, since a native menu is not DOM. Re-read
  the guest DOM in full and search it for any injected menu element (role="menu"/`<menu>`/a
  vault-menu container): **none exists** — the menu is a main-process `Menu.popup`, never injected
  into the page (a page-DOM menu would be spoofable/readable by a hostile page). Extends the
  DOM-absence assertions in steps 3/4/7 to the context-menu path. Choosing **"Lock now"** locks
  every vault globally (the toolbar lock indicator + any open `goldfinch://vault` page flip to
  locked). A **scripted** (`isTrusted:false`) `contextmenu` dispatch raises **no** menu.
