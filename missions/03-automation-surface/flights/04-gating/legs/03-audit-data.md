# Leg: audit-data

**Status**: completed
**Flight**: [Gating — opt-in + key auth + audit](../flight.md)

## Objective
Deliver SC10's **data half**: an in-process action log of every tool invocation plus queryable **session-active** state (which identities are attached, distinguishing admin vs jar and naming the jar), fanned out via the M02 `broadcastToChromeAndInternal` channel so Flight 5's indicator + viewer can render it. **No operator-facing UI this flight.**

## Context
- **DD8** — the audit log records each tool invocation `{ ts, sessionId, identity (jarId|admin), op, targetWcId, outcome }`, plus queryable session-active state. Changes fan out via the M02 `broadcastToChromeAndInternal` channel. No visible chrome UI. Persistence is optional/bounded — **default in-memory ring** (confirm here). This delivers SC10's *data* half; the visible indicator + log viewer are **Flight 5**.
- **Scope (DD1):** SC10 is **not met** until Flight 5 renders the indicator — this leg only advances it by establishing a stable data contract Flight 5 builds on.
- **Prior legs (landed, uncommitted):** the auth gate + identity resolution (`key-model-and-gate`), and identity binding to the session + the jar-scoped façade (`jar-scoping-and-admin`). The session's bound `identity` and the per-tool-call choke point both exist now — the audit layer taps them.

### Codebase ground truth (verified 2026-06-14)
- `src/main/main.js:525` — `broadcastToChromeAndInternal(channel, payload)` is the M02 fan-out (used for `settings-changed`, `shields-changed`). It lives in `main.js`, **not** in `mcp-server.js` — so it must be **injected** into `createMcpServer` (same discipline as `getEngine`/`getSettings`/`scopeCtx`).
- `src/main/automation/mcp-tools.js:367` — `callTool(name, args)` is the **single choke point** for every tool invocation (built by `buildToolRegistry(getEngine)`); it returns `{ content, isError? }`. This is where invocations are recorded.
- `src/main/automation/mcp-server.js` — `buildServer(identity)` (line ~164) builds the per-session registry over the scoped engine; the session's `identity` is in scope there. The `sessions` Map entry is `{ server, transport, identity }` (line ~150). `onsessioninitialized(sid)` (line ~408) is where `sid` first exists; `transport.onclose` (line ~410) evicts. `createMcpServer` returns an object (has a `stop()`); add audit accessors to it.
- The engine/op layer surfaces refusals as thrown errors → `errResult` → `{ isError: true, content:[{text:'automation: <code> — …'}] }`. So an outcome's error category is parseable from the `automation: <code>` prefix (`out-of-jar`, `admin-only`, `internal-session`, `bad-handle`, `no-such-contents`, `no-such-jar`, …).
- Tests: `node:test`; `test/unit/automation-mcp-server.test.js` (real SDK client + fakes). Pure modules get offline unit tests.

## Inputs
- `key-model-and-gate` + `jar-scoping-and-admin` landed (identity bound to session; façade in place).

## Outputs
- `src/main/automation/audit-log.js` — new pure, testable in-memory audit module.
- `src/main/automation/mcp-server.js` — record invocations at the callTool choke; track session open/close; broadcast on change; expose a read accessor.
- `src/main/main.js` — inject the `broadcast` callback (a `broadcastToChromeAndInternal('automation-activity-changed', …)` channel).
- Unit + integration tests.
- `docs/mcp-automation.md` — audit data-layer + broadcast-contract section.

## Acceptance Criteria
- [x] **`audit-log.js` (new, pure, testable)** — `createAuditLog({ capacity = 500, now = () => Date.now(), onChange } = {})` returns:
  - `record({ identity, sessionId, op, targetWcId, outcome, errorCode })` — appends `{ ts: now(), … }` to a **bounded ring** (oldest evicted past `capacity`).
  - `noteSessionOpen(sessionId, identity)` / `noteSessionClose(sessionId)` — maintain a session-active map.
  - `recentEntries()` → a copy of the ring in **newest-last (append) order** (matches the array's natural order; no reverse-copy per snapshot). `activeSessions()` → array of `{ sessionId, identity, kind: 'admin'|'jar', jarId|null, since }` (admin vs jar distinguished; jar **named** — `jarId`; `since` = epoch ms via injected `now`); `snapshot()` → `{ sessions: activeSessions(), log: recentEntries() }`.
  - Each mutating call invokes `onChange(snapshot())` (if provided) so the caller can broadcast. Electron-free; `now` injected for deterministic tests.
- [x] **Invocation recording at the choke point** — every tool call records `{ ts, sessionId, identity, op, targetWcId, outcome }`:
  - `identity` from the session's bound identity; `op` = tool name; `targetWcId` = `args?.wcId ?? null`; `outcome` = `'ok'` | `'error'` (from the result's `isError`); on error, `errorCode` parsed with a separator-anchored regex `/^automation:\s*([a-z-]+)\s+—/` (the hyphenated discriminated codes all carry the ` — ` separator; bare messages like `automation: engine unavailable` don't, and correctly fall back to `'error'` rather than a truncated `engine`).
  - Wrap `registry.callTool` in `buildServer(identity)` (do **not** sprinkle logic into the 16 tool `call`s — keep `mcp-tools.js` audit-free). 
  - **sessionId plumbing (per-session ref, design-review high):** in `routeRequest`, the transport is constructed (with the `onsessioninitialized` callback) **before** `buildServer` is called. Allocate a **fresh per-session** `const sessionRef = { id: null }` in `routeRequest` *above* the transport construction; close over it in `onsessioninitialized` (`sessionRef.id = sid`) AND thread it into `buildServer(identity, sessionRef)`. There is **no** Server/registry reuse across sessions (`buildServer` news up a fresh `Server` + registry per `initialize`), so a per-session ref is correct — a shared/module-level ref would be a cross-session bug. The callTool wrapper must read `sessionRef.id` **lazily at call time** (close over the *object*, read `.id` inside the wrapped fn), never capture the `null` at wrap time. (Pre-init calls don't occur in practice; record `null` defensively.)
- [x] **Session-active tracking** — `noteSessionOpen(sid, identity)` at `onsessioninitialized`; `noteSessionClose(sid)` wired into **`transport.onclose` ONLY** — `stop()` closes each transport, which cascades through `onclose`, so a separate stop()-loop call would double-fire. `noteSessionClose` MUST be **idempotent**: if `sid` isn't in the active map, no-op and do **not** fire `onChange` (handles double-close / stop-after-close cleanly). The active set distinguishes admin vs jar and names the jar.
- [x] **Broadcast on change (injected)** — `createMcpServer` gains a `broadcast` opt (default a no-op so headless tests don't need Electron). The audit log's `onChange` calls `broadcast(snapshot())`. `main.js` injects `broadcast: (payload) => broadcastToChromeAndInternal('automation-activity-changed', payload)`. **No chrome UI consumes it this flight** (Flight 5); the channel + payload shape is the deliverable contract.
- [x] **Read accessor** — the object returned by `createMcpServer` (currently `{ start, stop, port }`) gains `getActivity()` → `snapshot()` so Flight 5 / tests / a future IPC query can read current state without waiting for a broadcast.
- [x] **Contract notes (document for Flight 5):** broadcast fires **per mutation** (one per tool call / session change) — acceptable for one local consumer this flight; debounce/coalesce is a Flight-5 option, not required here. `activeSessions()` tracks **transport lifecycle**, not auth-liveness — a session whose key is revoked mid-flight stays "active" until its next request 401s and its transport closes (the revoke *is* enforced at the gate; the indicator just lags to transport close). State this explicitly so Flight 5's indicator semantics are unsurprising.
- [x] **Persistence decision** — **in-memory ring only, no disk persistence** this flight (the data backs a live indicator; bounded; cheap to lose on restart). Record the decision; the ring `capacity` is a named constant. (Reversible to persisted later if Flight 5 wants history across restarts.)
- [x] **Tests green** — unit (`audit-log.js`): ring eviction at capacity; `record` stamps `ts` via injected `now`; session open/close updates the active set; admin-vs-jar `kind` + named `jarId`; `onChange` fires with a snapshot on every mutation. Integration (extend `automation-mcp-server.test.js`): a successful tool call appends one entry with the right `identity`/`op`/`targetWcId`/`outcome:'ok'`; an out-of-jar refusal records `outcome:'error'`, `errorCode:'out-of-jar'`; opening/closing a session updates `getActivity().sessions`; a fake `broadcast` is invoked with the snapshot on these changes. `npm test`, `npm run typecheck`, `npm run lint` clean.

## Verification Steps
- `npm test`, `npm run typecheck`, `npm run lint` — clean.
- Reason: after a keyed client connects and drives a tab, `getActivity()` shows one active session (named jar / admin) and a log entry per invocation; on disconnect the session leaves the active set; each change fired a broadcast.

## Implementation Guidance
1. **`audit-log.js`** — ring as a plain array with a `capacity` cap (shift/slice on overflow, or a fixed-size circular buffer). Active sessions as a `Map<sessionId, {identity, kind, jarId, since}>`. Derive `kind`/`jarId`: `identity === 'admin'` → `{kind:'admin', jarId:null}`, else `{kind:'jar', jarId: identity}`. Fire `onChange(snapshot())` at the end of each mutator. Keep it electron-free.
2. **`mcp-server.js`** — instantiate one `auditLog = createAuditLog({ onChange: (snap) => broadcast(snap) })` per server. In `buildServer(identity, sessionRef)`, wrap `registry.callTool` to record around the existing call (record after, reading `result.isError`). Parse `errorCode` from the first `content[].text` matching `/^automation:\s*([a-z-]+)/`. Wire `noteSessionOpen`/`noteSessionClose` into the init/close hooks. Add `getActivity()` to the returned object.
3. **`main.js`** — pass `broadcast: (payload) => broadcastToChromeAndInternal('automation-activity-changed', payload)` into `createMcpServer`.
4. **Tests & docs** — per criteria; document the `automation-activity-changed` channel + snapshot shape in `docs/mcp-automation.md` as the Flight-5 contract.

## Edge Cases
- **Pre-init tool call** — none in practice (a tool call requires an initialized session); record `sessionId:null` defensively rather than throw.
- **Ring overflow** — oldest entries silently evicted; that's expected (it's a live tail, not an archive). Note it in the docs so Flight 5 doesn't assume full history.
- **A refusal that isn't an `automation:` error** (unexpected throw) — `errorCode` falls back to `'error'`; still recorded with `outcome:'error'`.
- **Broadcast when no chrome window** — `broadcastToChromeAndInternal` already tolerates absent windows; the default no-op `broadcast` covers headless tests.
- **`targetWcId` for no-wcId ops** (`enumerateTabs`, `openTab`, `captureWindow`) → `null`.
- **Session close fan-out** — closing emits one `noteSessionClose` → one broadcast; on `stop()` (all sessions) avoid a broadcast storm if cheap, else accept N broadcasts (one local consumer).

## Files Affected
- `src/main/automation/audit-log.js` — new.
- `src/main/automation/mcp-server.js` — recording, session tracking, broadcast wiring, `getActivity()`.
- `src/main/main.js` — inject `broadcast`.
- `test/unit/automation-audit-log.test.js` (new), `test/unit/automation-mcp-server.test.js` (extend).
- `docs/mcp-automation.md` — audit data-layer + channel contract.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (not final)
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)

> **Orchestration note:** Under `/agentic-workflow`, the Developer does NOT commit and does NOT signal `[COMPLETE:leg]`. Implement to acceptance criteria, update the flight log, set status to `landed`, signal `[HANDOFF:review-needed]`. Review + commit are batched at flight end.
