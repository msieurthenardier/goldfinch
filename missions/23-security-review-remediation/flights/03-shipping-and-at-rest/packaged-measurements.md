# Packaged-build measurements (flight 03, leg 02)

Measured 2026-11-17 on the development host (Linux under WSL2, Wayland via WSLg). Electron **45.3.3**, Chromium **156.0.8078.100**, Node **24.22.3** (`process.versions`, read from the app and from `electron-fuses`/UA output). **Every packaged observation was taken with `--no-sandbox`** (the unpacked build has no setuid sandbox helper) and `--ozone-platform=wayland`, the same display switch `scripts/dev-launch.mjs` computes. No change was made to `src/`, `package.json`, `ci/` or tests. Probe code (Q3) lived only in scratch copies of `dist/linux-unpacked`; fuse flips were made only on scratch copies.

"The scratch directory" below is this leg's temporary working directory; it has been removed.

## Method and safety

- One launcher helper started every process. It refused to start anything unless `HOME` and `XDG_CONFIG_HOME` were two distinct directories inside the scratch directory, and recorded each pid. `XDG_RUNTIME_DIR`, `WAYLAND_DISPLAY`, `DISPLAY` and `DBUS_SESSION_BUS_ADDRESS` were inherited unchanged.
- Dev-mode automation used only `scripts/lib/mcp-client.mjs` `connectAutomation()` with keys parsed from the launch's `AUTOMATION_DEV_MINT` line (never printed). No registered MCP server was used. No vault was unlocked, nothing was written to the clipboard, no download was started, no native dialog was answered.
- Processes were stopped by recorded pid only.

## AC1 / Q1 — can a packaged build avoid the operator's real profile?

**Done.** `dist/linux-unpacked/goldfinch --no-sandbox --enable-logging` launched once with `HOME=<scratch>/home/ac1` and `XDG_CONFIG_HOME=<scratch>/xdg/ac1`, left for 20 s, stopped with SIGTERM (exit code 0).

**Observed.** The profile was created at `<XDG_CONFIG_HOME>/goldfinch` (`app.db`, `history.db`, `Cookies`, `Local State`, `Partitions`, …). `HOME` received only `.cache` (fontconfig, mesa shader cache) and `.local/share`. Nothing else was created.

**Answer: yes.** The packaged profile directory is named **`goldfinch`** (a dev launch uses `goldfinch-dev`), and **`XDG_CONFIG_HOME` alone is honoured** — the profile went to it, not to `HOME/.config`. Setting `HOME` as well is belt-and-braces and costs nothing. The real profile directories' own modification times were stat'ed (not opened): `goldfinch` last changed months ago; `goldfinch-dev` last changed 07:47 local on the day of measurement, before this leg's first launch (07:49). Only the directory entries' times were read; contents were never opened.

**Launch recipe for later legs (this host):**

```
env HOME=<scratch>/home/<run> XDG_CONFIG_HOME=<scratch>/xdg/<run> \
    <build>/goldfinch --no-sandbox --enable-logging [--ozone-platform=wayland] [url...]
```

- `--ozone-platform=wayland` is added when `src/main/ozone-platform.js` `decideOzonePlatform` says so (it returned wayland here); the launcher used that function.
- Profile = `$XDG_CONFIG_HOME/goldfinch`. A fresh run name gives a fresh profile.
- Stop by pid with SIGTERM (graceful: the app exits 0 and the Chromium children follow).

Not measured: macOS/Windows profile locations.

## AC2 — is a packaged build drivable over MCP from a seeded scratch profile?

**Answer: yes, both tiers.** The jar tier needs nothing extra; the admin tier needs `GOLDFINCH_AUTOMATION_ADMIN=1` in the packaged build's environment.

**Recipe (worked):**

1. In a **dev** launch under scratch `HOME`/`XDG_CONFIG_HOME` — `electron . --no-sandbox --automation-dev` with `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_MCP_PORT=<n>` — capture the one `AUTOMATION_DEV_MINT {"key":…,"adminKey":…}` line, then stop the app. The dev profile (`<XDG>/goldfinch-dev/app.db`) now holds the jar key hash (`personal`) and the admin key hash (64 hex characters).
2. Copy **`app.db` together with `app.db-wal` and `app.db-shm`** to `<target XDG>/goldfinch/` (the database is in WAL mode: copying `app.db` alone can lose the minted hashes). With `node:sqlite`, in the copy only: set the `settings` document's `automationEnabled` to `true` and `automationPort` to a free port, then `pragma wal_checkpoint(truncate)` and close. (A dev mint leaves `automationEnabled` false — in dev the bind is forced by `--automation-dev`; a packaged build binds on the persisted setting alone, at the settings port: `honorEnv: !app.isPackaged` ignores `GOLDFINCH_MCP_PORT`.)
3. Launch the packaged build with the launch recipe above, plus `GOLDFINCH_AUTOMATION_ADMIN=1` for the admin half.
4. `connectAutomation({ port: <settings port>, key })` with the captured key.

**Observed.** Without the admin flag: the packaged process listened on the settings port; the jar key connected (`enumerateTabs` returned `[]` on the empty boot, `enumerateWindows` answered `automation: admin-only …`, as for any jar key); the admin key was refused (client error `Streamable HTTP error: Error POSTing to endpoint:` with an empty body). With the flag: the jar key connected as before, the admin key connected, `enumerateWindows` returned the window (`booted: true`) and `getChromeTarget` answered with the chrome's `file://` URL under the build directory. After the Shields restart relaunch (AC4) the same two keys still worked. `process.versions.electron` from the packaged chrome's UA: `Electron/45.3.3`.

Consequence for later legs: a packaged build **is** drivable over MCP; the flight's apparatus assumption "every packaged observation is external" is too pessimistic. Fixtures are still loopback servers.

Not measured: `captureScreenshot`/`click`/`typeText` etc. on the packaged build (only `enumerateWindows`, `enumerateTabs`, `getChromeTarget`, `evaluate` and the relaunch path were exercised).

## AC4 / Q4 — the three runtime fuses

Done before AC3. A scratch copy of the unpacked build was flipped with `electron-fuses write --app <copy>/goldfinch RunAsNode=off EnableNodeOptionsEnvironmentVariable=off EnableNodeCliInspectArguments=off`. Read back (`electron-fuses read`):

```
  RunAsNode is Disabled
  EnableCookieEncryption is Disabled
  EnableNodeOptionsEnvironmentVariable is Disabled
  EnableNodeCliInspectArguments is Disabled
  EnableEmbeddedAsarIntegrityValidation is Disabled
  OnlyLoadAppFromAsar is Disabled
  LoadBrowserProcessSpecificV8Snapshot is Disabled
  GrantFileProtocolExtraPrivileges is Enabled
```

(Before the flip the first, third and fourth read Enabled.) A loopback fixture logged every request.

| Check | Result |
| --- | --- |
| App starts | Yes. Window up, MCP listening on the seeded port, chrome and tab reachable over MCP. |
| URL on the command line opens | Yes. Cold launch with `http://127.0.0.1:<port>/cold`: the fixture received `GET /cold` (and the favicon). |
| Second launch hands the URL to the first instance | Yes. A second launch with `/second` on the same profile exited (pid gone within 6 s); the fixture received `GET /second`; exactly **one** main process (no `--type=`) remained. |
| Shields restart-to-apply relaunch | Yes, through MCP admin: `shieldsSet({isolate:false})` then `shieldsRestartToApply()` from the chrome via `evaluate`. Before: `isolateEffective: true`; first call before the change answered `{ok:false,reason:"not-pending"}` (the business gate); after the change the old pid exited, a new process (new pid) listened on the same port, same keys accepted, `isolateEffective: false`. Launch arguments were carried over (the new process re-requested the launch URL; argv vs session restore was not distinguished). |

Each fuse's own effect, stock copy vs fused copy (same switches, fresh profiles):

| Fuse | Stock | Fused |
| --- | --- | --- |
| `RunAsNode` | `ELECTRON_RUN_AS_NODE=1 goldfinch -e 'console.log(…)'` prints `electron=45.3.3 node=24.22.3`, status 0 | prints nothing; the binary starts the app instead (still running when a 20 s timeout killed it) |
| `EnableNodeOptionsEnvironmentVariable` | `NODE_OPTIONS=--require <probe>` and `NODE_OPTIONS=--no-warnings`: Electron prints `Most NODE_OPTIONs are not supported in packaged apps` (so, on a stock packaged build, these options are already refused, and the probe did not run) | the variable is not consulted at all: no message, probe did not run |
| `EnableNodeCliInspectArguments` | `--inspect=<port>`: `GET /json/version` answered `HTTP 200`, stderr `Debugger listening on ws://127.0.0.1:<port>/…` | no answer on the port, no `Debugger listening` line |

**Answer: the three fuses break nothing the packaged app does here** (start, argument URL, second-instance hand-off, restart-to-apply relaunch all worked on the fused copy). Not measured: `SIGUSR1` opening the inspector (the fuse's other effect), a permitted `NODE_OPTIONS` value's effect before/after (only refused options were probed), Windows and macOS.

## AC3 / Q3 — launch switches

Each row used a fresh scratch profile and distinct loopback ports. (a) is the unmodified build; (b) is a scratch copy whose `src/main/main.js` first statements read the switch with `hasSwitch`, call `app.commandLine.removeSwitch(<name>)`, and read it again (logged; `before=true`, `after=false` in every removed row); (c) is the same point calling `app.exit(3)` after printing one line. Effects were observed from outside the app's own claims:

| Switch | Observation of effect | (a) baseline | (b) removed | (c) exit |
| --- | --- | --- | --- | --- |
| `--remote-debugging-port=<n>` | `GET /json/version` | answers (`Chrome/156.0.8078.100`) | no answer | no answer; code 3, no display init, one stdout line |
| `--remote-debugging-pipe` | CDP `Browser.getVersion` written to fd 3 | reply on fd 4 (`protocolVersion 1.3`, Chrome/156.0.8078.100) | no reply | no reply; code 3 |
| `--ignore-certificate-errors` | request reaching an HTTPS fixture with a self-signed certificate | request reached the fixture | none reached (certificate refused) | none; code 3 |
| `--disable-web-security` | page at `127.0.0.1:A` fetches `localhost:B/secret` (no CORS headers) and reports back to its own origin; control (no switch) reports `blocked` | `read:SECRETDATA` | `blocked` | no page; code 3 |
| `--host-rules=MAP mapped.test 127.0.0.1` | navigation to `http://mapped.test:<port>/x` | request reached the fixture (`Host: mapped.test:<port>`) | none | none; code 3 |
| `--host-resolver-rules=MAP mapped.test 127.0.0.1` | same | reached | none | none; code 3 |
| `--js-flags=--expose-gc` | page reports `typeof gc`; control reports `undefined` | `function` | **page: `undefined`, but the main process: `typeof gc` = `function`** (logged before removal; the flag was already applied to the browser process's V8) | no page; code 3 |
| `--load-extension=<dir>` | an MV3 extension's content script reporting to the fixture | **did not report: no effect** | no effect | n/a (exit works, but not needed) |

Notes:

- `--js-flags`: removal reaches child processes (the renderer lost the flag) but not the main process, which parsed it before any JS ran. Removal is therefore **not a complete neutralisation**; exit is.
- `--load-extension`: the fixture extension is valid — a positive control with `session.loadExtension` in a scratch Electron app on the stock dev binary reported `content-script-ran`. The command-line switch does nothing in Electron.
- Switch forms: only the `--name=value` form was given in every row. The bare and space-separated forms are for the decision function's unit test (DD5), not measured here.
- Not measured: `--remote-debugging-address`, `--remote-allow-origins`, `--ignore-certificate-errors-spki-list`, `--unsafely-treat-insecure-origin-as-secure`, `--disable-site-isolation-trials` (named in DD5's list, not in this leg's); `--no-sandbox` (stays honoured by ruling).
- An exit is observed as: exit code 3, one stdout line, no display-initialisation lines in stderr (no window), and no listening port.

**Summary table**

| Switch | Takes effect in this app? | Removable in time? | Recommended mechanism |
| --- | --- | --- | --- |
| `--remote-debugging-port` | yes | yes | `removeSwitch` |
| `--remote-debugging-pipe` | yes | yes | `removeSwitch` |
| `--ignore-certificate-errors` | yes | yes | `removeSwitch` |
| `--disable-web-security` | yes | yes | `removeSwitch` |
| `--host-rules` | yes | yes | `removeSwitch` |
| `--host-resolver-rules` | yes | yes | `removeSwitch` |
| `--js-flags` | yes (renderer and main process) | **partly** (renderer yes, main process no) | **exit** before opening a window, naming the switch |
| `--load-extension` | no | n/a | none needed (listing it in the removal set is harmless, and covers a later Electron that honours it) |

Caveat for DD5: removal is silent. If the operator should see why a switch had no effect, exit-for-all is also available and was shown to work for every row.

## AC5 / Q2 — the cookie-encryption fuse

Method: a scratch copy of the **dev** Electron binary (`node_modules/electron/dist`) with only `EnableCookieEncryption` turned on (read back: `EnableCookieEncryption is Enabled`; the repository's own binary reads Disabled and was not modified). The repository app was run from the repository in dev mode (`electron <repo> --no-sandbox`, dev profile under the scratch `XDG_CONFIG_HOME`) against a loopback fixture that sets one persistent cookie (`Max-Age=86400`) and logs the `Cookie` header of every request. The cookie database was read with `node:sqlite` from a copy, only for the fixture's own cookies.

(a) **Survival — yes.** Cookie set with the stock binary (`value` = 20 bytes plaintext, `encrypted_value` = 0 bytes). Relaunch on the fused binary: the first request carried the cookie. 

(b) **On disk — encrypted in place at first launch.** After that fused launch the row read `value` length 0, `encrypted_value` length 67, prefix `v10`: the existing cookie was migrated to the encrypted column on that launch. A cookie first written under the fuse was the same shape (`value` 0, `encrypted_value` 67, `v10`).

(c) **Backend.**

- `safeStorage.getSelectedStorageBackend()` / `isEncryptionAvailable()` on this host as launched (stock and fused identical): `basic_text` / `false`. Forced `--password-store=basic`: `basic_text` / `false`. Forced `--password-store=gnome-libsecret`: `gnome_libsecret` / `false`.
- Cookies are nevertheless encrypted on disk under the fuse (`v10`, above) even though `isEncryptionAvailable()` is false: the cookie layer uses Chromium's own fallback.
- Written under `--password-store=basic`, read under `--password-store=gnome-libsecret`: **sent**. Written under `gnome-libsecret` (no keyring present; on disk still `v10`), read under `basic`: **sent**. Both directions: yes.
- Keyring-backed store with a real keyring: **not measurable here.** No keyring is installed (`gnome-keyring-daemon`, `kwalletd5/6`, `secret-tool` absent; no `org.freedesktop.secrets` / kwallet name on the session bus, none activatable). Nothing was installed or started. So whether a cookie written with a keyring present (Chromium's `v11` form) survives the keyring later disappearing, and the reverse, was **not measured**.

(d) **The way back — lost.** A profile whose cookies were written under the fuse, opened with the stock binary: the cookies were **not sent** (every request had an empty `Cookie` header), and on a copy of the profile with the fixture stopped, the stock launch left the cookie table without them (both `v10` rows deleted). Electron's one-way claim is confirmed on this host: downgrading to a build without the fuse loses the cookies.

(e) **Dev launches.** A dev launch runs `node_modules/electron/dist/electron` — the unmodified binary; the fuse lives in the binary, so a dev launch is unaffected (observed: a stock dev launch writes plaintext, `encrypted_value` length 0).

**Three lines for the operator's ruling**

1. **Protects:** on a host like this one (no keyring) the fuse buys little — cookies move from plaintext to a `v10` value under Chromium's fixed fallback key, and `safeStorage` itself reports encryption unavailable; where an OS store exists (Windows DPAPI, the macOS keychain, a Linux keyring) the protection is real but this host cannot show it.
2. **Costs:** it is one-way and silent — existing cookies are migrated at the next launch, and any rollback to a build without the fuse (or a profile opened by a stock binary) loses every cookie (measured: dropped, no prompt); no cost was seen for switching backends on this host.
3. **Could not show:** Windows DPAPI behaviour and what a user-profile move does to it; the macOS keychain item and its tie to the app's (ad-hoc, per-build) signature, i.e. whether the next version can read the previous version's cookies; a real keyring appearing or disappearing (`v11`); kwallet.

## Not measured, with reasons

- Windows and macOS behaviour of any row (host is Linux).
- A real keyring (none installed; installing or starting one is out of bounds).
- Bare and space-separated switch forms; the five DD5 list switches not in this leg's list.
- `SIGUSR1` inspector; a permitted `NODE_OPTIONS` value.
- Packaged-build MCP primitives beyond `enumerateWindows`, `enumerateTabs`, `getChromeTarget`, `evaluate`.
- The `third-party-cookie-isolation` spec (not asked of this leg; leg `launch-switches` re-runs it).

## Surprises worth keeping

- After leg 1's `rm -r node_modules && npm ci`, `node_modules/electron/dist` was absent; the first `require('electron')` re-downloaded it silently (Electron's lazy fetch in `index.js`). Anything that spawns the dev binary right after an `npm ci` may pause on it.
- `app.db` is in WAL mode: a profile seed must carry the `-wal` and `-shm` files or checkpoint first.
- `/proc/<pid>/environ` is not a reliable witness of a Chromium process's environment (Chromium rewrites the block for the process title), so the relaunched process's `HOME` was not verified directly; it was verified by where its data landed (scratch only).
- A dev launch also creates an empty `goldfinch` directory beside `goldfinch-dev` in the config directory.
- With the cookie fuse on and no keyring, `isEncryptionAvailable()` is false yet cookies are encrypted at rest (fixed-key fallback).
