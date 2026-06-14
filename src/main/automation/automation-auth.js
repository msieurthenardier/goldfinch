// @ts-check
'use strict';

// Automation auth — the pure key model for the MCP surface (Flight 4, DD5/DD6).
//
// PURE + ELECTRON-FREE: this module requires only `node:crypto`. It holds the
// hash/generate/validate logic so it unit-tests in isolation, with no Electron,
// no settings store, and no HTTP. The mcp-server auth gate is a thin caller.
//
// KEY MODEL (DD5):
//   - Per-jar keys are stored as SHA-256 hex hashes keyed by jarId
//     (settings `automationKeyHashes`). Plaintext is generated with a CSPRNG,
//     shown once at mint, and NEVER persisted.
//   - Validation hashes the presented key and CONSTANT-TIME-compares it against
//     the stored hashes — no early-out on the first mismatched byte.
//
// ADMIN TIER (DD6):
//   - The env var GOLDFINCH_AUTOMATION_ADMIN is a PRESENCE gate (adminEnabled).
//   - The admin key is a separate hashed credential (`automationAdminKeyHash`).
//   - A request resolves to 'admin' IFF the gate is set AND the admin hash is a
//     non-empty hex string AND the presented key hashes to it. Empty/missing
//     hash or unset gate → never matches (no empty-Bearer accept).

const crypto = require('crypto');

// SHA-256 hex digests are exactly 64 lowercase hex chars.
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * SHA-256 hash a plaintext key to a 64-char lowercase hex digest.
 * @param {string} plaintext
 * @returns {string} 64-char lowercase hex
 */
function hashKey(plaintext) {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * Generate a fresh plaintext automation key with a CSPRNG. 32 bytes of entropy,
 * base64url-encoded (URL-safe, no padding) so it travels cleanly in an
 * `Authorization: Bearer` header.
 * @returns {string}
 */
function generateKey() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Constant-time compare of two hex-digest strings. Returns false (without an
 * early-out timing leak on the hash bytes) when either input is not a valid
 * 64-char hex string or when the digests differ. Length is checked first only to
 * guard timingSafeEqual's equal-length precondition; both operands here are
 * fixed-length SHA-256 digests so this never gates on attacker-controlled length.
 * @param {string} aHex
 * @param {string} bHex
 * @returns {boolean}
 */
function hashEquals(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  if (!HEX64.test(aHex) || !HEX64.test(bHex)) return false;
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Resolve the identity a presented key authenticates as.
 *
 * @param {string} presentedKey  the bearer token from the request
 * @param {object} ctx
 * @param {Record<string, string>} [ctx.keyHashes]  jarId → SHA-256 hex hash map
 * @param {string} [ctx.adminKeyHash]  SHA-256 hex hash of the admin key, or ''
 * @param {boolean} [ctx.adminEnabled]  the GOLDFINCH_AUTOMATION_ADMIN presence gate
 * @returns {string | null}  the matching jarId, the literal 'admin', or null.
 *   NEVER throws — any malformed input resolves to null.
 */
function validateKey(presentedKey, ctx) {
  try {
    if (typeof presentedKey !== 'string' || presentedKey.length === 0) return null;
    const c = ctx || {};
    const presentedHash = hashKey(presentedKey);

    // Admin first, but ONLY when the env gate is set AND a non-empty admin hash
    // exists. An empty/missing hash or unset gate never matches (no empty-Bearer
    // accept) and falls through to the jar check.
    const adminKeyHash = c.adminKeyHash;
    if (
      c.adminEnabled === true &&
      typeof adminKeyHash === 'string' &&
      adminKeyHash !== '' &&
      hashEquals(presentedHash, adminKeyHash)
    ) {
      return 'admin';
    }

    // Jar keys. Iterate the map; a jar key never resolves to 'admin'.
    const keyHashes = c.keyHashes;
    if (keyHashes !== null && typeof keyHashes === 'object' && !Array.isArray(keyHashes)) {
      for (const jarId of Object.keys(keyHashes)) {
        const storedHash = keyHashes[jarId];
        if (hashEquals(presentedHash, storedHash)) {
          return jarId;
        }
      }
    }

    return null;
  } catch {
    // validateKey must NEVER throw — a malformed input is just "no match".
    return null;
  }
}

module.exports = { hashKey, generateKey, validateKey, hashEquals };
