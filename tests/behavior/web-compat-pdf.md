# Behavior Test: Inline PDF Viewing Without Double-Download

**Slug**: `web-compat-pdf`
**Status**: active
**Created**: 2026-07-27
**Last Run**: never

## Intent

Verifies that navigating to a PDF renders it inline in the tab through Chromium's built-in viewer and that the same navigation does not also auto-save a file — the download handler currently accepts every `will-download` unconditionally, so "no file appeared" is a real assertion, not a formality. Also pins that explicit attachments still download.

## Preconditions

- Fixture server running: `node tests/behavior/fixtures/web-compat/serve.mjs --port {P} --log {logpath}` — `/doc.pdf` serves a generated multi-page PDF inline (step 3's scroll depends on it); `/doc-attachment.pdf` serves the same bytes with `Content-Disposition: attachment`.
- App launched via `npm run dev:automation`, fresh profile; downloads directory known and empty at start.
- goldfinch MCP reachable.

## Observables Required

- browser (viewer surface via `readDom`/`captureScreenshot`; downloads UI via `downloadsList` — goldfinch MCP)
- filesystem (downloads directory listing — Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Snapshot the downloads directory listing. Open a tab to `http://127.0.0.1:{P}/doc.pdf`. | Within 3s the tab renders the PDF viewer (visible page content of the fixture PDF in a capture; DOM/AX shows the viewer surface, not a blank or error page). |
| 2 | Wait 2s, then list the downloads directory and call `downloadsList`. | No new file in the directory; no new entry in the downloads surface — inline render did not double-trigger a download. |
| 3 | Scroll the viewer. | Viewer responds (page position changes) — it is a live viewer, not a static error frame. |
| 4 | Navigate the tab to `http://127.0.0.1:{P}/doc-attachment.pdf`. | Within 3s a download completes: new file in the downloads directory and a new `downloadsList` entry. No viewer takeover — the tab's rendered content remains the step-1 `/doc.pdf` viewer. |
| 5 | Navigate a tab directly to `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html` via the omnibox/navigate path. | The navigation does not commit: the tab does not land on an extension page. *(Seam note: refusal mechanism is unit-pinned, not judged here.)* |
| 6 | On a loaded fixture page, `evaluate` a page-JS top-frame navigation attempt: `location.href = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'`. | The navigation does not commit: the tab remains on the fixture page with no extension content in the DOM. *(Seam note: Chromium may refuse before any nav event fires; the guard's strictness is unit-pinned.)* |

## Out of Scope

- PDF viewer feature depth (search, print, annotations) — Chromium built-ins, not goldfinch surface.
- MIME-sniffed extensionless PDFs — follow Chromium defaults; revisit only if real-world breakage appears.
