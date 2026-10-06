# Behavior Test: Inline PDF Viewing Without Double-Download

**Slug**: `web-compat-pdf`
**Status**: active
**Created**: 2026-07-27
**Last Run**: 2026-10-06-13-24-48 (pass, 6/6, batched, first run; steps 1/5/6 pass on intent, see the run log for limits and recommended amendments)

## Intent

Verifies that navigating to a PDF renders it inline in the tab through Chromium's built-in viewer and that the same navigation does not also auto-save a file — the download handler currently accepts every `will-download` unconditionally, so "no file appeared" is a real assertion, not a formality. Also pins that explicit attachments still download.

## Preconditions

- **Downloads-dir isolation (added 2026-10-06 after the first run).** The app saves to `app.getPath('downloads')`, which is the operator's real `~/Downloads` by default. Run under a scratch `XDG_CONFIG_HOME`, and before launch write `$XDG_CONFIG_HOME/user-dirs.dirs` containing `XDG_DOWNLOAD_DIR="<evidence>/downloads"`. Step 4's `downloadsList` `savePath` verifies the redirect.

- Fixture server running: `node tests/behavior/fixtures/web-compat/serve.mjs --port {P} --log {logpath}` — `/doc.pdf` serves a generated multi-page PDF inline (step 3's scroll depends on it); `/doc-attachment.pdf` serves the same bytes with `Content-Disposition: attachment`.
- App launched via `npm run dev:automation`, fresh profile; downloads directory known and empty at start.
- goldfinch MCP reachable.

## Observables Required

- browser (viewer surface via `readDom`/`captureScreenshot`; downloads UI via `downloadsList` — goldfinch MCP)
- filesystem (downloads directory listing — Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Snapshot the downloads directory listing. Record timestamp T0 and open a tab to `http://127.0.0.1:{P}/doc.pdf`. Take a timed capture (`captureScreenshot`/`readDom`) and record its timestamp T1. | T1 − T0 ≤ 3s, with both timestamps recorded in the run log: the capture shows visible page content of the fixture PDF and DOM/AX shows the viewer surface, not a blank or error page. A pass without recorded timestamps is not a pass. |
| 2 | Wait 2s, then list the downloads directory and call `downloadsList`. | No new file in the directory; no new entry in the downloads surface — inline render did not double-trigger a download. |
| 3 | Scroll the viewer. | Viewer responds (page position changes) — it is a live viewer, not a static error frame. |
| 4 | Navigate the tab to `http://127.0.0.1:{P}/doc-attachment.pdf`. | Within 3s a download completes: new file in the downloads directory and a new `downloadsList` entry. No viewer takeover — the tab's rendered content remains the step-1 `/doc.pdf` viewer. *(The MCP `navigate` call itself returns `ERR_FAILED (-2)`: that is the expected shape of a navigation converted to a download, not a failure.)* |
| 5a | Call MCP `navigate` on the PDF tab to `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html`. | The call is refused at the automation `bad-url` gate and the tab does not land on an extension page. *(Proves ONLY the automation URL gate. It does not reach the app's top-frame guard.)* |
| 5b | Type the same URL into the omnibox (`#address`) and submit. **Run last among the PDF-tab steps: it replaces the `/doc.pdf` viewer.** | The omnibox normalizes the input to `https://chrome-extension//…`, which fails (`ERR_NAME_NOT_RESOLVED`); no extension page commits. *(Proves ONLY omnibox normalization. The app's own top-frame guard for `chrome-extension:` is not reachable from steps 5a/5b; it is unit-pinned in `test/unit/guest-wiring.test.js`, test `PDF-viewer carve-out: top-frame will-navigate and will-redirect to the viewer URL stay refused (guardNav untouched)`, with the matrix of sibling `PDF-viewer carve-out` tests.)* |
| 6 | Open `http://127.0.0.1:{P}/oauth/opener.html` and wait for it to load. `evaluate` a page-JS top-frame navigation attempt: `location.href = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'`. Wait 3s, then read the tab URL and DOM, and capture refusal evidence: the guest console messages and/or the app main log (dev-automation stdout) for the blocked navigation. | The navigation does not commit: after 3s the tab is still on `/oauth/opener.html` with no extension content in the DOM, and the console or main-log evidence of the refusal is quoted in the run log. If Chromium refuses before any log line is emitted, record that explicitly (absence of evidence after the 3s wait) rather than passing silently. *(The guard's strictness is unit-pinned in `test/unit/guest-wiring.test.js`.)* |

**Ordering note.** Step 5b replaces the PDF tab's content, so it must follow steps 1-4. Steps 5a and 6 do not disturb the viewer, but run 6 in its own tab.

**Apparatus notes.**
- `click` does not reach the PDF viewer's out-of-process iframe (OOPIF); `scroll` does. Use `scroll` for step 3.
- `captureWindow` can fail transiently with "chrome window unavailable". Fall back to `captureScreenshot` against the chrome wcId (admin tier, via `getChromeTarget`) and note the fallback in the run log.

## Out of Scope

- PDF viewer feature depth (search, print, annotations) — Chromium built-ins, not goldfinch surface.
- MIME-sniffed extensionless PDFs — follow Chromium defaults; revisit only if real-world breakage appears.
