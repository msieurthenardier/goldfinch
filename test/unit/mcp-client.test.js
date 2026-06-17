'use strict';
// Unit tests for the pure parts of the shared authenticated MCP client helper
// (scripts/lib/mcp-client.mjs): callTool's result UNWRAP, the AUTOMATION_DEV_MINT
// line parser, the env key default, and the endpoint resolution. The live connect
// path (connectAutomation / the actual callTool over a transport) needs a running
// server and is exercised by the a11y / farbling live gates, not here.
//
// The helper is an ESM .mjs; this CommonJS test imports it dynamically.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let mod;
before(async () => {
  mod = await import('../../scripts/lib/mcp-client.mjs');
});

describe('unwrap (callTool result → { value, isError })', () => {
  it('JSON-parses a single text block body', () => {
    const r = mod.unwrap({ content: [{ type: 'text', text: '{"wcId":3,"kind":"chrome"}' }] });
    assert.deepEqual(r, { value: { wcId: 3, kind: 'chrome' }, isError: false });
  });

  it('parses a bare JSON value (number / boolean / null)', () => {
    assert.deepEqual(mod.unwrap({ content: [{ type: 'text', text: '3' }] }), { value: 3, isError: false });
    assert.deepEqual(mod.unwrap({ content: [{ type: 'text', text: 'true' }] }), { value: true, isError: false });
    assert.deepEqual(mod.unwrap({ content: [{ type: 'text', text: 'null' }] }), { value: null, isError: false });
  });

  it('parses {"ok":true} (the void-op shape)', () => {
    assert.deepEqual(mod.unwrap({ content: [{ type: 'text', text: '{"ok":true}' }] }), {
      value: { ok: true },
      isError: false,
    });
  });

  it('falls back to the raw string when the text is not JSON', () => {
    const r = mod.unwrap({ content: [{ type: 'text', text: 'automation: out-of-jar' }] });
    assert.deepEqual(r, { value: 'automation: out-of-jar', isError: false });
  });

  it('surfaces isError and still unwraps the text', () => {
    const r = mod.unwrap({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    assert.deepEqual(r, { value: 'boom', isError: true });
  });

  it('returns the raw content array when there is no text block (e.g. image)', () => {
    const content = [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }];
    const r = mod.unwrap({ content });
    assert.equal(r.isError, false);
    assert.deepEqual(r.value, content);
  });

  it('tolerates a missing/empty result', () => {
    assert.deepEqual(mod.unwrap({}), { value: [], isError: false });
    assert.deepEqual(mod.unwrap(undefined), { value: [], isError: false });
  });

  it('picks the FIRST text block when several content blocks are present', () => {
    const r = mod.unwrap({
      content: [
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        { type: 'text', text: '42' },
      ],
    });
    assert.deepEqual(r, { value: 42, isError: false });
  });
});

describe('parseDevMintLine (AUTOMATION_DEV_MINT stdout scrape)', () => {
  it('parses the exact line', () => {
    const out = 'AUTOMATION_DEV_MINT {"key":"jar123","adminKey":"adm456"}';
    assert.deepEqual(mod.parseDevMintLine(out), { key: 'jar123', adminKey: 'adm456' });
  });

  it('tolerates surrounding electron logging noise', () => {
    const out = [
      '[1234:0617/...:INFO:CONSOLE] some electron chatter',
      'AUTOMATION_DEV_MINT {"key":"jar123","adminKey":null}',
      '[1234:0617/...:INFO] more chatter after',
    ].join('\n');
    assert.deepEqual(mod.parseDevMintLine(out), { key: 'jar123', adminKey: null });
  });

  it('handles a log-prefixed mint line (prefix not at column 0)', () => {
    const out = '[main] AUTOMATION_DEV_MINT {"key":"k","adminKey":"a"}';
    assert.deepEqual(mod.parseDevMintLine(out), { key: 'k', adminKey: 'a' });
  });

  it('returns null when no mint line is present', () => {
    assert.equal(mod.parseDevMintLine('just some logs\nand more logs'), null);
    assert.equal(mod.parseDevMintLine(''), null);
  });

  it('keeps scanning past a noisy line that merely contains the prefix substring', () => {
    const out = [
      'log mentioning AUTOMATION_DEV_MINT but not JSON',
      'AUTOMATION_DEV_MINT {"key":"real","adminKey":null}',
    ].join('\n');
    assert.deepEqual(mod.parseDevMintLine(out), { key: 'real', adminKey: null });
  });

  it('returns null for non-string input', () => {
    assert.equal(mod.parseDevMintLine(undefined), null);
    assert.equal(mod.parseDevMintLine(42), null);
  });
});

describe('defaultKey (env precedence)', () => {
  it('prefers GOLDFINCH_MCP_ADMIN_KEY over GOLDFINCH_MCP_KEY', () => {
    assert.equal(mod.defaultKey({ GOLDFINCH_MCP_ADMIN_KEY: 'adm', GOLDFINCH_MCP_KEY: 'jar' }), 'adm');
  });

  it('falls back to GOLDFINCH_MCP_KEY', () => {
    assert.equal(mod.defaultKey({ GOLDFINCH_MCP_KEY: 'jar' }), 'jar');
  });

  it('returns null when neither is set', () => {
    assert.equal(mod.defaultKey({}), null);
  });
});

describe('resolveEndpoint (URL / port / default)', () => {
  it('honors a full GOLDFINCH_MCP_URL', () => {
    assert.equal(mod.resolveEndpoint({ GOLDFINCH_MCP_URL: 'http://127.0.0.1:9001/mcp' }).href, 'http://127.0.0.1:9001/mcp');
  });

  it('composes from GOLDFINCH_MCP_PORT', () => {
    assert.equal(mod.resolveEndpoint({ GOLDFINCH_MCP_PORT: '8888' }).href, 'http://127.0.0.1:8888/mcp');
  });

  it('defaults to :49707/mcp', () => {
    assert.equal(mod.resolveEndpoint({}).href, 'http://127.0.0.1:49707/mcp');
  });
});
