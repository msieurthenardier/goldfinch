# Squawk 0213: `media-controller.js` interpolates `item.type` into `innerHTML` unescaped

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
One media-panel row template puts `item.type` into an `innerHTML` string without escaping (the sibling template escapes its fields). It is safe today only because main's media-list validator restricts `type` to four values; the chrome sink should not depend on that. Defense in depth. Found by routine maintenance 2026-11-18 (finding #32).

## Evidence
- `src/renderer/chrome/media-controller.js` — the second `innerHTML` template (~:231) uses `${item.type}`; the first (~:184) escapes name and label.
- `src/main/media-list.js` — `type` allowlist image/video/audio/embed.

## Corrective Action
`src/renderer/chrome/media-controller.js` `playInline`: the `thumb.innerHTML = \`<label ...>${item.type}...\`` template is replaced by `thumb.innerHTML = ''` (constant clear) plus `createElement('label.media-pick')` > `createElement('span.badge')` with `textContent = item.type`, appended; same DOM structure. Test added: `test/unit/media-controller.test.js` 'inline play builds the badge with textContent...' (renders a video card, clicks its Play here button with `item.type` mutated to `<img src=x onerror=alert(1)>`, asserts label/span structure, badge text equals the raw string, no `img` element).

## Verification
The row is built with `createElement`/`textContent` (or `item.type` is escaped); a unit test renders a row with a hostile `type` string and asserts no element is created from it.

Ran: `node --test test/unit/media-controller.test.js` 15/15 pass; `npm test` 7388 tests, 7383 pass, 0 fail (rest skipped); lint, typecheck clean; `npm run format` then `format:check` clean.
`grep -n innerHTML src/renderer/chrome/media-controller.js`: :105, :231, :300, :321 are `= ''` constants; :184 escapes with `escapeHtml`; :714/:724 escape title/body; :735 is a constant template. No unescaped interpolation remains.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the second 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. `playInline` builds the badge with `createElement`/`textContent` in the same DOM structure; remaining `innerHTML` writes are constants or escaped. Neuter check: restoring the old interpolated template turns the new test red (14 pass, 1 fail). Gates at review: `npm test` 7,388 tests (7,383 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-b`
