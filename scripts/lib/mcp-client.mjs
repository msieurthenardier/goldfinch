// Shared authenticated MCP client helper for the Goldfinch automation surface.
//
// WHAT THIS IS: a thin wrapper over the MCP SDK's `Client` +
// `StreamableHTTPClientTransport` that adds the `Authorization: Bearer <key>`
// header the example client (`scripts/mcp-example-client.mjs`) lacks, and
// unwraps a `callTool` result into a plain `{ value, isError }`. It is the
// connection layer reused by `scripts/a11y-audit.mjs` and (Flight 9, leg 4) the
// farbling correctness driver — the durable replacement for the Flight 1-3 CDP
// apparatus, since removed.
//
// LAUNCH MODEL — ATTACH + env key. This helper does NOT launch the app. The
// operator launches `npm run dev:automation` out-of-band (with
// `GOLDFINCH_AUTOMATION_DEV_MINT=1` so the app prints one
// `AUTOMATION_DEV_MINT {"key":…,"adminKey":…}` line to stdout), captures the key,
// and exports it as `GOLDFINCH_MCP_ADMIN_KEY` (admin/chrome mode) or
// `GOLDFINCH_MCP_KEY` (jar/guest mode). connectAutomation reads that env by
// default. See docs/mcp-automation.md "Dogfooding / dev key acquisition".
//
// Endpoint resolution mirrors mcp-example-client.mjs: GOLDFINCH_MCP_URL (full
// URL) wins; else compose from GOLDFINCH_MCP_PORT (default 49707) + /mcp.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Resolve the default automation key from env: GOLDFINCH_MCP_ADMIN_KEY wins
 * (admin/chrome mode), else GOLDFINCH_MCP_KEY (jar/guest mode). Returns null if
 * neither is set (caller decides whether the missing key is fatal for its mode).
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function defaultKey(env = process.env) {
  return env.GOLDFINCH_MCP_ADMIN_KEY || env.GOLDFINCH_MCP_KEY || null;
}

/**
 * Resolve the MCP endpoint URL the same way mcp-example-client.mjs does.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {URL}
 */
export function resolveEndpoint(env = process.env) {
  return new URL(
    env.GOLDFINCH_MCP_URL || 'http://127.0.0.1:' + (env.GOLDFINCH_MCP_PORT || 49707) + '/mcp'
  );
}

/**
 * Connect an authenticated MCP client to the running Goldfinch automation
 * server and perform the initialize handshake. The Bearer header is attached via
 * the transport's `requestInit.headers` (SDK-supported), so every request the
 * client makes carries it.
 *
 * @param {{ port?: number|string, url?: string, key?: string|null, env?: Record<string, string | undefined>, clientName?: string, clientVersion?: string }} [opts]
 * @returns {Promise<import('@modelcontextprotocol/sdk/client/index.js').Client>} a connected Client
 */
export async function connectAutomation(opts = {}) {
  const env = opts.env || process.env;
  const key = opts.key !== undefined ? opts.key : defaultKey(env);
  if (!key) {
    throw new Error(
      'no automation key — set GOLDFINCH_MCP_ADMIN_KEY (chrome/admin mode) or GOLDFINCH_MCP_KEY ' +
        '(guest mode). Capture it from the AUTOMATION_DEV_MINT line of a `dev:automation` launched ' +
        'with GOLDFINCH_AUTOMATION_DEV_MINT=1 (see docs/mcp-automation.md "Dogfooding / dev key acquisition").'
    );
  }

  const endpoint = opts.url
    ? new URL(opts.url)
    : opts.port != null
      ? new URL('http://127.0.0.1:' + opts.port + '/mcp')
      : resolveEndpoint(env);

  const client = new Client({
    name: opts.clientName || 'goldfinch-automation-client',
    version: opts.clientVersion || '1.0.0',
  });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: 'Bearer ' + key } },
  });
  await client.connect(transport); // MCP initialize handshake
  return client;
}

/**
 * Call a tool and UNWRAP its result into `{ value, isError }`.
 *
 * The server emits a `content` array; a tool that returns JSON text (drive ops,
 * readDom/readAxTree, evaluate, the void → {"ok":true} ops) carries it in a
 * single text block. We JSON.parse that block when possible (falling back to the
 * raw string if it is not JSON), and surface `isError` so the caller can react to
 * a genuine engine throw. Image content (screenshots) is left as the raw block
 * array under `value` — this helper's consumers (a11y / farbling) read JSON.
 *
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} client
 * @param {string} name
 * @param {object} [args]
 * @returns {Promise<{ value: any, isError: boolean }>}
 */
export async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return unwrap(result);
}

/**
 * Pure unwrap of a callTool result — separated so it is unit-testable without a
 * live server. Returns `{ value, isError }`:
 *   - text block whose body parses as JSON → the parsed value
 *   - text block that is not JSON → the raw string
 *   - no text block (e.g. image content) → the raw `content` array
 *
 * @param {{ content?: any[], isError?: boolean }} result
 * @returns {{ value: any, isError: boolean }}
 */
export function unwrap(result) {
  const isError = !!(result && result.isError);
  const content = (result && result.content) || [];
  const textBlock = content.find((c) => c && c.type === 'text');
  if (!textBlock) {
    return { value: content, isError };
  }
  try {
    return { value: JSON.parse(textBlock.text), isError };
  } catch {
    return { value: textBlock.text, isError };
  }
}

/**
 * Parse the single `AUTOMATION_DEV_MINT {...}` line out of an app's stdout (the
 * dev auto-mint print from main.js). Tolerates surrounding electron logging
 * noise — it scans line-by-line for the exact prefix and JSON-parses the rest.
 * Returns the parsed `{ key, adminKey }` object, or null if no such line is
 * present (the caller decides whether absence is a timeout error).
 *
 * This lives here so the OPTIONAL self-spawn convenience (not used by the attach
 * flow) and its test can share one parser. The attach flow does NOT call it.
 *
 * @param {string} stdout
 * @returns {{ key: string, adminKey: string | null } | null}
 */
export function parseDevMintLine(stdout) {
  if (typeof stdout !== 'string') return null;
  const PREFIX = 'AUTOMATION_DEV_MINT ';
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf(PREFIX);
    if (idx === -1) continue;
    const json = line.slice(idx + PREFIX.length).trim();
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === 'object' && 'key' in parsed) return parsed;
    } catch {
      // keep scanning — a noisy line that merely contains the prefix substring
    }
  }
  return null;
}
