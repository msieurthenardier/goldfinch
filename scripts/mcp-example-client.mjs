// Example MCP-SDK client for the RUNNING Goldfinch automation server (Flight 3 deliverable).
//
// WHAT THIS IS: a minimal, dependency-only-on-the-MCP-SDK consumer that connects to Goldfinch's
// loopback Streamable-HTTP MCP server, lists its 16 tools, and drives a short end-to-end sequence
// (open a tab → navigate → screenshot → read DOM). It is the SDK-client sibling of
// `scripts/cdp-driver.mjs` and `scripts/a11y-audit.mjs` (same attach-don't-launch, Node-script
// pattern) — but over the real MCP consumer path (the SDK client + StreamableHTTPClientTransport),
// not raw CDP. It demonstrates the exact surface an external agent would use.
//
// PRECONDITION: the app is running with the automation server exposed — `npm run dev:automation`
// (`electron . --no-sandbox --automation-dev`). This script does NOT launch the app; it ATTACHES
// to the already-running loopback server. With nothing running, the connect step fails fast.
// (Note: the automation surface is dev-gated and ships in no release before Flight 4.)
//
// Usage:
//   npm run dev:automation                              # in one terminal: start the app + server
//   node scripts/mcp-example-client.mjs                 # in another: run this client
//
// Endpoint override (mirrors the server's own GOLDFINCH_MCP_PORT contract in mcp-server.js):
//   GOLDFINCH_MCP_PORT=8888 node scripts/mcp-example-client.mjs       # compose against another port
//   GOLDFINCH_MCP_URL=http://127.0.0.1:9001/mcp node scripts/mcp-example-client.mjs   # full-URL escape hatch
// Default endpoint: http://127.0.0.1:49707/mcp (the server is path-agnostic; /mcp is a convention).

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Resolve the endpoint: GOLDFINCH_MCP_URL (full URL) wins; else compose from GOLDFINCH_MCP_PORT
// (the same env var mcp-server.js's resolvePort honors), defaulting to the documented :49707/mcp.
const endpoint = new URL(
  process.env.GOLDFINCH_MCP_URL ||
    'http://127.0.0.1:' + (process.env.GOLDFINCH_MCP_PORT || 49707) + '/mcp'
);

// Print a tool's result, distinguishing the three content shapes the server emits:
//   - image content (captureScreenshot/captureWindow) → note size, never dump base64
//   - text content (drive ops as JSON; readDom/readAxTree as JSON; refusals as JSON) → print text
//   - isError results (genuine engine throws) → flag, but keep going
function printResult(label, result) {
  if (result.isError) {
    const text = (result.content || []).map((c) => c.text ?? '').join(' ');
    console.log(`  ${label}: [isError] ${text}`);
    return;
  }
  for (const block of result.content || []) {
    if (block.type === 'image') {
      console.log(`  ${label}: <image ${block.mimeType}, ${block.data.length} base64 chars>`);
    } else if (block.type === 'text') {
      // Drive ops return compact JSON; readDom can be large — truncate for legibility.
      const text = block.text.length > 400 ? block.text.slice(0, 400) + '… (truncated)' : block.text;
      console.log(`  ${label}: ${text}`);
    } else {
      console.log(`  ${label}: <${block.type} content>`);
    }
  }
}

async function main() {
  const client = new Client({ name: 'goldfinch-example-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(endpoint);

  console.log(`Connecting to ${endpoint.href} …`);
  await client.connect(transport); // performs the MCP initialize handshake

  try {
    // 1) Discover: list the tools the server advertises (expect the 16 Goldfinch tools).
    const { tools } = await client.listTools();
    console.log(`\nTools (${tools.length}):`);
    for (const t of tools) console.log(`  - ${t.name}`);

    // 2) Bootstrap a drivable tab. A fresh launch may have no enumerable tab, so openTab FIRST
    //    to guarantee a wcId rather than relying on enumerateTabs. openTab returns the new tab's
    //    wcId as JSON text — or `null` (a NORMAL result) if the URL was rejected / timed out.
    console.log('\nDriving a short sequence:');
    const openResult = await client.callTool({
      name: 'openTab',
      arguments: { url: 'https://example.com' },
    });
    printResult('openTab', openResult);

    const wcId = parseWcId(openResult);
    if (wcId == null) {
      console.log('  openTab did not yield a wcId (rejected/timed out) — skipping the drive steps.');
      return;
    }
    console.log(`  → driving wcId ${wcId}`);

    // 3) Navigate the tab (drive op → {"ok":true} JSON on success).
    printResult(
      'navigate',
      await client.callTool({ name: 'navigate', arguments: { wcId, url: 'https://example.org' } })
    );

    // 4) Capture a screenshot — note this returns IMAGE content, not JSON text.
    printResult(
      'captureScreenshot',
      await client.callTool({ name: 'captureScreenshot', arguments: { wcId } })
    );

    // 5) Read the live DOM ({ url, title, html } as JSON text — truncated above for legibility).
    printResult('readDom', await client.callTool({ name: 'readDom', arguments: { wcId } }));

    // 6) Optionally enumerate tabs to show the listing (array of { wcId, url, title, jarId, active }).
    printResult('enumerateTabs', await client.callTool({ name: 'enumerateTabs', arguments: {} }));
  } finally {
    // Clean disconnect — closes the transport and releases the session.
    await client.close();
    console.log('\nDisconnected.');
  }
}

// openTab's success content is a single text block holding the wcId as JSON (a bare number) or
// the literal `null`. Parse it defensively; anything non-numeric → null (treat as "no tab").
function parseWcId(result) {
  if (result.isError) return null;
  const block = (result.content || []).find((c) => c.type === 'text');
  if (!block) return null;
  try {
    const value = JSON.parse(block.text);
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error('Example client failed:', err?.message ?? err);
  console.error('Is the app running with `npm run dev:automation`?');
  process.exit(1);
});
