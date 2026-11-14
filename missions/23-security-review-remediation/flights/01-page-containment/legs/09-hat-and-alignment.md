# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Page Containment](../flight.md)
**Kind**: interactive — human acceptance test. The operator performs each step; the Flight Director presents one step at a time, waits for the result, and fixes what the operator finds before moving on. No crew agent runs this leg on its own.

## Objective

Have the operator see and use everything this flight changed that automation could not observe — above all the vault picker, which is the stated defence against the flight's one accepted residual — and align anything that looks or behaves wrong.

## Context

- Every implementation leg left a by-eye list in its flight-log entry; the flight-end reviewers added more. This leg is those lists, de-duplicated and ordered by how much rests on them.
- **Why the vault walk comes first.** A hostile page can turn a real click anywhere on itself into a raised picker (accepted by operator ruling). What stops a misdirected click from filling is the picker itself: the destination line, nothing selected, the half-second arming, the card / identity confirmation, the certificate warning. None of that is visible to automation. It has unit and integration tests and a reviewer's reading, and nothing else until a person looks.
- **Fix-versus-feature rule** (methodology): a look-and-feel fix found here is made inline by a Developer and re-checked; a request that adds behaviour gets a scoped design review first; a fix spanning more than one surface gets a light design-review pass before it is built. The Flight Director says out loud which it is.
- **Contracts the specs depend on** — changing any of these is a spec re-author, not an inline fix: the trace line formats (`[ipc-gate] refused …`, `[vault-gesture] …`, `[vault-icon-menu] …`); the fill icon's `data-goldfinch-vault-lock` attribute; the address field's id `address`; the downloads page's row structure (`li.download-row[data-id]`, the control labels Open / Retry / Remove); `enumerateWindows().sheetVisible`; the proxy address shape `goldfinch-media://proxy/<token>/…`.
- **Not in this walk**: the Windows / macOS internet-origin-mark check (release checklist, by operator ruling); anything the behavior specs already proved.

## Setup (the Flight Director gives exact commands at the start of the session)

- The dev build from the flight branch, launched in dev mode, with a vault the operator can unlock. The operator types the master password; no agent does.
- Test pages served on loopback by the fixtures in `tests/behavior/fixtures/` (`vault-login`, `vault-card`, `page-containment-probe`, `cross-jar-fetch`, `download-true-type`, `web-compat` for basic auth and client certificates). The Flight Director starts the servers and names each URL when its step comes.
- At least one saved login, one card and one identity in the vault, and two jars with a tab each. The operator can use real or throwaway items; the fixture pages are local.
- Group 5 uses a **second window on the same jar**, as the flight spec requires — state the operator is not looking at.

## Steps

Each step is one thing to do and one thing to look for. The operator answers pass, fail, or "looks wrong because…". Groups can be done in separate sittings; group 1 is the one that matters most.

### Group 1 — The vault picker (the residual's defence)

1. **Physical click.** On the login test page, click a field, then click the lock icon with the real pointer. *Look for:* the picker (or the unlock sheet, if locked) opens. This is the first time a physical pointer, not injected input, has been tried. If the display is scaled (not 100%), say so.
2. **Destination line.** *Look for:* "Fill on …" naming the site, in every picker view you meet from here on.
3. **Nothing selected.** *Look for:* no row highlighted when the picker opens. Press Enter immediately: nothing happens. ArrowDown goes to the first row; from a fresh open ArrowUp goes to the last.
4. **Arming.** Open the picker and click a row as fast as you can; then try a double-click on the icon. *Look for:* the picker is visibly inert for about half a second, then live; a too-early click does nothing and a later click still works; a double-click fills at most once. Escape and the close button work immediately.
5. **A login fills.** Pick a saved login. *Look for:* it fills the form you clicked in. No confirmation for a login.
6. **A card on a new site.** On the card test page, raise the picker and pick a card. *Look for:* a confirmation naming the card and the site, two buttons, neither highlighted, no "Manage passwords" footer. Read the wording: "You haven't filled this on this site before." Choose **Cancel**: nothing fills, the sheet closes, focus returns somewhere sensible.
7. **Confirm, then no second ask.** Pick the card again and choose **Fill**: it fills. Raise the picker a third time and pick the same card: it fills with no confirmation.
8. **Double-click into the confirmation.** On another new site (or a second card), double-click the card's row. *Look for:* the confirmation appears and the second click does **not** land on Fill.
9. **An identity** on a new site: same confirmation, same behaviour.
10. **Lock during the confirmation.** With a confirmation showing, lock the vault from the toolbar indicator, unlock, pick the same card. *Look for:* it asks again.
11. **A copied card asks again.** Copy a confirmed card to another vault (vault page), use it from the other jar on the same site. *Look for:* the confirmation.
12. **Wrong kind of field.** Click a **login** field's icon, then pick a **card**. *Look for:* nothing fills. Is silence acceptable here, or should it say something? (Reviewer's question.)
13. **Unlock-then-pick.** Lock the vault, click the icon, unlock. *Look for:* the picker opens after unlock with nothing selected and the destination line.
14. **Navigate under the picker.** Raise the picker, and before picking, cause the page to navigate (a slow link, or reload from another window's shortcut is not possible — use a page that redirects after a few seconds). Pick. *Look for:* nothing fills.
15. **Right-click menu.** Right-click the lock icon: the native menu appears; choose "Fill login…": the picker opens and a pick fills.
16. **A long host.** On a page with a very long hostname (the Flight Director supplies a loopback name), raise the picker. *Look for:* the **end** of the host — the real domain — is visible in the destination line.
17. **Certificate warning.** Open a site with a certificate error, proceed past it (Advanced → Proceed), click a field's icon. *Look for:* a warning view first — "This site's security certificate could not be verified, and you chose to open it anyway. It may not be the site it claims to be." — with **Continue** and nothing to fill until you continue. Try it with the vault locked as well.

### Group 2 — Sheets behind the new guards (still work when opened normally)

18. Vault set-up or change master password, step-up (mint an access key), rotate recovery key, import, recover — whichever the operator is willing to exercise on a throwaway vault; and **Copy** on a recovery / access-key display card. *Look for:* each completes as before.
19. Bookmark edit (star → edit → save), bookmarks-overflow drag, kebab menu, page context menu, tab context menu. *Look for:* each opens, activates and closes as before.
20. Find in page: type in the find bar, step, close. Corner save prompt on a login submit: its buttons, hover pause, F6.
21. HTTP sign-in card (`web-compat` basic-auth page): submit works; and with the long / quoted / empty realm test pages the card reads sensibly (capped with an ellipsis, no stray quotes, no realm line when empty).
22. Client-certificate picker (`web-compat` client-cert page): opens with nothing selected; Enter does nothing for half a second; an Arrow key selects; Cancel and Escape work at once. There is no dimming while it is inert — acceptable?
23. Certificate-error **Proceed** still works with a real click.

### Group 3 — Tabs, windows, media

24. Tear a tab off into a new window by dragging; drag it back. Move a tab with the menu. *Look for:* nothing lost; no window left behind with no tabs (seen once in a Developer's run — confirm or clear).
25. Media panel on the `cross-jar-fetch` page: thumbnails, lightbox, play audio in the docked player, seek. Navigate the tab away while audio plays. *Look for:* playback stops cleanly; what the player shows is acceptable.
26. The hostile media page: only the ordinary image is listed and the count badge agrees.
27. Media panel: download one item; "Download selected" into a chosen folder; right-click an image → Save image, for a normal image and a `data:` one. *Look for:* each saves; the toast reads sensibly; an unsupported one says so.
28. Move a tab with the media panel open to another window. *Look for:* thumbnails after the next rescan.

### Group 4 — Downloads, address bar, history

29. Downloads page: an interrupted download shows Retry and it works; a download from a closed Burner tab shows "Cannot retry: …" — wording acceptable?
30. Open a finished download from the popup and from the downloads page.
31. Visit `http://user:pass@…` (fixture): the address bar shows no credentials; the page works. Press Enter in the address bar: it reloads without credentials — acceptable? Bookmark it: the bookmark has no credentials — acceptable?
32. Crash a credentialed tab (the Flight Director supplies the command) and move one to another window. *Look for:* no credentials in the address bar either time.
33. History page: titles of pages visited in this session look right, including a single-page app's later title.

### Group 5 — Second window, same jar

34. Open a second window with a tab in the same jar as a tab in the first. In window one raise the vault picker. *Look for:* nothing appears in window two. Lock the vault from window two: window one's picker state behaves sensibly.
35. Start a download in window one; open the downloads popup in window two. Retry an interrupted one from the downloads page in window two.

### Group 6 — Wording

36. Read the three new picker strings and the "Cannot retry" lines once more as a set. Reword anything that reads wrong.

## Acceptance Criteria

- [ ] Group 1 walked in full; every failure fixed and re-walked, or accepted by the operator with the acceptance recorded.
- [ ] Groups 2–5 walked to the extent the operator chooses; anything not walked is listed in the flight log as not verified by eye.
- [ ] Every fix made during the walk is classified out loud (fix / feature / multi-surface), goes through a Developer, and has its unit tests and the affected behavior spec re-run.
- [ ] The flight log's Leg 09 entry records each step's outcome in the operator's words where they said something.

## Edge Cases

- The operator's display scale and input device (mouse, touchpad, touch) are recorded with step 1; a touch tap is known not to raise the picker.
- If the vault picker cannot be raised by a physical click at all, stop the walk: that is the flight's premise, and it goes back to design.
- Steps that need a throwaway vault are skipped if the operator prefers not to create one; they are then listed as not walked.

## Post-Completion Checklist

- [ ] Leg status `completed` when the operator says the walk is done; artifacts and any fixes committed on the flight branch.
