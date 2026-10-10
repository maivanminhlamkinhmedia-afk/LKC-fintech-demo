import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { auditEvent, runFromEnvironment } from '../scripts/ci/pr-evidence-audit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/ci/pr-evidence-audit.mjs');
const temp = mkdtempSync(join(tmpdir(), 'lkc-g1b-test-'));
// Only our isolated fixture root is removed; no existing repository is mutated.
after(() => rmSync(temp, { recursive: true, force: true }));
const repo = join(temp, 'repo');
mkdirSync(repo);
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
env.GIT_CONFIG_NOSYSTEM = '1';
env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git('init', '-b', 'base');
git('config', 'user.name', 'G1b synthetic test');
git('config', 'user.email', 'g1b-test@example.invalid');
git('config', 'core.autocrlf', 'false');
git('config', 'commit.gpgsign', 'false');
git('config', 'core.hooksPath', join(temp, 'no-hooks'));
writeFileSync(join(repo, 'keep.txt'), 'before\n');
writeFileSync(join(repo, 'old.txt'), 'rename contents\n');
git('add', 'keep.txt', 'old.txt');
git('commit', '-m', 'synthetic common ancestor');
const ancestor = git('rev-parse', 'HEAD');
git('checkout', '-b', 'source');
writeFileSync(join(repo, 'keep.txt'), 'after\n');
writeFileSync(join(repo, 'added.txt'), 'new\n');
git('mv', 'old.txt', 'renamed.txt');
git('add', 'keep.txt', 'added.txt');
git('commit', '-m', 'synthetic PR head');
const head = git('rev-parse', 'HEAD');
git('checkout', 'base');
writeFileSync(join(repo, 'base-only.txt'), 'independent base change\n');
git('add', 'base-only.txt');
git('commit', '-m', 'synthetic advanced base');
const base = git('rev-parse', 'HEAD');
git('merge', '--no-ff', 'source', '-m', 'synthetic PR merge');
const merge = git('rev-parse', 'HEAD');
const paths = [
  { change: 'CREATE', path: 'added.txt' },
  { change: 'MODIFY', path: 'keep.txt' },
  { change: 'DELETE', path: 'old.txt' },
  { change: 'CREATE', path: 'renamed.txt' },
];
const metadata = () => ({
  task: { id: 'G1b-01', outcome: 'Audit source provenance and exact paths' },
  source: { head, base, checkout: merge }, paths: structuredClone(paths),
  review: { reviewer: 'Claude 2', verdict: 'PASS', revision: head, evidence: 'PO-relayed report' },
  ci: { status: 'PASS', sourceHead: head, repository: 'example/repo', prNumber: 7,
    runId: 123, attempt: 1, event: 'pull_request', evidence: 'https://github.com/example/repo/actions/runs/123' },
  dup: { id: 'LKC-DUP-001', status: 'PARTIAL', action: 'EXTEND', checkedScope: ['base and local worktrees'], evidence: 'preflight report' },
});
const body = (m) => `<!-- lkc-evidence:v1\n${JSON.stringify(m)}\n-->`;
const event = (prBody = body(metadata())) => ({ repository: { full_name: 'example/repo' },
  pull_request: { number: 7, title: 'Untrusted title', body: prBody,
    head: { sha: head, repo: { id: 1 } }, base: { sha: base, repo: { id: 1 } } } });
const audit = (e = event(), overrides = {}) => auditEvent({ eventJson: JSON.stringify(e), eventName: 'pull_request',
  githubSha: merge, ref: 'refs/pull/7/merge', cwd: repo, ...overrides });

test('AC01-06 complete declarations: Git matches; review/CI/DUP remain unverified', () => {
  const r = audit();
  assert.equal(r.checks.task.status, 'PRESENT');
  assert.equal(r.checks.sourceDeclaration.status, 'MATCH');
  assert.equal(r.checks.paths.status, 'MATCH');
  assert.equal(r.checks.review.declaration, 'PRESENT');
  assert.equal(r.checks.review.authentication, 'NOT_VERIFIED');
  assert.equal(r.checks.ci.identity, 'MATCH');
  assert.equal(r.checks.ci.authentication, 'NOT_VERIFIED');
  assert.equal(r.checks.ci.currentRunConclusion, 'NOT_VERIFIED');
  assert.equal(r.checks.dup.declaration, 'PRESENT');
  assert.equal(r.checks.dup.semanticVerification, 'NOT_PERFORMED');
  assert.equal(r.mode, 'ADVISORY');
  assert.equal(r.blocking, false);
});

test('AC02 actual synthetic merge parents, source, base and checkout are distinct', () => {
  const p = audit().provenance;
  assert.equal(p.sourceHead, head);
  assert.equal(p.base, base);
  assert.equal(p.githubSha, merge);
  assert.equal(p.checkout, merge);
  assert.equal(p.syntheticMerge, merge);
  assert.deepEqual(p.parents, [base, head]);
  assert.equal(p.mergeBase, ancestor);
  assert.notEqual(p.checkout, p.sourceHead);
});

test('AC03 actual Git merge-base diff excludes unrelated base changes; renames have both paths', () => {
  assert.deepEqual(audit().checks.paths.actual, paths);
  assert.equal(audit().checks.paths.actual.some((p) => p.path === 'base-only.txt'), false);
});

test('AC01 missing task ID and missing outcome each produce explicit warnings', () => {
  for (const field of ['id', 'outcome']) {
    const m = metadata(); delete m.task[field];
    const r = audit(event(body(m)));
    assert.equal(r.checks.task.status, 'NOT_VERIFIED');
    assert.ok(r.warnings.includes('TASK_ID_OR_OUTCOME_MISSING_OR_INVALID'));
  }
});

test('AC02 metadata cannot substitute synthetic merge for source head', () => {
  const m = metadata(); m.source.head = merge;
  assert.equal(audit(event(body(m))).checks.sourceDeclaration.status, 'MISMATCH');
});

test('AC02 source checkout declaration must name actual checkout', () => {
  const m = metadata(); m.source.checkout = head;
  assert.equal(audit(event(body(m))).checks.sourceDeclaration.status, 'MISMATCH');
});

test('AC02 wrong event head, base, github.sha or ref fail provenance without false path match', () => {
  for (const field of ['head', 'base', 'githubSha', 'ref']) {
    const e = event(); const o = {};
    if (field === 'head' || field === 'base') e.pull_request[field].sha = ancestor;
    else o[field] = field === 'ref' ? 'refs/pull/8/merge' : ancestor;
    const r = audit(e, o);
    assert.equal(r.checks.gitProvenance.status, 'MISMATCH');
    assert.equal(r.checks.paths.status, 'NOT_VERIFIED');
  }
});

test('AC03 changed file and change kind mismatches never pass', () => {
  for (const field of ['path', 'change']) {
    const m = metadata(); m.paths[0][field] = field === 'path' ? 'other.txt' : 'MODIFY';
    assert.equal(audit(event(body(m))).checks.paths.status, 'MISMATCH');
  }
});

// Separate real Git histories leave the original provenance/security fixtures intact.
function auditRoutePaths(actualPaths, declaredPaths = actualPaths) {
  const routeRepo = mkdtempSync(join(temp, 'routes-'));
  const routeGit = (...args) => execFileSync('git', args, {
    cwd: routeRepo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  routeGit('init', '-b', 'base');
  routeGit('config', 'user.name', 'G1b route test');
  routeGit('config', 'user.email', 'g1b-test@example.invalid');
  routeGit('config', 'core.autocrlf', 'false');
  routeGit('config', 'commit.gpgsign', 'false');
  routeGit('config', 'core.hooksPath', join(temp, 'no-hooks'));
  routeGit('commit', '--allow-empty', '-m', 'synthetic route base');
  const routeBase = routeGit('rev-parse', 'HEAD');
  routeGit('checkout', '-b', 'source');
  for (const path of actualPaths) {
    mkdirSync(dirname(join(routeRepo, path)), { recursive: true });
    writeFileSync(join(routeRepo, path), 'synthetic route fixture\n');
  }
  // Stage only this generated fixture directory, never the LKC worktree.
  routeGit('add', '--', 'src');
  routeGit('commit', '-m', 'synthetic route source');
  const routeHead = routeGit('rev-parse', 'HEAD');
  routeGit('checkout', 'base');
  routeGit('merge', '--no-ff', 'source', '-m', 'synthetic route merge');
  const routeMerge = routeGit('rev-parse', 'HEAD');
  const m = metadata();
  m.source = { head: routeHead, base: routeBase, checkout: routeMerge };
  m.paths = declaredPaths.map((path) => ({ change: 'CREATE', path }));
  m.review.revision = routeHead;
  m.ci = { status: 'NOT_RUN' };
  const e = event(body(m));
  e.pull_request.head.sha = routeHead;
  e.pull_request.base.sha = routeBase;
  const result = audit(e, { cwd: routeRepo, githubSha: routeMerge });
  assert.equal(result.checks.gitProvenance.status, 'MATCH');
  assert.equal(result.checks.sourceDeclaration.status, 'MATCH');
  assert.equal(result.provenance.sourceHead, routeHead);
  assert.equal(result.provenance.checkout, routeMerge);
  assert.deepEqual(result.provenance.parents, [routeBase, routeHead]);
  assert.notEqual(routeHead, routeMerge);
  assert.equal(result.mode, 'ADVISORY');
  assert.equal(result.blocking, false);
  return result;
}

for (const route of ['src/app/x/[id]/page.tsx', 'src/app/api/auth/[...nextauth]/route.ts']) {
  test(`G1B-B1 exact literal route MATCH: ${route}`, () => {
    const result = auditRoutePaths([route]);
    assert.equal(result.checks.paths.status, 'MATCH');
    assert.deepEqual(result.checks.paths.actual, [{ change: 'CREATE', path: route }]);
  });
}

test('G1B-B1 different dynamic path is MISMATCH, not NOT_VERIFIED or a glob match', () => {
  for (const [actual, declared] of [
    ['src/app/x/[id]/page.tsx', 'src/app/x/[slug]/page.tsx'],
    ['src/app/x/i/page.tsx', 'src/app/x/[id]/page.tsx'],
  ]) {
    const result = auditRoutePaths([actual], [declared]);
    assert.equal(result.checks.paths.status, 'MISMATCH');
    assert.deepEqual(result.checks.paths.actual, [{ change: 'CREATE', path: actual }]);
  }
});

test('G1B-B1 mixed ordinary, dynamic, catch-all and optional catch-all paths remain complete', () => {
  const routes = ['src/app/about/page.tsx', 'src/app/api/auth/[...nextauth]/route.ts',
    'src/app/docs/[[...slug]]/page.tsx', 'src/app/x/[id]/page.tsx'];
  const result = auditRoutePaths(routes);
  assert.equal(result.checks.paths.status, 'MATCH');
  assert.deepEqual(result.checks.paths.actual, routes.map((path) => ({ change: 'CREATE', path })));
});

test('AC03 missing, duplicate, glob, traversal, absolute or malformed allowlists are NOT_VERIFIED', () => {
  for (const invalid of [undefined, [], ['added.txt'], [paths[0], paths[0]],
    ...['', '.', '..', '../x', 'src/**', 'src/?.ts', 'src/{a,b}.ts', 'src/{x', 'src/x}',
      'C:/x', '/x', 'src\\x', './x', 'x//y', 'x\ny', 'x\ty', 'x\u0000y', 'x\u007fy',
      'src/[id]/../page.tsx', 'src/[id]/./page.tsx', 'src/[id]/*.tsx', 'src/[id]/?.tsx',
      'src/[id]/{a,b}.tsx'].map((path) => [{ change: 'CREATE', path }])]) {
    const m = metadata(); m.paths = invalid;
    assert.equal(audit(event(body(m))).checks.paths.status, 'NOT_VERIFIED');
  }
});

test('AC04 missing reviewer, verdict or revision is incomplete review evidence', () => {
  for (const field of ['reviewer', 'verdict', 'revision']) {
    const m = metadata(); delete m.review[field];
    assert.equal(audit(event(body(m))).checks.review.declaration, 'NOT_VERIFIED');
  }
});

test('AC04 self-declared Claude PASS and fake authenticated evidence cannot authenticate a review', () => {
  const m = metadata(); m.review.authenticated = true; m.trustedReview = { verdict: 'PASS' };
  const r = audit(event(`Claude PASS!\n${body(m)}`));
  assert.equal(r.checks.review.declaredVerdict, 'PASS');
  assert.equal(r.checks.review.authentication, 'NOT_VERIFIED');
  assert.ok(r.warnings.includes('REVIEW_DECLARATION_NOT_AUTHENTICATED'));
  assert.equal(audit(event('Claude PASS')).checks.review.declaration, 'NOT_VERIFIED');
});

test('AC04 review against merge or stale revision is flagged', () => {
  for (const revision of [merge, ancestor]) {
    const m = metadata(); m.review.revision = revision;
    const r = audit(event(body(m)));
    assert.equal(r.checks.review.revisionMatchesSource, false);
    assert.ok(r.warnings.includes('REVIEW_REVISION_MISMATCH'));
  }
});

test('AC05 NOT_RUN, FAIL, PASS remain distinct declarations, never verified CI', () => {
  for (const status of ['NOT_RUN', 'FAIL', 'PASS', 'NOT_STARTED', 'IN_PROGRESS', 'CANCELLED', 'SKIP']) {
    const m = metadata(); m.ci.status = status;
    const r = audit(event(body(m)));
    assert.equal(r.checks.ci.declaredStatus, status);
    assert.equal(r.checks.ci.authentication, 'NOT_VERIFIED');
  }
});

test('AC05 wrong source, PR or repository CI cannot be reused', () => {
  for (const [field, value] of [['sourceHead', merge], ['prNumber', 8], ['repository', 'other/repo']]) {
    const m = metadata(); m.ci[field] = value;
    const r = audit(event(body(m)));
    assert.equal(r.checks.ci.identity, 'MISMATCH');
    assert.ok(r.warnings.includes('CI_COMMIT_OR_PR_MISMATCH'));
  }
});

test('AC05 missing run attempt/evidence is not complete even with claimed PASS', () => {
  for (const field of ['runId', 'attempt', 'event', 'evidence']) {
    const m = metadata(); delete m.ci[field];
    assert.equal(audit(event(body(m))).checks.ci.identity, 'NOT_VERIFIED');
  }
});

test('AC06 preflight metadata is distinct from semantic duplicate detection', () => {
  const m = metadata(); m.dup.checkedScope = [];
  assert.equal(audit(event(body(m))).checks.dup.declaration, 'NOT_VERIFIED');
  assert.equal(audit().trust.semanticDuplicateDetection, 'NOT_PERFORMED');
});

test('AC07 malformed, multiple, missing-close, scalar and oversized body are advisory', () => {
  for (const input of ['<!-- lkc-evidence:v1 {broken} -->', body(metadata()) + body(metadata()),
    '<!-- lkc-evidence:v1 {}', '<!-- lkc-evidence:v1 null -->', '<!-- lkc-evidence:v1 [] -->',
    'x'.repeat(65537), { body: 'object' }]) {
    const r = audit(event(input));
    assert.equal(r.checks.prMetadata.status, 'INVALID');
    assert.equal(r.blocking, false);
  }
});

test('AC07 invalid/oversized event does not echo content or throw', () => {
  for (const eventJson of ['{secret', 'null', '[]', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    const r = audit(undefined, { eventJson });
    assert.ok(r.warnings.includes('EVENT_JSON_INVALID_OR_OVERSIZED'));
    assert.equal(r.blocking, false);
    assert.equal(JSON.stringify(r).includes('secret'), false);
  }
});

test('AC07 hostile title/body and evidence URLs are never executed, fetched or reflected', () => {
  const marker = join(temp, 'must-not-exist');
  const payload = `$(touch ${marker}); & echo credential-marker\n::error::forged`;
  const m = metadata(); m.task.outcome = payload; m.review.reviewer = payload; m.review.evidence = payload;
  const e = event(body(m)); e.pull_request.title = payload;
  const r = audit(e);
  assert.equal(existsSync(marker), false);
  assert.equal(JSON.stringify(r).includes('credential-marker'), false);
  assert.equal(JSON.stringify(r).includes('::error::'), false);
  assert.equal(JSON.stringify(r).includes(marker), false);
});

test('AC07 injected Git ref/option is rejected before executing Git', () => {
  for (const value of ['--output=stolen', 'HEAD; echo credential-marker', '$(whoami)', 'HEAD~1']) {
    const e = event(); e.pull_request.head.sha = value;
    const r = audit(e);
    assert.equal(r.checks.gitProvenance.status, 'NOT_VERIFIED');
    assert.equal(JSON.stringify(r).includes(value), false);
  }
});

test('AC07 fork metadata receives no special trust even when author_association claims OWNER', () => {
  const e = event(); e.pull_request.head.repo.id = 2; e.pull_request.author_association = 'OWNER';
  const r = audit(e);
  assert.equal(r.provenance.fork, true);
  assert.equal(r.checks.gitProvenance.status, 'MATCH');
  assert.equal(r.trust.independentReview, 'NOT_VERIFIED');
});

test('AC07 prototype-shaped JSON has no authority and does not pollute objects', () => {
  const m = JSON.parse('{"__proto__":{"authenticated":true},"constructor":{"prototype":{"authenticated":true}}}');
  const r = audit(event(body(m)));
  assert.equal({}.authenticated, undefined);
  assert.equal(r.trust.independentReview, 'NOT_VERIFIED');
});

test('AC08 dispatch without PR body records branch checkout and no PR assertions', () => {
  const r = audit({}, { eventName: 'workflow_dispatch', githubSha: merge, ref: 'refs/heads/base' });
  assert.equal(r.checks.gitProvenance.status, 'MATCH');
  assert.equal(r.provenance.sourceHead, merge);
  assert.equal(r.provenance.syntheticMerge, null);
  assert.equal(r.checks.prMetadata.status, 'NOT_APPLICABLE');
  assert.equal(r.checks.review, undefined);
});

test('AC08 missing history/non-repository gives safe NOT_VERIFIED, not empty success', () => {
  const r = audit(undefined, { cwd: temp });
  assert.equal(r.checks.paths.actual, null);
  assert.equal(r.checks.paths.status, 'NOT_VERIFIED');
  assert.ok(r.warnings.includes('GIT_HISTORY_OR_DIFF_NOT_VERIFIED'));
  assert.equal(JSON.stringify(r).includes(temp), false);
});

test('AC08 unsupported events and missing PR payload do not claim provenance', () => {
  assert.equal(audit({}, { eventName: 'pull_request_target' }).checks.gitProvenance.status, 'NOT_VERIFIED');
  assert.equal(audit({}).checks.gitProvenance.status, 'NOT_VERIFIED');
});

test('AC08 actual CLI returns exit zero and structured warnings for legacy and malformed events', () => {
  const path = join(temp, 'event.json');
  for (const data of [JSON.stringify(event('Old PR body without metadata')), '{bad JSON']) {
    writeFileSync(path, data);
    const r = spawnSync(process.execPath, [script], { cwd: repo, env: { ...env, GITHUB_EVENT_PATH: path,
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: merge, GITHUB_REF: 'refs/pull/7/merge',
      SECRET_TEST_VALUE: 'never-report-this-value' }, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    const output = JSON.parse(r.stdout);
    assert.equal(output.blocking, false);
    assert.ok(output.warnings.length > 0);
    assert.equal(r.stdout.includes('never-report-this-value'), false);
  }
});

test('AC08 missing event file stays advisory without raw path/error disclosure', () => {
  const r = runFromEnvironment({ GITHUB_EVENT_PATH: join(temp, 'no-event') }, repo);
  assert.deepEqual(r.warnings, ['AUDIT_UNAVAILABLE']);
  assert.equal(JSON.stringify(r).includes(temp), false);
});

test('AC08 preserve every G1a gate, event, permission, provenance and candidate job', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8').replaceAll('\r\n', '\n');
  const normalizedOriginal = workflow
    .replace('fetch-depth: 0 # merge-base history for advisory PR path audit', 'fetch-depth: 2')
    .replace(/      - name: Advisory PR evidence audit\n[\s\S]*?(?=      - name: Install dependencies\n)/, '');
  // SHA-256 of the complete G1a workflow at 640c4dfe; not a synthetic verdict.
  assert.equal(createHash('sha256').update(normalizedOriginal).digest('hex'), '5d9cac0a6dc7022d1dc73a625d2588d6aa6e1f5eb065e9012876987bb14f6d9d');
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(workflow, /pull_request_target:|secrets\.|contents: write|pull-requests: write/);
  const auditStep = workflow.slice(workflow.indexOf('      - name: Advisory PR evidence audit'), workflow.indexOf('      - name: Install dependencies'));
  assert.equal((auditStep.match(/continue-on-error: true/g) ?? []).length, 2);
  assert.doesNotMatch(auditStep, /github\.event\.pull_request\.(body|title|head\.ref)/);
  assert.match(auditStep, /node scripts\/ci\/pr-evidence-audit\.mjs/);
  assert.match(workflow, /name: Unit and action tests\n        run: npm run test:unit/);
});
