'use strict';

// Text-based pins on the two GitHub workflows (Mission 23 flight 03, leg release-build-split).
// No YAML parser: the only one in node_modules is transitive, and a transitive package is not
// imported. Jobs are sliced by their two-space keys under `jobs:`. Every assertion throws when
// its landmark is missing rather than passing vacuously.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
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

/** Every `<name>() { ... }` definition in `text` (default: the whole workflow), dedented. */
function functionTexts(name = 'expected_names', text = build) {
  const out = [];
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^( +)${esc}\\(\\) \\{\\n[\\s\\S]*?^\\1\\}\\n`, 'gm');
  for (const m of text.matchAll(re))
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

// ---- release notes (sortie 10): the draft step's own shell is extracted and executed ----

const DRAFT_STEP = 'Create the draft release (idempotent)';
const createJob = jobs['create-release'];
// The executing tests need GNU sed (`\xEF` escapes) and a Linux runner like the workflow's.
const runOk = bashOk && process.platform === 'linux';
const runSkip = !runOk && 'needs bash on linux (GNU sed)';

/** The draft step's `run:` body, dedented to its minimum common indent. */
function draftScript() {
  const bodies = runBodiesOf(stepOf(createJob, DRAFT_STEP));
  assert.equal(bodies.length, 1, 'expected one run body in the draft step');
  const lines = bodies[0].split('\n');
  const indents = lines.filter((l) => l.trim() !== '').map((l) => l.search(/\S/));
  const min = Math.min(...indents);
  return lines.map((l) => l.slice(min)).join('\n') + '\n';
}

/** Run the extracted splitter on `content` (string or Buffer). */
function split(content, base, tag, cand, { noContent = false } = {}) {
  const [fn] = functionTexts('split_release_notes', createJob);
  assert.ok(fn, 'split_release_notes not found in create-release');
  const dir = mkdtempSync(path.join(tmpdir(), 'goldfinch-split-'));
  try {
    const f = path.join(dir, 'in.md');
    if (!noContent) writeFileSync(f, content);
    const r = spawnSync(
      'bash',
      [
        '--noprofile',
        '--norc',
        '-c',
        `${fn}\nsplit_release_notes "$@"`,
        'bash',
        f,
        base,
        tag,
        cand ? '1' : '0',
        path.join(dir, 'title'),
        path.join(dir, 'body')
      ],
      { encoding: 'utf8' }
    );
    const ok = r.status === 0;
    return {
      ok,
      reason: r.stderr.trim().split('\n').pop(),
      title: ok ? readFileSync(path.join(dir, 'title'), 'utf8') : null,
      body: ok ? readFileSync(path.join(dir, 'body'), 'utf8') : null,
      stdout: r.stdout,
      dir: null
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('split_release_notes: exactly one definition, in create-release', () => {
  assert.equal(functionTexts('split_release_notes', createJob).length, 1);
  assert.equal(functionTexts('split_release_notes').length, 1);
});

test('split_release_notes: every docs/releases/v*.md splits for its own version', { skip: runSkip }, () => {
  const dir = path.join(ROOT, 'docs', 'releases');
  const files = readdirSync(dir).filter((n) => /^v\d+\.\d+\.\d+\.md$/.test(n));
  assert.ok(files.length > 0, 'no notes files found');
  for (const n of files) {
    const base = n.slice(1, -3);
    const r = split(readFileSync(path.join(dir, n)), base, `v${base}`, false);
    assert.ok(r.ok, `${n}: ${r.reason}`);
    assert.ok(r.title.startsWith(`v${base} `), `${n}: title ${r.title}`);
    assert.ok(r.body.trim().length > 0, n);
  }
});

/** Every rejection fixture: [content, expected reason word, label, opts]. */
function rejectFixtures() {
  const B = '1.2.3';
  const T = 'v1.2.3';
  const body = '\nSummary line.\n';
  const list = [];
  const bad = (content, reason, label, opts) => list.push({ content, reason, label, opts, B, T });
  bad(`v1.2.3 — x${body}`, 'no-title-line', 'missing "# "');
  bad(`#v1.2.3 — x${body}`, 'no-title-line', 'no space after #');
  bad(`# v1.2.3${body}`, 'no-title-text', 'no title text');
  bad(`# v1.2.3 ${body}`, 'trailing-space', 'trailing space after version');
  bad(`# v1.2.3 — x ${body}`, 'trailing-space', 'trailing space');
  bad(`# v1.2.4 — x${body}`, 'wrong-version', 'wrong version');
  bad(`# v1.2.30 — x${body}`, 'wrong-version', 'version prefix only');
  bad('# v1.2.3 — x\n', 'empty-body', 'no body');
  bad('# v1.2.3 — x\n\n\n', 'empty-body', 'blank body');
  bad('# v1.2.3 — x\n  \t \n', 'empty-body', 'whitespace-only body');
  bad('', 'no-title-line', 'empty file');
  bad(`# v1.2.3 — x\x01y${body}`, 'control-byte', 'control byte in title');
  bad(`# v1.2.3 — x\ty${body}`, 'control-byte', 'tab in title');
  bad(`# v1.2.3 — x\x7fy${body}`, 'control-byte', 'DEL in title');
  bad(`# v1.2.3 — x\ry${body}`, 'control-byte', 'lone CR inside title');
  bad(
    Buffer.concat([Buffer.from('# v1.2.3 — x\n\nbody'), Buffer.from([0]), Buffer.from('more\n')]),
    'control-byte',
    'NUL in body'
  );
  bad(`# v1.2.3 ${'a'.repeat(194)}${body}`, 'title-too-long', '201-byte title');
  const big = `# v1.2.3 — x\n\n${'a'.repeat(65536)}\n`;
  bad(big, 'too-large', '65,537+ bytes');
  const h = '# v1.2.3 — x\n\n';
  const exact = (n) => h + 'a'.repeat(n - Buffer.byteLength(h) - 1) + '\n';
  bad(exact(65537), 'too-large', 'exactly 65,537 bytes');
  bad('', 'unreadable', 'missing file', { noContent: true });
  return list;
}

test('split_release_notes: rejects malformed files with a reason word', { skip: runSkip }, () => {
  for (const { content, reason, label, opts, B, T } of rejectFixtures()) {
    const r = split(content, B, T, false, opts);
    assert.equal(r.ok, false, `${label}: should fail`);
    assert.equal(r.reason, reason, label);
    assert.equal(r.stdout, '', `${label}: nothing on stdout`);
  }
});

// The set of reason words the workflow can emit. A new `echo <word> >&2` in
// split_release_notes must be added here AND get a fixture in rejectFixtures().
const SPLIT_REASON_WORDS = [
  'control-byte',
  'empty-body',
  'no-title-line',
  'no-title-text',
  'title-too-long',
  'too-large',
  'trailing-space',
  'unreadable',
  'wrong-version'
];

/** Every `echo <word> >&2` reason word in a splitter text; throws on zero. */
function reasonWordsOf(fn) {
  const words = new Set([...fn.matchAll(/echo ([a-z][a-z-]*) >&2/g)].map((m) => m[1]));
  assert.ok(words.size > 0, 'no `echo <word> >&2` reason words found in split_release_notes');
  return words;
}

test("split_release_notes: reason words in the workflow equal the tests' list", () => {
  const [fn] = functionTexts('split_release_notes', createJob);
  assert.ok(fn, 'split_release_notes not found in create-release');
  assert.deepEqual([...reasonWordsOf(fn)].sort(), [...SPLIT_REASON_WORDS].sort());
  // A word added to an in-memory copy goes red.
  const neutered = reasonWordsOf(`${fn}\necho new-word >&2\n`);
  assert.notDeepEqual([...neutered].sort(), [...SPLIT_REASON_WORDS].sort());
  // Zero words throws rather than passing vacuously.
  assert.throws(() => reasonWordsOf('split_release_notes() { :; }'), /no `echo <word>/);
});

test('split_release_notes: every reason word has a fixture that produces it', { skip: runSkip }, () => {
  const observed = new Set();
  for (const { content, label, opts, B, T } of rejectFixtures()) {
    const r = split(content, B, T, false, opts);
    assert.equal(r.ok, false, `${label}: should fail`);
    observed.add(r.reason);
  }
  const missing = SPLIT_REASON_WORDS.filter((w) => !observed.has(w));
  assert.deepEqual(missing, [], `reason words with no fixture: ${missing.join(', ')}`);
});

test('split_release_notes: accepted shapes and the candidate rewrite', { skip: runSkip }, () => {
  const ok = (content, base, tag, cand) => {
    const r = split(content, base, tag, cand);
    assert.ok(r.ok, r.reason);
    return r;
  };
  const text = '# v1.2.3 — Title here\n\nSummary.\n\n## Added\n\n- thing\n\n# v9.9.9 later heading\n';
  let r = ok(text, '1.2.3', 'v1.2.3', false);
  assert.equal(r.title, 'v1.2.3 — Title here');
  assert.equal(r.body, 'Summary.\n\n## Added\n\n- thing\n\n# v9.9.9 later heading\n', 'only line 1 is the title');

  r = ok(text.replace(/\n/g, '\r\n'), '1.2.3', 'v1.2.3', false);
  assert.equal(r.title, 'v1.2.3 — Title here', 'CRLF');
  assert.ok(!r.body.includes('\r'));
  r = ok(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]), '1.2.3', 'v1.2.3', false);
  assert.equal(r.title, 'v1.2.3 — Title here', 'BOM');

  // 200-byte em-dash title passes; the exactly-65,536-byte file passes.
  const dashTitle = `v1.2.3 ${'—'.repeat(64)}x`;
  assert.equal(Buffer.byteLength(dashTitle), 200);
  r = ok(`# ${dashTitle}\n\nbody\n`, '1.2.3', 'v1.2.3', false);
  assert.equal(r.title, dashTitle);
  const head = '# v1.2.3 — x\n\n';
  r = ok(head + 'a'.repeat(65536 - Buffer.byteLength(head) - 1) + '\n', '1.2.3', 'v1.2.3', false);
  assert.equal(r.body.length, 65536 - Buffer.byteLength(head));

  // Shell metacharacters stay data.
  const dir = mkdtempSync(path.join(tmpdir(), 'goldfinch-split-'));
  try {
    const marker = path.join(dir, 'pwned');
    const nasty = `# v1.2.3 — $(touch ${marker}) \`touch ${marker}\` "q" 'q'\n\nbody $(touch ${marker})\n`;
    r = ok(nasty, '1.2.3', 'v1.2.3', false);
    assert.equal(r.title, `v1.2.3 — $(touch ${marker}) \`touch ${marker}\` "q" 'q'`);
    assert.equal(existsSync(marker), false, 'no side effect');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  for (const tag of ['v1.2.3-rc.1', 'v1.2.3-alpha-1', 'v1.2.3-rc.1+b2']) {
    r = ok(text, '1.2.3', tag, true);
    assert.equal(r.title, `${tag} — Title here`, tag);
    assert.ok(r.body.startsWith('Release candidate for v1.2.3 — for testing, not general use.\n\nSummary.\n'), tag);
  }
  r = ok(text, '1.2.3', 'v1.2.3+build', false);
  assert.equal(r.title, 'v1.2.3 — Title here');
  assert.ok(r.body.startsWith('Summary.'));
});

/** A stub `gh` first on PATH; records argv (unit-separator joined, one call per line). */
function runStep(scenario) {
  const dir = mkdtempSync(path.join(tmpdir(), 'goldfinch-step-'));
  try {
    const stubDir = path.join(dir, 'bin');
    mkdirSync(stubDir);
    const log = path.join(dir, 'calls.log');
    writeFileSync(log, '');
    writeFileSync(
      path.join(stubDir, 'gh'),
      `#!/bin/bash
(IFS=$'\\x1f'; echo "$*") >> "$STUB_LOG"
notes_file() { while [ $# -gt 0 ]; do [ "$1" = --notes-file ] && { echo "$2"; return; }; shift; done; }
case "$1 $2" in
  "api -H")
    path="\${@: -1}"
    if [ -n "$STUB_API_FILE" ] && [ "$path" = "repos/$GITHUB_REPOSITORY/contents/$STUB_API_PATH?ref=$GITHUB_SHA" ]; then cat "$STUB_API_FILE"; exit 0; fi
    echo '{"message":"Not Found"}'; echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
  "release list") [ "$STUB_STATE" = fail ] && exit 1; echo "$STUB_STATE"; exit 0 ;;
  "release view") [ "$STUB_VIEW" = exists ] && exit 0; exit 1 ;;
  "release create") f="$(notes_file "$@")"; [ -n "$f" ] && cp "$f" "$STUB_DIR/created-body"; exit "\${STUB_CREATE_RC:-0}" ;;
  "release edit") f="$(notes_file "$@")"; [ -n "$f" ] && cp "$f" "$STUB_DIR/edited-body"; exit "\${STUB_EDIT_RC:-0}" ;;
esac
echo "unexpected gh call: $*" >&2; exit 99
`,
      { mode: 0o755 }
    );
    const script = path.join(dir, 'step.sh');
    writeFileSync(script, draftScript());
    const summary = path.join(dir, 'summary.md');
    const tmp = path.join(dir, 'tmp');
    mkdirSync(tmp);
    const base = scenario.tag.replace(/^v/, '').split(/[-+]/)[0];
    const env = {
      PATH: `${stubDir}:/usr/bin:/bin`,
      HOME: dir,
      GITHUB_REF_NAME: scenario.tag,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_SHA: 'abc123',
      RUNNER_TEMP: tmp,
      GITHUB_STEP_SUMMARY: summary,
      STUB_LOG: log,
      STUB_DIR: dir,
      STUB_API_PATH: `docs/releases/v${scenario.serves ?? base}.md`,
      STUB_STATE: scenario.state ?? 'none',
      STUB_VIEW: scenario.view ?? '',
      STUB_CREATE_RC: String(scenario.createRc ?? 0),
      STUB_EDIT_RC: String(scenario.editRc ?? 0)
    };
    if (scenario.file !== undefined) {
      writeFileSync(path.join(dir, 'served.md'), scenario.file);
      env.STUB_API_FILE = path.join(dir, 'served.md');
    }
    const which = spawnSync('bash', ['-c', 'command -v gh'], { env, encoding: 'utf8' });
    assert.equal(which.stdout.trim(), path.join(stubDir, 'gh'), 'the stub must be the gh the step can reach');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], { env, encoding: 'utf8' });
    const calls = readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\x1f'));
    const rd = (n) => (existsSync(path.join(dir, n)) ? readFileSync(path.join(dir, n), 'utf8') : null);
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      calls,
      created: calls.find((c) => c[0] === 'release' && c[1] === 'create'),
      edited: calls.find((c) => c[0] === 'release' && c[1] === 'edit'),
      createdBody: rd('created-body'),
      editedBody: rd('edited-body'),
      summary: existsSync(summary) ? readFileSync(summary, 'utf8').trim() : '',
      leftovers: readdirSync(tmp)
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NOTES = '# v1.2.3 — The title\n\nSummary line.\n\n## Added\n\n- a thing\n';
const arg = (call, flag) => call[call.indexOf(flag) + 1];

test('draft step: stable tag with a file creates the draft with the file title and text', { skip: runSkip }, () => {
  const r = runStep({ tag: 'v1.2.3', file: NOTES });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.created && !r.edited);
  assert.equal(arg(r.created, '--title'), 'v1.2.3 — The title');
  assert.ok(r.created.includes('--draft') && !r.created.includes('--generate-notes'));
  assert.equal(r.createdBody, 'Summary line.\n\n## Added\n\n- a thing\n');
  assert.equal(r.summary, 'Release notes: docs/releases/v1.2.3.md');
  assert.deepEqual(r.leftovers, [], 'the work directory is removed');
  assert.ok(r.calls[0].join(' ').includes('contents/docs/releases/v1.2.3.md?ref=abc123'));
});

test('draft step: candidates read the target file; edge tags; +build is stable', { skip: runSkip }, () => {
  for (const tag of ['v1.2.3-rc.1', 'v1.2.3-alpha-1', 'v1.2.3-rc.1+b2']) {
    const r = runStep({ tag, file: NOTES });
    assert.equal(r.status, 0, `${tag}: ${r.stderr}`);
    assert.equal(arg(r.created, '--title'), `${tag} — The title`, tag);
    assert.ok(
      r.createdBody.startsWith('Release candidate for v1.2.3 — for testing, not general use.\n\nSummary line.'),
      tag
    );
    assert.equal(r.summary, 'Release notes: docs/releases/v1.2.3.md');
  }
  const r = runStep({ tag: 'v1.2.3+build', file: NOTES });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(arg(r.created, '--title'), 'v1.2.3 — The title');
  assert.ok(r.createdBody.startsWith('Summary line.'));
});

test('draft step: no file / malformed file / gh api failure falls back to generated notes', { skip: runSkip }, () => {
  const fallback = (r, reason) => {
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.created && r.created.includes('--generate-notes') && !r.created.includes('--notes-file'));
    assert.equal(arg(r.created, '--title'), r.created[2]);
    assert.ok(r.stdout.includes(`::warning::Release notes: ${reason}; using generated notes`), r.stdout);
    assert.equal(r.summary, `Release notes: generated (reason: ${reason})`);
  };
  fallback(runStep({ tag: 'v1.2.3' }), 'missing-or-unreadable');
  fallback(runStep({ tag: 'v1.2.3', file: 'no title line\n\nbody\n' }), 'no-title-line');
  fallback(runStep({ tag: 'v1.2.3', file: '# v1.2.4 — x\n\nbody\n' }), 'wrong-version');
  fallback(runStep({ tag: 'v1.2.3', file: '# v1.2.3 — x\n' }), 'empty-body');
  // Only the target's file is served: a candidate that looked up its own tag would 404.
  fallback(runStep({ tag: 'v1.2.3-rc.1', serves: '1.2.3-rc.1', file: NOTES }), 'missing-or-unreadable');
  const r = runStep({ tag: 'v1.2.3', file: NOTES, serves: '9.9.9' });
  fallback(r, 'missing-or-unreadable');
});

test(
  'draft step: existing draft is re-edited from the file; published and unknown are left alone',
  { skip: runSkip },
  () => {
    let r = runStep({ tag: 'v1.2.3', file: NOTES, state: 'draft' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.edited && !r.created);
    assert.equal(arg(r.edited, '--title'), 'v1.2.3 — The title');
    assert.equal(r.editedBody, 'Summary line.\n\n## Added\n\n- a thing\n');
    assert.equal(r.summary, 'Release notes: docs/releases/v1.2.3.md');

    r = runStep({ tag: 'v1.2.3', state: 'draft' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.edited && !r.created);
    assert.equal(r.summary, 'Release notes: existing draft left unchanged (reason: missing-or-unreadable)');

    r = runStep({ tag: 'v1.2.3', file: NOTES, state: 'published' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.edited && !r.created, 'a published release is never edited');
    assert.equal(r.summary, 'Release notes: existing published release left unchanged');

    // The list read fails: today's existence check, no edit either way.
    r = runStep({ tag: 'v1.2.3', file: NOTES, state: 'fail', view: 'exists' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.edited && !r.created);
    assert.equal(r.summary, 'Release notes: existing release left unchanged');
    r = runStep({ tag: 'v1.2.3', file: NOTES, state: 'fail', view: '' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.created && !r.edited);
    assert.equal(arg(r.created, '--title'), 'v1.2.3 — The title');
  }
);

test(
  'draft step: gh failures — a failing api read still creates; create/edit failures fail the step',
  { skip: runSkip },
  () => {
    // The api stub exits non-zero on a missing file; the step still reaches create and the summary.
    const r = runStep({ tag: 'v1.2.3' });
    assert.equal(r.status, 0);
    assert.ok(r.created.includes('--generate-notes'));
    assert.ok(r.summary.startsWith('Release notes: generated'));
    assert.notEqual(runStep({ tag: 'v1.2.3', file: NOTES, createRc: 1 }).status, 0, 'create failure fails the step');
    assert.notEqual(
      runStep({ tag: 'v1.2.3', file: NOTES, state: 'draft', editRc: 1 }).status,
      0,
      'edit failure fails the step'
    );
  }
);

test('draft step: parses under bash -n', { skip: !bashOk && 'no bash' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goldfinch-step-'));
  try {
    writeFileSync(path.join(dir, 's.sh'), draftScript());
    execFileSync('bash', ['-n', path.join(dir, 's.sh')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Detected once; a host without jq reports this test as skipped, never as a silent pass.
const HAS_JQ = spawnSync('jq', ['--version'], { stdio: 'ignore' }).status === 0;

test(
  'release state jq expression gives none / draft / published (when jq is installed)',
  { skip: HAS_JQ ? false : 'jq not installed' },
  () => {
    const m = draftScript().match(/--jq '([^']+)'/);
    assert.ok(m, 'no --jq expression in the draft step');
    const run = (tag, list) =>
      execFileSync('jq', ['-r', m[1]], {
        input: JSON.stringify(list),
        env: { ...process.env, GITHUB_REF_NAME: tag },
        encoding: 'utf8'
      }).trim();
    assert.equal(run('v1', []), 'none');
    assert.equal(run('v1', [{ tagName: 'v2', isDraft: true }]), 'none');
    assert.equal(run('v1', [{ tagName: 'v1', isDraft: true }]), 'draft');
    assert.equal(run('v1', [{ tagName: 'v1', isDraft: false }]), 'published');
  }
);

test('create-release: no checkout, no project code, one credential; the notes path and guards are pinned', () => {
  assert.doesNotMatch(createJob, /actions\/checkout/);
  assert.doesNotMatch(runLines(createJob), /(?:^|[\s;&|(`$])(?:npm|npx|node)(?=\s|$)/m);
  assert.doesNotMatch(runLines(createJob), /scripts\//);
  assert.deepEqual(jobPermissions(createJob), ['contents: write']);
  const step = stepOf(createJob, DRAFT_STEP);
  assert.deepEqual(
    [...step.matchAll(/^\s+([A-Z_]+): \$\{\{.*\}\}\s*$/gm)].map((m) => m[1]),
    ['GH_TOKEN']
  );
  const [body] = runBodiesOf(step);
  assert.doesNotMatch(body, /\$\{\{/);
  assert.ok(body.includes('?ref=${GITHUB_SHA}') && body.includes('v${base}.md'));
  assert.ok(body.includes('base="${ver%%[-+]*}"'));
  assert.ok(body.includes('--generate-notes'));
  // The edit is reachable only from the draft branch.
  const edit = body.indexOf('gh release edit');
  assert.ok(edit > body.indexOf('draft)'), 'edit must sit under the draft branch');
  assert.equal((body.match(/gh release edit/g) || []).length, 1);
  assert.ok(body.slice(body.indexOf('draft)'), edit).indexOf('published)') < 0, 'edit is not under published');
});

test('publish-release never sets a title or notes', () => {
  assert.doesNotMatch(jobs['publish-release'], /--notes|--notes-file|--title|--generate-notes/);
});

test('dependabot.yml tells the reviewer to re-pin github-actions bumps to a commit SHA', () => {
  const text = readFileSync(path.join(ROOT, '.github', 'dependabot.yml'), 'utf8');
  const at = text.search(/^ {2}- package-ecosystem: github-actions\s*$/m);
  assert.ok(at >= 0, 'no github-actions entry in dependabot.yml');
  // The contiguous comment block directly above the entry.
  const above = text.slice(0, at).replace(/\n$/, '').split('\n');
  const block = [];
  for (let i = above.length - 1; i >= 0 && /^\s*#/.test(above[i]); i--) block.unshift(above[i]);
  const note = block.map((l) => l.replace(/^\s*#\s?/, '')).join(' ');
  assert.ok(note.length > 0, 'no comment block above the github-actions entry');
  assert.match(note, /re-pin\s+to\s+`owner\/repo@<40-hex>\s+#\s+vX\.Y\.Z`/i);
  assert.match(note, /commit\s+SHA/i);
  assert.match(note, /before\s+merging/i);
  // The resolving command must dereference to a commit; `git/ref/tags/<tag>`
  // returns a tag object's SHA for an annotated tag.
  assert.match(note, /gh\s+api\s+repos\/<owner>\/<repo>\/commits\/<tag>\s+--jq\s+\.sha/);
  assert.doesNotMatch(
    note.replace(/`git\/ref\/tags\/<tag>`\s+would/, ''),
    /gh\s+api\s+repos\/<owner>\/<repo>\/git\/ref\/tags/
  );
});

test('build job: the audit step runs on linux only, before npm ci, exactly `npm audit --audit-level=high`, unsoftened', () => {
  const step = stepOf(jobs.build, 'Audit dependencies');
  assert.match(step, /^\s+if: matrix\.platform == 'linux'\s*$/m);
  const runs = runBodiesOf(step).join('\n');
  assert.match(runs, /^\s*npm audit --audit-level=high\s*$/m);
  assert.doesNotMatch(step, /continue-on-error|\|\|\s*true|--omit|--production|--only/);
  assert.doesNotMatch(step.replace('--audit-level=high', ''), /--audit-level/);
  const names = [...jobs.build.matchAll(/^ {6}- name: (.*)$/gm)].map((m) => m[1]);
  const at = names.findIndex((n) => n.includes('Audit dependencies'));
  const npmCi = names.findIndex((n) => n.includes('Install dependencies'));
  const builder = names.findIndex((n) => /^Build .*installers/.test(n));
  assert.ok(at >= 0 && npmCi >= 0 && builder >= 0, 'landmark steps missing');
  assert.ok(at < npmCi, 'audit must run before npm ci');
  assert.ok(npmCi < builder);
});

test('build job: the fuse check runs on every platform, after the build step', () => {
  const step = stepOf(jobs.build, 'Check Electron fuses');
  assert.doesNotMatch(step, /^\s+if:/m);
  assert.match(step, /node scripts\/check-fuses\.mjs "\$APP_BIN"/);
  assert.ok(
    buildStepNames().findIndex((n) => n.includes('Check Electron fuses')) >
      buildStepNames().findIndex((n) => /^Build .*installers/.test(n))
  );
});

/** Step names of the build job, from real `- name:` step headers only (a comment cannot match). */
function buildStepNames(job = jobs.build) {
  return [...job.matchAll(/^ {6}- name: (.*)$/gm)].map((m) => m[1]);
}

/** Split an `if:` expression on `&&` / `||` at parenthesis depth 0. */
function topLevelParts(cond, op) {
  const parts = [];
  let depth = 0;
  let quote = false;
  let from = 0;
  for (let i = 0; i < cond.length; i++) {
    const c = cond[i];
    if (c === "'") quote = !quote;
    else if (quote) continue;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && cond.startsWith(op, i)) {
      parts.push(cond.slice(from, i).trim());
      from = i + op.length;
      i += op.length - 1;
    }
  }
  parts.push(cond.slice(from).trim());
  return parts;
}

/** Why `cond` does not guarantee a successful build, or null. `always() && <success> && ...` is allowed; a top-level `||` is not. */
function uploadIfFault(cond) {
  if (topLevelParts(cond, '||').length > 1) return 'top-level || can bypass the build-success test';
  if (!topLevelParts(cond, '&&').includes("needs.build.result == 'success'"))
    return 'no top-level build-success conjunct';
  return null;
}

test('upload job: runs only when every build succeeded, so a failed audit stops upload, attest and publish', () => {
  const m = jobs.upload.match(/^ {4}if: (.*)$/m);
  assert.ok(m, 'upload has no job-level if');
  assert.match(m[1], /needs\.build\.result == 'success'/);
  assert.doesNotMatch(m[1], /needs\.build\.result\s*!=/);
  assert.equal(uploadIfFault(m[1]), null);
  assert.match(jobs.upload, /^ {4}needs:.*\bbuild\b/m);
  assert.match(jobs['publish-release'], /needs\.upload\.result == 'success'/);
});

test('mutation: the fuse pin and the upload-condition pin go red on their bypasses', () => {
  // A comment carrying the step name, with the step removed, must not satisfy the fuse pin.
  const fuse = stepOf(jobs.build, 'Check Electron fuses');
  const mutated = jobs.build.replace(fuse, '      # Check Electron fuses (removed)');
  assert.notEqual(mutated, jobs.build, 'mutation did not apply');
  assert.ok(mutated.includes('Check Electron fuses'));
  assert.throws(() => stepOf(mutated, 'Check Electron fuses'));
  assert.equal(
    buildStepNames(mutated).findIndex((n) => n.includes('Check Electron fuses')),
    -1
  );

  const cond = jobs.upload.match(/^ {4}if: (.*)$/m)[1];
  assert.equal(uploadIfFault(cond), null);
  const bad = cond.replace(
    "always() && needs.build.result == 'success'",
    "always() || needs.build.result == 'success'"
  );
  assert.notEqual(bad, cond, 'mutation did not apply');
  assert.ok(uploadIfFault(bad));
  assert.ok(uploadIfFault("always() && (needs.build.result == 'success' || true)"));
});
