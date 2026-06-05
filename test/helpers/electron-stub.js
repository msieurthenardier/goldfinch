'use strict';

// Side-effecting stub: requiring this file installs a minimal 'electron' shim
// into Module._cache so modules that call require('electron') in plain Node
// (outside an Electron runtime) get a safe test double instead of an error.
//
// Must be required BEFORE any module that calls require('electron').

const Module = require('module');
const os = require('os');
const path = require('path');

const electronStub = {
  app: {
    getPath: () => path.join(os.tmpdir(), 'goldfinch-test-userdata')
  }
};

const electronResolved = require.resolve('electron');
Module._cache[electronResolved] = {
  id: electronResolved,
  filename: electronResolved,
  loaded: true,
  exports: electronStub,
  parent: null,
  children: [],
  paths: []
};

module.exports = electronStub;
