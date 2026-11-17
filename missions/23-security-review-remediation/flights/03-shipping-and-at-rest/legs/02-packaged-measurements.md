# Leg: packaged-measurements

**Status**: landed
**Flight**: [Shipping and At-Rest](../flight.md)
**Kind**: measurement — no change to `src/`, `package.json` or CI. The output is a results document the next four legs and one operator ruling are built on.

## Objective

Measure, on this host, the four things the flight's later decisions rest on — whether a packaged build can run without touching the operator's profile (Q1), which launch switches can be neutralised before they take effect (Q3), what the cookie-encryption fuse does to a profile (Q2), and whether the three runtime fuses break anything (Q4) — and write the answers down with the evidence.

## Context

- Flight Q1–Q4, feeding DD2 (`runtime-fuses`), DD5 (`launch-switches`) and DD6 (the operator's cookie ruling). Flight 2 debrief, recommendation 2: measure the platform before locking a decision on it.
- **A packaged build does not take the dev-profile redirect.** `src/main/main.js` — `if (!app.isPackaged) { app.setPath('userData', devUserDataPath(app.getPath('userData'))); }`. Unredirected, a packaged build opens the operator's real profile directory and contends for its single-instance lock (`app.requestSingleInstanceLock()` a few lines below, keyed on `userData`).
- **The safety rule for every launch in this leg, packaged or not**: the process environment sets **both** `HOME` and `XDG_CONFIG_HOME` to directories inside this leg's scratch directory. With `HOME` redirected as well, a launch cannot reach the real profile even if `XDG_CONFIG_HOME` turns out not to be honoured — so Q1 is answered by seeing *which scratch directory* received the profile, never by watching the real one. `XDG_RUNTIME_DIR`, `WAYLAND_DISPLAY`, `DISPLAY` and `DBUS_SESSION_BUS_ADDRESS` are inherited unchanged (the display needs them).
- An unpacked build on this host needs `--no-sandbox` (no setuid helper) and the same display switches `scripts/dev-launch.mjs` computes for a dev launch — read that script and `docs/dev-testing.md` (*ozone / WSLg notes*) and pass the equivalent switches by hand. Every observation in the results says it was taken with `--no-sandbox`.
- **A packaged build has no dev key minting**, so the flight's apparatus table assumed every observation on it is external. This leg tests a better premise (step 2 below): the production attach path — automation enabled and a key hash present in the settings document — needs no human if the scratch profile's `app.db` was produced by a **dev-mode** launch with `GOLDFINCH_AUTOMATION_DEV_MINT=1` and then placed where the packaged build looks. If that works, the packaged build is drivable over the MCP surface with `connectAutomation()` like any dev launch, and the later legs' apparatus improves. If it does not, say why and fall back to external observation.
- **Probes that need code** (Q3's `removeSwitch` calls) are made only in a **scratch copy** of `dist/linux-unpacked` — the app is unpacked (`asar: false`), so its `resources/app/src/main/main.js` can be edited in the copy. The repository's `src/` is not touched.
- External observation, where used, is a loopback fixture the leg's own script serves: a request arriving (or not) is the evidence.
- Electron is at whatever leg `dependencies` landed (expected 45.3.3). Every result records `process.versions.electron` and `process.versions.chrome`.

## Inputs

- Leg `dependencies` landed. `npm run pack` produces `dist/linux-unpacked/` (gitignored).
- `@electron/fuses` 1.8.0 and its `electron-fuses` CLI in `node_modules/.bin`.

## Outputs

- `missions/23-security-review-remediation/flights/03-shipping-and-at-rest/packaged-measurements.md` — the results, in the order below; for each question: what was done, what was observed, the answer in one sentence, and what was **not** measured.
- A flight-log entry summarising the answers and pointing at the document.
- Nothing else in the repository changes. Scratch directories are removed at the end.

## Acceptance Criteria

- [ ] **AC1 — Q1, measured before any other packaged launch.** With `HOME` and `XDG_CONFIG_HOME` both in scratch (two different directories), launch `dist/linux-unpacked`'s binary once and quit it. The document states which directory received the profile, the profile directory's name, and therefore whether `XDG_CONFIG_HOME` alone is honoured. It also states the exact environment and switches a later leg must use to launch a packaged build on this host. **If the profile lands in neither scratch directory: stop the leg, launch nothing further, signal `[BLOCKED:profile-not-isolated]`.**
- [ ] **AC2 — Is a packaged build drivable over MCP with a seeded scratch profile?** Produce a settings document with automation enabled and a jar key (and admin key) minted, by a dev-mode launch against the scratch home; place its `app.db` in the packaged build's scratch profile; launch the packaged build (with `GOLDFINCH_AUTOMATION_ADMIN=1` for the admin half) and attempt `connectAutomation()` with the captured keys. Answer yes or no for each tier, with the recipe if yes and the observed refusal if no. This is a question, not a requirement: "no" is a valid result and the remaining criteria then use external observation.
- [ ] **AC3 — Q3, per switch.** In a scratch copy of the unpacked build, for each of `--remote-debugging-port=<n>`, `--remote-debugging-pipe`, `--ignore-certificate-errors`, `--disable-web-security`, `--host-rules=…` (and `--host-resolver-rules=…`), `--js-flags=…`, `--load-extension=…`, three rows: (a) **baseline** — the switch as given, unmodified app: does it take effect at all in this app? (b) **removed** — the copy's startup block calls `app.commandLine.removeSwitch(<name>)` as its first statements, before `ready`: does the effect stop? (c) where (b) fails, **exit** — the copy prints one line and calls `app.exit(…)` at the same point: no window, no listening port. Each effect is observed from outside the app's own claims: the debugging port answering `/json/version`; a CDP message answered over the pipe; a request reaching a fixture whose certificate is self-signed; a cross-origin read succeeding and being reported back to the page's own origin; a request for a mapped hostname reaching the fixture; a page reporting a capability that only the flag grants; an extension's content script reporting in. A switch that has no effect in row (a) is recorded as such — it needs no refusal. The document ends this section with a table: switch → takes effect? → removable in time? → recommended mechanism.
- [ ] **AC4 — Q4, the three runtime fuses.** On a second scratch copy of the unpacked build with `runAsNode`, `enableNodeOptionsEnvironmentVariable` and `enableNodeCliInspectArguments` turned off by the fuses CLI (read back and quoted): the app starts; a URL passed on the command line opens (the fixture receives the request); a second launch with another URL hands it to the first instance and exits (the fixture receives it; one process remains); the Shields restart-to-apply relaunch works (through MCP if AC2 answered yes; otherwise recorded as **not measured**, with the reason, and carried to the walk); and each fuse's own effect is shown before and after — `ELECTRON_RUN_AS_NODE=1 <binary> -e …`, `NODE_OPTIONS=…`, `--inspect`.
- [ ] **AC5 — Q2, the cookie-encryption fuse.** Using a scratch copy of the **dev** Electron binary (`node_modules/electron/dist`) with only `enableCookieEncryption` turned on, run the app from the repository in dev mode against a scratch home, with a loopback fixture that sets one long-lived cookie and logs the `Cookie` header it receives:
  - (a) **survival** — set the cookie with the stock binary; relaunch on the fused copy: is the cookie sent?
  - (b) **on disk** — after that launch, and after a cookie first written under the fuse: the cookie database's `value` and `encrypted_value` for that row (lengths and whether `value` is empty — never the bytes of anything but the fixture's own test cookie), read with `node:sqlite`.
  - (c) **backend** — `safeStorage.getSelectedStorageBackend()` and `isEncryptionAvailable()` on this host as launched; then the same with the backend forced each way the platform allows (`--password-store=basic`, and a keyring-backed store **only if one is already installed** — install nothing): is a cookie written under one backend still sent when the other is selected, in both directions?
  - (d) **the way back** — a profile whose cookies were written under the fuse, opened with the stock binary: sent or lost? (Electron's documentation says lost; this is the one-way claim DD6 turns on.)
  - (e) **dev launches** — one sentence, from the mechanism: a dev launch runs the unmodified binary and is unaffected.
  Each of (a)–(d) is answered yes / no / **not measurable here** with the reason. The section ends with a three-line summary written for the operator's ruling: what turning it on would protect on a host like this one, what it would cost, and what this host could not show (Windows DPAPI, the macOS keychain and its tie to an ad-hoc signature).
- [ ] **AC6 — Hygiene.** No launch without the two redirected variables. No vault unlock, no clipboard write, no download, no use of the registered MCP servers. Every process the leg started has exited and no port it opened is still bound (`pgrep`, `ss` output quoted). The scratch directory is removed with a plain `rm -r <path>`. `git status` shows only the results document, the leg's status line and the flight-log entry as this leg's changes. `npx prettier --check` passes on the two documents.
- [ ] **AC7 — The document is fit for a public repository.** No user name, home path, host name, key, or cookie other than the fixture's test cookie. Paths are written relative to "the scratch directory".

## Verification Steps

- The Flight Director reads `packaged-measurements.md` against each criterion; every answer must cite an observation, and every "not measured" must say why.
- AC6: the quoted `pgrep` / `ss` / `git status` output in the leg's report.

## Implementation Guidance

1. Scratch root: `<session scratchpad>/leg02/` with `home/`, `xdg/`, `fixtures/`, `builds/`. Write one small launcher helper that refuses to start anything unless both variables point inside the scratch root.
2. `npm run pack`. AC1 on the result. Then AC2.
3. AC4 (fuses) before AC3 — it is short and tells you whether a flipped binary runs at all.
4. AC3, one switch at a time, a fresh scratch profile per row so that nothing carries over. Use distinct ports per row.
5. AC5 last; it uses the dev binary and the repository's own `src/`, not the packaged copy.
6. Write the document as you go. Clean up. Leg `landed`, flight-log entry, `[LAND:leg]`. Do not commit.

## Edge Cases

- **A native dialog or first-run surface appears** on a fresh scratch profile: do not answer dialogs by automation that is not attached to that build; wait, observe, record. The welcome tab is expected.
- **The packaged build will not start under WSLg** even with the display switches: record the stderr, try the documented alternative from `docs/dev-testing.md` once, and if it still fails signal `[BLOCKED:packaged-launch]` — Q2 (dev binary) can still be measured and reported first.
- **`--remote-debugging-pipe` cannot be exercised** from a Node parent on this host: record how far it got; "not measured" with the reason is acceptable for that one row.
- **Electron ignores `--load-extension`** (it has no extension command-line loader in the usual sense): then row (a) says "no effect" and the switch needs no refusal — that is a result.
- **A switch's effect is visible only after `ready`**, so removal "works" but too late for some early consumer: say exactly what was observed and recommend the exit mechanism.
- **No keyring on this host**: (c)'s keyring half is "not measurable here". Do not install or start a keyring service that is not already present.
- **Port in use**: pick another; fixtures bind port 0 where the test allows.
- **A process will not exit**: `kill` by the pid the launcher recorded — never `pkill` by name (the operator may have their own Goldfinch or Electron running).
- **Anything that looks like it touched a real profile**: stop at once and report.

## Files Affected

- `missions/23-security-review-remediation/flights/03-shipping-and-at-rest/packaged-measurements.md` (new)
- `…/flight-log.md` (leg entry), this file's status line

## Citation Audit

Checked by the Flight Director on 2026-11-17: `src/main/main.js` — the `!app.isPackaged` `setPath('userData'` block, `requestSingleInstanceLock()` after it, and the single `appendSwitch('enable-features'` after that; `package.json` — `asar: false`, `scripts.pack` (`electron-builder --dir`), `scripts['dev:automation']` (passes `--no-sandbox`); `node_modules/.bin/electron-fuses` present (flight prerequisite); `mcp-server.js` — `honorEnv: !app.isPackaged` (the port environment override is dev-only, so a packaged build listens on the settings port). The seeded-profile premise of AC2 is **not** verified by reading — it is the criterion. Tier: **low** — no repository source changes; the risk is to the operator's profile and is closed by redirecting `HOME` as well as `XDG_CONFIG_HOME` on every launch.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
