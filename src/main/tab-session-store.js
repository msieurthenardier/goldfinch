// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeTabSession } = require('../shared/tab-management');

function createTabSessionStore() {
  let file = null;
  let state = normalizeTabSession(null);

  return {
    /** @param {string} userDataPath */
    load(userDataPath) {
      file = path.join(userDataPath, 'tab-session.json');
      try {
        state = fs.existsSync(file)
          ? normalizeTabSession(JSON.parse(fs.readFileSync(file, 'utf8')))
          : normalizeTabSession(null);
      } catch {
        state = normalizeTabSession(null);
      }
      return this.get();
    },

    get() {
      return structuredClone(state);
    },

    /** @param {any} next */
    save(next) {
      if (!file) throw new Error('tab session store not loaded');
      state = normalizeTabSession(next);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, file);
      return this.get();
    },
  };
}

module.exports = { createTabSessionStore };
