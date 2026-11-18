'use strict';

// Text-based pins on the two GitHub workflows (Mission 23 flight 03, leg release-build-split).
// No YAML parser: the only one in node_modules is transitive, and a transitive package is not
// imported. Jobs are sliced by their two-space keys under `jobs:`. Every assertion throws when
// its landmark is missing rather than passing vacuously.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const read = (f) => readFileSync(path.join(WORKFLOWS, f), 'utf8');

/** @param {string} text @returns {Record<string, string>} job key -> its text */
function jobsOf(text) {
  const at = text.indexOf('\njobs:\n');
  assert.ok(at >= 0, 'no top-level jobs: key');
  const body = text.slice(at + '\njobs:\n'.length);
  const out = {};
  const re = /^ {2}([A-Za-z0-9_-]+):[ \t]*\n/gm;
  const marks = [...body.matchAll(re)];
  assert.ok(marks.length > 0, 'no jobs found');
  marks.forEach((m, i) => {
    out[m[1]] = body.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : body.length);
  });
  return out;
}

/** The lines of the job-level `permissions:` block (six-space entries), comments stripped. */
function jobPermissions(job) {
  const m = job.match(/^ {4}permissions:[ \t]*\n((?: {6}\S.*\n)+)/m);
  assert.ok(m, 'job has no permissions block');
  return m[1]
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace(/\s+#.*$/, '').trim());
}

const runLines = (job) =>
  job
    .split('\n')
    .filter((l) => /^\s*(?:- )?run:/.test(l) || /^\s{10,}\S/.test(l))
    .join('\n');

const build = read('build.yml');
const jobs = jobsOf(build);

test('every uses: in both workflows is owner/repo@<40 hex> # vX.Y.Z', () => {
  for (const f of ['build.yml', 'ci.yml']) {
    const lines = read(f)
      .split('\n')
      .filter((l) => /^\s*(?:- )?uses:/.test(l));
    assert.ok(lines.length > 0, `${f}: no uses: lines found`);
    for (const l of lines) {
      assert.match(
        l,
        /^\s*(?:- )?uses: [\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
        `${f}: ${l.trim()}`
      );
    }
  }
});

test('top-level permissions are exactly contents: read', () => {
  for (const f of ['build.yml', 'ci.yml']) {
    const m = read(f).match(/^permissions:[ \t]*\n((?: {2}\S.*\n)+)/m);
    assert.ok(m, `${f}: no top-level permissions block`);
    assert.deepEqual(
      m[1]
        .split('\n')
        .filter(Boolean)
        .map((l) => l.trim()),
      ['contents: read'],
      f
    );
  }
});

test('build job: contents: read only, and no token or secret anywhere in it', () => {
  assert.ok(jobs.build, 'no build job');
  assert.deepEqual(jobPermissions(jobs.build), ['contents: read']);
  assert.doesNotMatch(jobs.build, /secrets\.|GH_TOKEN|GITHUB_TOKEN|github\.token/i);
});

test('every actions/checkout step in build.yml sets persist-credentials: false', () => {
  let seen = 0;
  for (const [name, job] of Object.entries(jobs)) {
    const lines = job.split('\n');
    lines.forEach((l, i) => {
      if (!/uses: actions\/checkout@/.test(l)) return;
      seen++;
      let j = i + 1;
      const step = [];
      while (j < lines.length && !/^\s*- /.test(lines[j]) && lines[j].trim() !== '') step.push(lines[j++]);
      assert.ok(
        step.some((s) => /^\s+persist-credentials: false\s*$/.test(s)),
        `${name}: checkout without persist-credentials: false`
      );
    });
  }
  assert.ok(seen > 0, 'no actions/checkout step found');
});

test('upload job: no checkout and no npm / npx / node run line', () => {
  assert.ok(jobs.upload, 'no upload job');
  assert.doesNotMatch(jobs.upload, /actions\/checkout/);
  assert.doesNotMatch(runLines(jobs.upload), /(?:^|[\s;&|(`$])(?:npm|npx|node)(?=\s|$)/m);
  assert.match(jobs.upload, /actions\/download-artifact@/);
});

/** The text of the step whose `- name:` line contains `name`, up to the next step or the job end. */
function stepOf(job, name) {
  const lines = job.split('\n');
  const at = lines.findIndex((l) => /^ {6}- name:/.test(l) && l.includes(name));
  assert.ok(at >= 0, `no step named like "${name}"`);
  let end = at + 1;
  while (end < lines.length && !/^ {6}- name:/.test(lines[end])) end++;
  return lines.slice(at, end).join('\n');
}

test('upload job: exact permission set; the signing permissions live nowhere else', () => {
  assert.deepEqual(jobPermissions(jobs.upload), ['contents: write', 'id-token: write', 'attestations: write']);
  for (const [name, job] of Object.entries(jobs)) {
    if (name === 'upload') continue;
    assert.doesNotMatch(job, /id-token|attestations\s*:/, `${name}: holds a signing permission`);
  }
  assert.doesNotMatch(build.split('\njobs:\n')[0], /id-token|attestations\s*:/, 'top level holds a signing permission');
  assert.doesNotMatch(jobs.build, /actions\/attest/, 'the build job must not attest');
});

test('upload job: one attest step, after the upload, tag-gated, subjects are the verified list only', () => {
  const attests = jobs.upload.match(/uses: actions\/attest@/g) || [];
  assert.equal(attests.length, 1, 'expected exactly one attest step');
  const upload = jobs.upload.indexOf('- name: Upload to the draft release');
  const attest = jobs.upload.indexOf('- name: Attest build provenance');
  assert.ok(upload >= 0 && attest >= 0, 'steps not found');
  assert.ok(upload < attest, 'the attest step must come after the upload step');
  const step = stepOf(jobs.upload, 'Attest build provenance');
  assert.match(step, /^\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)\s*$/m);
  assert.match(step, /^\s+subject-path: \$\{\{ steps\.verify\.outputs\.subjects \}\}\s*$/m);
  assert.doesNotMatch(step, /[*?]|artifacts\//, 'no glob or bare artifacts path in the attest step');
  assert.doesNotMatch(step, /VERSION|SHA256SUMS/);
  const verify = stepOf(jobs.upload, 'Verify names and digests');
  assert.match(verify, /^\s+id: verify\s*$/m);
  assert.match(verify, /subjects<<SUBJECTS_EOF/);
  assert.match(verify, /upload-list\.txt" *\n\s+echo 'SUBJECTS_EOF'/);
});

test('upload job: artifact directory names are pinned to the exact three before any file is read', () => {
  assert.ok(jobs.upload, 'no upload job');
  const verify = jobs.upload.indexOf('Verify names and digests');
  assert.ok(verify >= 0, 'no verify step in the upload job');
  const list = jobs.upload.indexOf('dirs=(artifacts/*/)', verify);
  assert.ok(list >= 0, 'no directory listing in the verify step');
  const check = jobs.upload.indexOf('installers-linux installers-mac installers-win', list);
  assert.ok(check >= 0, 'no directory-name check after the listing');
  const firstRead = jobs.upload.indexOf('cat artifacts/*/VERSION', list);
  assert.ok(firstRead >= 0, 'no VERSION read after the listing');
  assert.ok(check < firstRead, 'the directory-name check must come before any file is read');
  assert.match(jobs.upload, /artifact directory names are not exactly/);
});

test('publishing always goes through the upload job, never the builder', () => {
  assert.doesNotMatch(build, /--publish always/);
  assert.match(build, /--publish never/);
  assert.match(jobs['publish-release'], /needs: \[create-release, upload\]/);
  assert.match(jobs['publish-release'], /needs\.upload\.result == 'success'/);
});

test('the artifact upload keeps one-day retention and no compression', () => {
  const m = jobs.build.match(/uses: actions\/upload-artifact@[\s\S]*?(?=\n\s*- name:|\n\S|$)/);
  assert.ok(m, 'no upload-artifact step in the build job');
  assert.match(m[0], /^\s+retention-days: 1\s*$/m);
  assert.match(m[0], /^\s+compression-level: 0\s*$/m);
});

test('only create-release, upload and publish-release may hold contents: write', () => {
  const writers = Object.entries(jobs)
    .filter(([, j]) => jobPermissions(j).includes('contents: write'))
    .map(([k]) => k)
    .sort();
  assert.deepEqual(writers, ['create-release', 'publish-release', 'upload']);
});

// ---- the expected-names function, extracted from the workflow text and run ----

/** Every `expected_names() { ... }` definition in the workflow, as text. */
function functionTexts() {
  const out = [];
  const re = /^( +)expected_names\(\) \{\n[\s\S]*?^\1\}\n/gm;
  for (const m of build.matchAll(re))
    out.push(
      m[0]
        .split('\n')
        .map((l) => l.slice(m[1].length))
        .join('\n')
    );
  return out;
}

function readmeNames(core) {
  const dir = mkdtempSync(path.join(tmpdir(), 'goldfinch-wf-'));
  try {
    writeFileSync(path.join(dir, 'README.md'), '<!-- DOWNLOADS:START -->\nold\n<!-- DOWNLOADS:END -->\n');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'update-readme.mjs'), core], { cwd: dir });
    const text = readFileSync(path.join(dir, 'README.md'), 'utf8');
    const names = [...text.matchAll(/\/releases\/download\/v[^/\s)]+\/([^\s)]+)\)/g)].map((m) => m[1]);
    assert.equal(names.length, 5, 'expected five download links');
    return names;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const bashOk = (() => {
  try {
    execFileSync('bash', ['-c', 'true']);
    return true;
  } catch {
    return false;
  }
})();

test('expected_names: build and upload carry the identical function', () => {
  const fns = functionTexts();
  assert.equal(fns.length, 2, 'expected the function in exactly the build (stage) and upload (verify) steps');
  assert.equal(fns[0], fns[1]);
  assert.ok(jobs.build.includes('expected_names() {') && jobs.upload.includes('expected_names() {'));
});

test(
  'expected_names: gives the README-link names for a tag version, a prerelease and a platform subset',
  { skip: !bashOk && 'no bash' },
  () => {
    const [fn] = functionTexts();
    assert.ok(fn, 'expected_names function not found in the workflow');
    const run = (version, platform) =>
      execFileSync('bash', ['-c', `${fn}\nexpected_names "$1" $2`, 'bash', version, platform ?? ''], {
        encoding: 'utf8'
      })
        .split('\n')
        .filter(Boolean);
    for (const ref of ['v0.19.15', 'v1.2.3', 'v2.0.0-rc.1', 'v1.0.0-beta.2+build.5']) {
      const version = ref.slice(1);
      const core = version.split(/[-+]/)[0];
      const want = readmeNames(core)
        .map((n) => n.split(core).join(version))
        .sort();
      assert.deepEqual(run(version).sort(), want, ref);
      const perPlatform = ['win', 'mac', 'linux'].flatMap((p) => run(version, p)).sort();
      assert.deepEqual(perPlatform, want, `${ref}: the three platform subsets partition the five names`);
    }
  }
);

// ---- the upload job's digest-list parser, extracted from the workflow text and run ----

test(
  'listed_names: text and binary-marker lists give the file names; a list naming a missing file differs',
  { skip: !bashOk && 'no bash' },
  () => {
    const m = jobs.upload.match(/^( +)listed_names\(\) \{\n[\s\S]*?^\1\}\n/m);
    assert.ok(m, 'listed_names function not found in the upload job');
    const fn = m[0]
      .split('\n')
      .map((l) => l.slice(m[1].length))
      .join('\n');
    const hash = 'a'.repeat(64);
    const present = ['Goldfinch-Setup-1.2.3.exe'];
    const dir = mkdtempSync(path.join(tmpdir(), 'goldfinch-wf-'));
    try {
      const listedFor = (content) => {
        writeFileSync(path.join(dir, 'SHA256SUMS'), content);
        return execFileSync('bash', ['-c', `${fn}\nlisted_names "$1"`, 'bash', path.join(dir, 'SHA256SUMS')], {
          encoding: 'utf8'
        })
          .split('\n')
          .filter(Boolean);
      };
      const matches = (content) => listedFor(content).join('\n') === present.join('\n');
      assert.ok(matches(`${hash}  Goldfinch-Setup-1.2.3.exe\n`), 'text form passes');
      assert.ok(matches(`${hash} *Goldfinch-Setup-1.2.3.exe\n`), 'binary form passes');
      assert.ok(!matches(`${hash}  Goldfinch-Setup-1.2.4.exe\n`), 'a missing file fails');
      assert.ok(!matches(`${hash}  **Goldfinch-Setup-1.2.3.exe\n`), 'only one marker is stripped');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

/** Every `run:` body in a workflow text (multi-line block bodies and single-line values), nothing else. */
function runBodiesOf(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^( *(?:- )?)run:[ \t]*(.*)$/);
    if (!m) continue;
    const keyCol = m[1].length;
    if (/^[|>][+-]?\s*$/.test(m[2])) {
      const body = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '' || lines[j].search(/\S/) > keyCol) body.push(lines[j]);
        else break;
      }
      out.push(body.join('\n'));
    } else {
      out.push(m[2]);
    }
  }
  return out;
}

test('no workflow expression inside any run: body (build.yml and ci.yml)', () => {
  for (const f of ['build.yml', 'ci.yml']) {
    const bodies = runBodiesOf(read(f));
    assert.ok(bodies.length > 0, `${f}: no run blocks found`);
    bodies.forEach((b, i) => assert.doesNotMatch(b, /\$\{\{/, `${f}: run block ${i + 1} holds an expression`));
  }
  assert.ok(runBodiesOf(read('build.yml')).length >= 10, 'build.yml: fewer run blocks than expected');
});
