'use strict';

// The create-release job's "a stable tag must be on the default branch" check (Mission 23 flight 03,
// leg release-integrity). The decision function is extracted from the workflow text and run under
// bash with a fake `gh` that returns canned compare answers; the tag classification step is run the
// same way. Nothing here reaches GitHub.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const build = readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'build.yml'), 'utf8');

const bashOk = spawnSync('bash', ['-c', 'true']).status === 0;
const skip = !bashOk && 'no bash';

function dedent(m) {
  return m[0]
    .split('\n')
    .map((l) => l.slice(m[1].length))
    .join('\n');
}

const fnMatch = build.match(/^( +)stable_tag_on_default\(\) \{\n[\s\S]*?^\1\}\n/m);
assert.ok(fnMatch, 'stable_tag_on_default not found in the workflow');
const fn = dedent(fnMatch);

/** The `run: |` body of the step named like `name`, dedented. */
function runBody(name) {
  const lines = build.split('\n');
  const at = lines.findIndex((l) => /^ {6}- name:/.test(l) && l.includes(name));
  assert.ok(at >= 0, `no step named like "${name}"`);
  const r = lines.findIndex((l, i) => i > at && /^ {8}run: \|\s*$/.test(l));
  assert.ok(r >= 0, 'no run block');
  const out = [];
  for (let i = r + 1; i < lines.length && (lines[i] === '' || /^ {10}/.test(lines[i])); i++)
    out.push(lines[i].slice(10));
  return out.join('\n');
}

/**
 * Run the function with a fake gh. `answers` is a list of `[rc, stdout, stderr?]`, one per call; a call past the
 * end repeats the last. Returns {status, calls, sleeps, out}.
 */
function runCheck(answers) {
  const dir = mkdtempSync(path.join(tmpdir(), 'goldfinch-stable-'));
  try {
    writeFileSync(
      path.join(dir, 'gh'),
      [
        '#!/usr/bin/env bash',
        `n=$(cat "${dir}/count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/count"`,
        `echo "$*" >> "${dir}/args"`,
        `idx=$n; [ $idx -gt ${answers.length} ] && idx=${answers.length}`,
        `rc=$(sed -n "$idx p" "${dir}/rcs"); sed -n "$idx p" "${dir}/texts"; sed -n "$idx p" "${dir}/errs" >&2; exit $rc`
      ].join('\n') + '\n'
    );
    chmodSync(path.join(dir, 'gh'), 0o755);
    writeFileSync(path.join(dir, 'rcs'), answers.map((a) => a[0]).join('\n') + '\n');
    writeFileSync(path.join(dir, 'texts'), answers.map((a) => a[1]).join('\n') + '\n');
    writeFileSync(path.join(dir, 'errs'), answers.map((a) => a[2] || '').join('\n') + '\n');
    const script = `${fn}\nsleep() { echo "sleep $1" >> "${dir}/sleeps"; }\nstable_tag_on_default "$1" "$2"`;
    const r = spawnSync('bash', ['-c', script, 'bash', 'abc123', 'main'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r' }
    });
    const read = (f) => {
      try {
        return readFileSync(path.join(dir, f), 'utf8');
      } catch {
        return '';
      }
    };
    return {
      status: r.status,
      calls: Number(read('count').trim() || 0),
      sleeps: read('sleeps').split('\n').filter(Boolean),
      args: read('args').split('\n').filter(Boolean),
      out: r.stdout
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('stable tag check: identical and behind allow at once', { skip }, () => {
  for (const status of ['identical', 'behind']) {
    const r = runCheck([[0, status]]);
    assert.equal(r.status, 0, status);
    assert.equal(r.calls, 1, status);
    assert.deepEqual(r.sleeps, []);
    assert.deepEqual(r.args, ['api repos/o/r/compare/main...abc123 --jq .status']);
    assert.match(r.out, /answer='/, 'prints the status it saw');
  }
});

test('stable tag check: ahead, diverged, an empty answer and junk refuse after one retry', { skip }, () => {
  for (const text of ['ahead', 'diverged', '', 'identical-ish', '<html>oops</html>', 'null']) {
    const r = runCheck([[0, text]]);
    assert.equal(r.status, 1, JSON.stringify(text));
    assert.equal(r.calls, 2, `${JSON.stringify(text)}: one retry`);
    assert.deepEqual(r.sleeps, ['sleep 10']);
  }
});

test('stable tag check: 404 and other errors refuse after one retry; a 403 refuses at once', { skip }, () => {
  let r = runCheck([[1, '', 'gh: Not Found (HTTP 404)']]);
  assert.equal(r.status, 1);
  assert.equal(r.calls, 2);
  r = runCheck([[1, '', 'gh: Server Error (HTTP 502)']]);
  assert.equal(r.status, 1);
  assert.equal(r.calls, 2);
  r = runCheck([[1, '', 'gh: Forbidden (HTTP 403)']]);
  assert.equal(r.status, 1);
  assert.equal(r.calls, 1, 'no retry on 403');
  assert.deepEqual(r.sleeps, []);
});

test('stable tag check: a tag that reads ahead or 404 first and behind on the retry is allowed', { skip }, () => {
  for (const first of [
    [0, 'ahead'],
    [1, '', 'gh: Not Found (HTTP 404)']
  ]) {
    const r = runCheck([first, [0, 'identical']]);
    assert.equal(r.status, 0);
    assert.equal(r.calls, 2);
  }
});

test('stable tag check: a successful call that also writes a notice to stderr is allowed', { skip }, () => {
  const r = runCheck([[0, 'behind', 'gh: a new release of gh is available']]);
  assert.equal(r.status, 0);
  assert.equal(r.calls, 1);
  assert.match(r.out, /answer='behind' stderr='gh: a new release/, 'the notice is printed on the diagnostic line');
});

test('stable tag check: an error whose text says identical is still a refusal', { skip }, () => {
  const r = runCheck([[1, 'identical']]);
  assert.equal(r.status, 1);
});

test('stable tag check step: runs only for a stable tag, takes values through env, no expression in run', () => {
  const lines = build.split('\n');
  const at = lines.findIndex((l) => l.includes('- name: Require a stable tag to be on the default branch'));
  assert.ok(at >= 0);
  const step = lines
    .slice(
      at,
      lines.findIndex((l, i) => i > at && /^ {6}- name:/.test(l))
    )
    .join('\n');
  assert.match(step, /^\s+if: steps\.ver\.outputs\.is_stable == 'true'\s*$/m);
  assert.match(step, /DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.doesNotMatch(runBody('Require a stable tag to be on the default branch'), /\$\{\{/);
  assert.ok(
    build.indexOf('- name: Require a stable tag') > build.indexOf('- name: Validate semver tag'),
    'the check comes after the semver validation'
  );
  assert.ok(
    build.indexOf('- name: Require a stable tag') < build.indexOf('- name: Create the draft release'),
    'the check comes before the draft exists'
  );
});

test('classification step: stable vs prerelease from the tag string (what the check is gated on)', { skip }, () => {
  const body = runBody('Validate semver tag and classify stability');
  const classify = (tag) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goldfinch-stable-'));
    try {
      const out = path.join(dir, 'out');
      writeFileSync(out, '');
      const r = spawnSync('bash', ['-c', body], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_REF_NAME: tag, GITHUB_OUTPUT: out }
      });
      return { status: r.status, out: readFileSync(out, 'utf8').trim() };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  assert.deepEqual(classify('v1.2.3'), { status: 0, out: 'is_stable=true' });
  assert.deepEqual(classify('v1.2.3+build.5'), { status: 0, out: 'is_stable=true' });
  assert.deepEqual(classify('v1.2.3-rc.1'), { status: 0, out: 'is_stable=false' });
  assert.deepEqual(classify('v1.2.3-rc.1+x'), { status: 0, out: 'is_stable=false' });
  assert.equal(classify('v1.2').status, 1);
  assert.equal(classify('v1.2.3-').out, '');
});
