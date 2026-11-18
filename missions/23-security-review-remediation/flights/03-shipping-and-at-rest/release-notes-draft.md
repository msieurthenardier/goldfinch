# Release notes — draft

Draft for the first release that carries Mission 23 (the 2026-11-12 security review's fixes). The operator edits and uses it. The version number, the date and the final order are theirs. Every sentence below is limited to what the mission's flights verified; where something was checked only on a build runner or only on Linux, it says so.

## Before you upgrade: your vaults

After you first unlock your vault on this version, your vault files are converted to a new file version (version 2) that earlier versions of Goldfinch cannot open, and a bundle exported by this version cannot be opened by an earlier version either. The only way back is a copy of your vaults directory made before that first unlock — copy it now: the `vaults` folder inside Goldfinch's data directory (Linux `~/.config/goldfinch/vaults`, macOS `~/Library/Application Support/goldfinch/vaults`, Windows `%APPDATA%\goldfinch\vaults`). Goldfinch keeps no backup of the old files, on purpose.

If you never use the vault, nothing changes for you.

## What you will notice

- **Goldfinch tells you when a newer release exists.** About once a day it asks GitHub for the latest stable release and, if yours is older, shows `Update available` at the top of the ⋯ menu and in Settings → About, with a **Download now** button that starts an ordinary download of the installer for your computer (you run it to update) and a button that opens the release page. It never downloads anything unless you press the button, and never installs or runs anything itself. Turn it off with **Check for new versions** in Settings → About. The check sends no cookies and nothing that identifies you or your profile; GitHub sees your network address and your browser's language preference. Details: `docs/updates.md`.
- **A packaged build refuses some command-line switches.** Switches that turn off the browser's protections (for example `--js-flags` and the ones that disable site isolation) make Goldfinch exit with code 64 and a message naming the switch; others (remote debugging, ignoring certificate errors, disabling web security) are ignored with a one-line note. `--no-sandbox` and `--proxy-server` still work. If a shortcut or script of yours passes one of the refused switches, it will stop starting the app. Details: `docs/RELEASING.md`, *Launch switches*. A development launch (`npm start`, `npm run dev:automation`) is unaffected.
- **Releases are published differently.** Each release carries five installers (Windows `.exe`, macOS `.dmg` and `.zip`, Linux `.AppImage` and `.deb`). Each has a SHA-256 digest on the release page and is meant to carry a build provenance attestation. A release no longer carries the updater metadata files (`latest*.yml`, `*.blockmap`) or a checksum file. The first release built this way is where the attestation step first runs.
- **Saved cards, identities and logins are harder for a page to reach.** The vault's fill prompt now needs a real click, shows which site the data is going to, ignores input for half a second after it opens, and asks once before filling a card or identity on a site it has not been used on.
- **The vault locks when your computer sleeps** (and at quit), and a copied password or recovery key is cleared from the clipboard after about 20 seconds. On Linux, locking the screen does not lock the vault; only sleep does.
- **Automation keys can no longer read vault passwords or cookie values on their own.** Revealing one while an admin automation client is attached shows a confirmation dialog that only you can answer. Automation's mouse and keyboard input no longer triggers the browser's own shortcuts for a jar-scoped key.
- **Smaller things:** a page-suggested download file name is cleaned of control and direction-changing characters; Retry on a download goes through the jar it came from; `user:pass@` is no longer shown in the address bar or stored in history; the client-certificate picker opens with nothing selected; if the automation server cannot use its configured port, the Automation page and the toolbar indicator say which port it took.

## What changed underneath

- **Electron 45.3.3** (from 44.10.0). The store suites and the third-party-cookie isolation check were re-run on it.
- **The MCP transport's request library moved a major version** (`@hono/node-server` 1.x to 2.x, inside the MCP SDK's declared range), to clear two advisories. The unit suites that load the transport pass and every automation tool answered in a live run on Linux.
- **Runtime fuses.** Three Electron fuses are turned off in installed builds (running the binary as Node, `NODE_OPTIONS`, and `--inspect`). The fuse check passed on the Linux, Windows and macOS build runners; the app started on all three runners.
- **The release workflow** builds with no write access and holds the release token only in a separate upload job; a stable tag must be on `main`'s history (that check and the attestation step run only on a tag push and had not run when this draft was written).
- **Build tooling:** the `minimatch` advisory in the build and lint tools is fixed with temporary overrides (`ci/README.md`).
- **Not changed, by decision:** cookies are stored unencrypted on disk, builds are not code-signed, and the code on disk is not integrity-checked. Reasons are in `README.md` *Known limits* and the mission's *Dispositions* section.

## macOS users, please tell us

The fuse change was checked on a macOS build runner (the signature verifies and the app starts there), but nobody has run it on a Mac. If the macOS build does not open on your Mac, please open an issue and say what the system showed. The build is Apple Silicon only and unsigned, so the first launch still shows a Gatekeeper warning: allow it through.

## Verify your download

Compare the SHA-256 digest on the release page with your file (`sha256sum <file>` on Linux, `shasum -a 256 <file>` on macOS, `Get-FileHash <file>` in PowerShell). If you have a recent GitHub CLI with the `gh attestation` command:

```bash
gh attestation verify <file> -R msieurthenardier/goldfinch \
  --signer-workflow msieurthenardier/goldfinch/.github/workflows/build.yml
```

This shows the file was built by this repository's release workflow from the commit the attestation names. It does not show the code is safe, and it is not an operating-system signature: Windows SmartScreen and macOS Gatekeeper will still warn. (Edit before publishing: the attestation step and these commands have not run against a real release when this draft was written. Confirm them at the acceptance walk and drop this note, or the section, if they fail.)

## Operator notes (not for the published text)

- The tag ruleset and immutable releases were not applied when this draft was written. The immutable-release commands sentence is in `README.md` *Verify your download* (not in this draft); keep or remove it there according to whether the setting is on when this is published.
- Windows `/switch` forms, the real launch-switch error box on Windows and macOS, the kebab item and the About section's spacing are on the by-eye checklist in `docs/RELEASING.md` and had not been looked at on those platforms when this draft was written.
