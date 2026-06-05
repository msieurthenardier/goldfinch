'use strict';

// Shields: active privacy protection config + URL/cookie policy helpers.
// Enforcement (webRequest wiring) lives in main.js, which reads this live
// config so toggles take effect immediately across every session/jar.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  enabled: true, // master switch
  block: true, // cancel requests to known trackers
  strip: true, // strip tracking params + trim Referer
  isolate: true, // strip third-party Cookie / Set-Cookie
  farble: true, // fingerprint noise + navigator spoofing (preload)
  pausedSites: [] // registrable domains where shields are off
};

let config = { ...DEFAULTS };
let configPath = null;

function load() {
  try {
    configPath = path.join(app.getPath('userData'), 'shields.json');
    if (fs.existsSync(configPath)) {
      config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    }
  } catch {
    /* defaults */
  }
  return config;
}

function save() {
  try {
    if (configPath) fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch {
    /* ignore */
  }
}

function get() {
  return config;
}

function set(patch) {
  config = { ...config, ...patch };
  save();
  return config;
}

function isPaused(site) {
  return !!site && config.pausedSites.includes(site);
}

function setPaused(site, paused) {
  const s = new Set(config.pausedSites);
  paused ? s.add(site) : s.delete(site);
  config.pausedSites = [...s];
  save();
  return config;
}

// Is a strategy active for a given first-party site (master on, strategy on,
// site not paused)?
function active(strategy, site) {
  return config.enabled && config[strategy] && !isPaused(site);
}

// --- tracking parameter stripping ---------------------------------------

const TRACKING_PARAMS = new Set([
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'gad_source',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'igshid',
  'igsh',
  'mc_eid',
  'mc_cid',
  'mkt_tok',
  'vero_id',
  'vero_conv',
  '_openstat',
  'oly_anon_id',
  'oly_enc_id',
  'wickedid',
  'li_fat_id',
  'rb_clickid',
  's_cid',
  'icid',
  'ir_clickid',
  '_hsenc',
  '_hsmi',
  'ml_subscriber',
  'ml_subscriber_hash',
  'guccounter',
  'guce_referrer',
  'guce_referrer_sig'
]);

function isTrackingParam(key) {
  const k = key.toLowerCase();
  return (
    TRACKING_PARAMS.has(k) ||
    k.startsWith('utm_') ||
    k.startsWith('hsa_') ||
    k.startsWith('pk_') ||
    k.startsWith('mtm_')
  );
}

// Returns a cleaned URL string if any tracking params were removed, else null.
function stripUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (![...u.searchParams.keys()].some(isTrackingParam)) return null;
    for (const key of [...u.searchParams.keys()]) {
      if (isTrackingParam(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}

module.exports = { DEFAULTS, load, save, get, set, isPaused, setPaused, active, stripUrl, isTrackingParam };
