'use strict';
// Minimal rig preload for the Q2/Q3 measurements. Sandboxed preload: only `electron`
// is requirable. It runs in the page main world (contextIsolation:false), like the
// product's. With ?isoStart=1 it registers, at document start and in the vault
// isolated world id (745821), a capture-phase click listener on `window` that
// appends a marker to the shared DOM, so the rig can read listener ORDER versus page
// listeners registered later.
const { webFrame } = require('electron');
const VAULT_WORLD = 745821;
if (location.search.indexOf('isoStart=1') !== -1) {
  webFrame.executeJavaScriptInIsolatedWorld(VAULT_WORLD, [
    {
      code:
        'window.addEventListener("click", function (e) {' +
        ' var o = document.getElementById("ord"); if (!o) return;' +
        ' var i = document.createElement("i"); i.textContent = "iso-capture:isTrusted=" + e.isTrusted; o.appendChild(i);' +
        '}, true); true;'
    }
  ]);
}
