# Leg: automation-bounds

**Status**: completed
**Flight**: [Vault and Automation Boundary](../flight.md)

## Objective

Bound what a key holder can exhaust or leave behind: session slots, audit-log size, and a reveal gate that never switches off.

## Context

- Flight DD5 (sessions and audit). Mission finding 16 (automation half). The port display, the permission handlers and Q4 were split at design review into the next leg, `port-and-permissions` — they share no source file with this one.
- **What exists.** `src/main/automation/mcp-server.js`: `MAX_SESSIONS = 64`; a new session is refused with 429 at the cap (`sessions.size + pendingSessions >= MAX_SESSIONS`); a session leaves the map on transport close — a DELETE, or the close of its long-lived GET stream ("Client-disconnect detection"). A client that never opens the GET stream and never sends DELETE stays forever. A request naming an unknown session id **already answers 404** (`routeRequest`: `'No valid session: unknown Mcp-Session-Id'`, present before this flight; no test pins it); a known id under another identity gets a bare 401; a non-`initialize` request with no session id gets 400.
- **The client, read from source at design review** (`@modelcontextprotocol/sdk` 1.32.2, `client/streamableHttp.js`): it opens the long-lived GET stream by default; it does **not** re-initialise on a 404 — the call rejects and nothing retries; `close()` aborts the connection and sends no DELETE (`terminateSession()` is the only sender, and the repository's helper never calls it). So when one of this project's scripts exits, the GET stream's close tears its session down; stale sessions accumulate only from a client that never opens the stream — a raw HTTP caller. And an idle timeout would strand a static-config client permanently at its next call.
- **Flight DD5 said "sessions idle longer than a fixed limit are closed", with the limit to be set at leg design "from what the existing clients do". Leg design changes the mechanism — recorded here and in the flight log as a Flight Director decision, confirmed by the design review's reading of the client source:**
  - An idle timeout long enough not to break a client that sits idle between tool calls (a static-config MCP client can be silent for an hour) does little against slot exhaustion, and one short enough to matter would break such clients unless they transparently re-initialise on a 404 — unverified for the SDK client this project ships scripts against.
  - So exhaustion is bounded **under pressure, not by the clock**: a per-identity cap, and eviction of one of that identity's own sessions when it is reached — the stalest by a stated order, never simply the least recently used (a session mid-request, or a static client idle for an hour, is not stale). One key can then never hold more than its share, and never evicts another identity's session. The global cap stays as the backstop.
  - The reveal gate's "an admin session is attached" (leg `admin-reach`) becomes "an admin session **made a request within a recent window**". Sound because every admin action that could lead to a secret is itself a request — it refreshes the window before it runs — and script left behind is covered by the scripted-document mark. It bounds the nuisance the `admin-reach` Developer found: an admin client that vanishes without closing no longer leaves confirmations on until the app restarts.
  - **Residual, stated in the docs, not fixed here**: a value the operator reveals while no automation is active stays in the page until hidden; automation that attaches or wakes later can read what is still shown. The gate governs who can *cause* a reveal, not what is already on screen.
- **Audit ring** (`src/main/automation/audit-log.js`): 500 entries, each field stored unclipped; `detail` is built from tool arguments in `mcp-server.js`.
- Budgets: do not touch `src/renderer/renderer.js`.

## Inputs

- Legs 01–04 landed (uncommitted). Gates: 6,917 tests / 6,913 pass / 0 fail / 4 todo.
- `src/main/automation/mcp-server.js` (`routeRequest`, the session map, `hasAdminSession`, `getActivity`, port resolution and `start()`), `audit-log.js`, `src/main/reveal-gate.js` (consumer of `hasAdminSession`), `test/unit/automation-mcp-server.test.js` (its `REGRESSION F11` case opens 64 sessions on one key and expects the 65th to get 429; its `hasAdminSession` case expects true for as long as the session is attached).

## Outputs

- Per-identity session cap with own-stalest eviction; the existing 404 pinned and reached by an evicted id; recency-based `hasAdminSession`; clipped audit fields.

## Acceptance Criteria

**Measurement first (the tree as of leg `automation-input`, before any edit of this leg; scratch profile; output in the scratchpad, summary in the flight log)**

- [ ] **AC1 — Client behaviour.** With the repository's own client (`scripts/lib/mcp-client.mjs` → the SDK's client): (a) does it open the long-lived GET stream; (b) what does it do when the server answers a tool call 404 for its session id — fail the call, or re-initialise and retry; (c) what does `client.close()` send. One paragraph each, with the evidence. The source reading above says: yes; it fails; nothing. This is the live confirmation — if it disagrees, report it prominently and stop before the session work (`[BLOCKED:client-behaviour]`).
**Sessions**

- [ ] **AC3 — Per-identity cap, own-stalest eviction.** `createMcpServer` gains injectable `now` (a **monotonic** clock in production — it does not count suspended time, which errs toward the gate staying on), `maxSessionsPerIdentity` (default 8, stated in the docs as a number) and `adminActiveWindowMs`. Each session entry carries `lastSeen`, `inFlight` (incremented and decremented around the transport's `handleRequest`) and `hasStream` (set by the existing GET branch, cleared on its close). An `initialize` for an identity already at the cap — counting that identity's **pending** initialisations too, tracked per identity so two simultaneous ones cannot both pass — evicts one of that identity's sessions, chosen in this order: no open GET stream first; then no request in flight; then lowest `lastSeen`. Eviction is `transport.close()` on a victim chosen from a snapshot — the existing `onclose` stays the single teardown path (vault keys zeroized, map entry deleted, `noteSessionClose`); nothing is duplicated. It never closes another identity's session. The global cap and its 429 remain. Unit: fill one identity, open one more — the streamless idle one goes, not the one mid-request; two simultaneous initialises at cap−1 leave exactly the cap; another identity is untouched; the admin identity is capped the same way. `REGRESSION F11` is rewritten to reach the global cap with several identities (or an injected small cap), keeping its 429 message assertion.
- [ ] **AC4 — The 404 is pinned and an evicted id reaches it.** A unit test asserts the existing unknown-session-id 404 (status and JSON-RPC error body), and that a request carrying an evicted session's id gets it. A non-`initialize` request with no session id keeps its 400; a known id under another identity keeps its 401.
- [ ] **AC5 — `hasAdminSession()` is recency-based.** True iff some admin session's last request arrived within `ADMIN_ACTIVE_WINDOW_MS` (a constant; propose 10 minutes). The stamp is written in `routeRequest` immediately after the identity-match check and **before** the body is read or the transport is called, so an admin tool call always sees the gate on for itself, and a request that fails identity resolution never stamps. Unit: lapse; refresh by any request; a 401 request does not stamp; a request arriving after the window has lapsed reads true inside its own handler; a request in flight longer than the window is covered by its own stamp only until the window ends — and that is sound only because script it started is covered by the scripted-document mark (`observe.js` marks before `executeJavaScript`; `reveal-gate.js` checks the mark independently of `hasAdminSession`), which the test names. The existing `hasAdminSession` case (true while attached) is rewritten to these. The reveal-gate tests that fake `hasAdminSession` are unaffected; the server tests gain the lapse and refresh cases. The comment on `hasAdminSession` and the reveal gate's documentation say exactly this.
- [ ] **AC6 — The activity snapshot stays honest.** A session closed by eviction disappears from `getActivity().sessions` and from the indicator through the existing change broadcast; an admin session that is attached but outside the recency window is still listed as a session (it is one) — the indicator is not changed to hide it. So the indicator can show the admin tier while the gate is off: accepted, and stated in the docs, because the gate reopens the instant that session makes a request.

**Audit log**

- [ ] **AC7 — Clipped fields.** `record()` clips `op` (which is the tool name straight from the wire), `errorCode` and `detail` to a fixed length (256 code points — never splitting a surrogate pair — with an ellipsis) and coerces non-strings. `sessionId` and `identity` must stay byte-identical to what `noteSessionOpen` recorded, or the page's join between sessions and log breaks: bound them only if the same bound is applied in both places. Clipping happens inside `record()`, so no caller can skip it. Unit: a megabyte `detail` stores 256 characters; existing redaction behaviour is unchanged.

**Live and docs**

- [ ] **AC14 — Live, on the changed build** (scratch profile, dev-mint keys, never a registered server): with one jar key, open the cap's worth of sessions by raw HTTP `initialize` with no GET stream, plus one through the repository client holding its stream; one more `initialize` evicts a streamless one, whose next call gets 404 (through the SDK client this surfaces as a thrown HTTP error — assert on that or use raw fetch), while the streamed session and a session of the other identity keep working; `getActivity` no longer lists the evicted one; every apparatus primitive still works.
- [ ] **AC15 — Docs.** `docs/mcp-automation.md`: the per-key limit (8) and what is evicted first; that a client whose session was evicted gets 404 and must reconnect (the SDK client does not do so by itself); the recency window, replacing "an admin session is attached" wherever leg `admin-reach` wrote it; that the indicator may show admin while the gate is off; the residual about values already on screen; audit clipping. `CLAUDE.md`: the MCP transport paragraph and the reveal-gate bullet.
- [ ] **AC16 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass.

## Verification Steps

- AC1, AC14: script output in the flight log.
- AC3–AC6: `test/unit/automation-mcp-server.test.js` (injected clock). AC7: `audit-log` tests.
- AC15: read by the Flight Director.

## Implementation Guidance

1. AC1 before any edit. Report what is measured even where it contradicts this leg.
2. Sessions: injectable clock and constants → entry fields and the stamp → per-identity pending count → eviction → the 404 pin → `hasAdminSession`. Evict after the body is read and the request is known to be an `initialize`, before the pending reservation is taken; never iterate the live map while closing.
3. Audit clipping.
4. Live smoke; docs.
5. Do not commit. Leg `landed`, flight log entry, `[LAND:leg]`.

## Edge Cases

- **Eviction while the evicted session has a request in flight**: the in-flight request completes or fails as a transport close makes it; it must not throw into the server.
- **Eviction of a session holding vault keys**: zeroized, exactly as on close.
- **The evicting request itself fails `initialize`**: the old session is already gone. Accepted — the alternative holds a slot for a session that may never arrive.
- **Clock going backwards** (injected clock is monotonic in production; state which clock is used).
- **An admin session whose requests are all refused 401** (key revoked): arrival of a request that fails identity resolution does not stamp the session.
- **Every one of an identity's sessions has a request in flight and a stream**: the last rule (lowest `lastSeen`) still picks one. Accepted.
- **`stop()`** clears the map before closing transports, so `onclose` there is a no-op delete — unchanged.
- **Anything needing a design call**: `[BLOCKED:<reason>]`.

## Files Affected

- `src/main/automation/mcp-server.js`, `src/main/automation/audit-log.js`.
- `test/unit/automation-mcp-server.test.js`, the audit-log tests.
- `docs/mcp-automation.md`, `CLAUDE.md`.

## Citation Audit

Read at leg design (2026-11-14, tree after `automation-input`): `mcp-server.js` — `routeRequest` (identity mismatch → 401; GET-stream close tears the session down), the 429 at `MAX_SESSIONS`, `sessions.set(sid, { server, transport, identity, vaultCtx })` in `onsessioninitialized`, `transport.onclose` zeroize + delete, strict-versus-fallback port comments; `audit-log.js` `createAuditLog` (ring of 500, unclipped fields); `main.js` `currentAutomationStatus` (single `port`); `register-settings-ipc.js` `automation:get-activity` (chrome-or-internal, returns `server.getActivity()`); `session-runtime.js` `ALLOWED_PERMISSIONS` (includes `window-management`), the two handlers, `onSessionCreated`'s early return for the internal session. Developer design review (Sonnet, 2026-11-14): approve with changes, adopted — the 404 already exists (the leg's premise was wrong; it is now pinned, not built); concurrent initialisations could pass the cap without a per-identity pending count; plain least-recently-used would evict the wrong session, so the order is streamless → idle → oldest; the clock and limits made injectable and monotonic; two existing tests named for rewriting; the mechanism change (no idle timeout) confirmed from the client's source. **Split**: port display, permissions and Q4 moved to leg `port-and-permissions`.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
