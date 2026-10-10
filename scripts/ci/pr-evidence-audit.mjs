/**
 * G1b-01: advisory metadata/Git audit, NOT an approval or CI attestation.
 * Node 22, built-ins only. Reads GITHUB_EVENT_PATH; no network, tokens or writes.
 * stdout is a redacted JSON report. PR text is never executed or echoed.
 *
 * Optional machine-readable companion to the G0 human PR template:
 * <!-- lkc-evidence:v1
 * {"task":{"id":"G1b-01","outcome":"Audit PR evidence"},
 *  "source":{"head":"FULL_HEAD_SHA","base":"FULL_BASE_SHA"},
 *  "paths":[{"change":"MODIFY","path":".github/workflows/ci.yml"}],
 *  "review":{"reviewer":"Claude 2","verdict":"PASS",
 *    "revision":"FULL_HEAD_SHA","evidence":"review report reference"},
 *  "ci":{"status":"NOT_RUN"},
 *  "dup":{"id":"LKC-DUP-001","status":"PARTIAL","action":"EXTEND",
 *    "checkedScope":["base, PRs and local worktrees"],"evidence":"preflight reference"}}
 * -->
 * Exactly one block; free-form/legacy PRs remain advisory NOT_VERIFIED. Extra
 * keys confer no trust. CREATE/MODIFY/DELETE are exact, case-sensitive paths;
 * renames are DELETE + CREATE. Git uses merge-base...head, not base..head.
 * Optional source.checkout must match actual checkout (not source head).
 * Executed CI declarations need sourceHead, repository, prNumber, runId,
 * attempt, event and evidence; even matching claims stay unauthenticated.
 * Review revision must name source head, never the synthetic merge. A prior
 * reviewed blob set still needs human verification; it is not inferred here.
 * Body edits are seen on the next supported G1a event/rerun, not continuously.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PATHS = 1000;
const BEGIN = '<!-- lkc-evidence:v1';
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 500) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const sha = (v) => typeof v === 'string' && SHA.test(v);
const positive = (v) => Number.isSafeInteger(v) && v > 0;

function reportShell() {
  return {
    schemaVersion: 1, mode: 'ADVISORY', blocking: false,
    trust: {
      metadata: 'UNTRUSTED_PR_DECLARATION', git: 'LOCAL_HISTORY_ONLY',
      independentReview: 'NOT_VERIFIED', ci: 'NOT_VERIFIED',
      semanticDuplicateDetection: 'NOT_PERFORMED',
    },
    provenance: {}, checks: {}, warnings: [],
  };
}

function warn(report, code) { report.warnings.push(code); }

function parseMetadata(body) {
  if (body == null || body === '') return { status: 'MISSING' };
  if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BODY_BYTES) return { status: 'INVALID' };
  const start = body.indexOf(BEGIN);
  if (start < 0) return { status: 'MISSING' };
  const end = body.indexOf('-->', start + BEGIN.length);
  if (end < 0 || body.indexOf(BEGIN, start + BEGIN.length) >= 0) return { status: 'INVALID' };
  try {
    const value = JSON.parse(body.slice(start + BEGIN.length, end));
    return record(value) ? { status: 'PRESENT', value } : { status: 'INVALID' };
  } catch { return { status: 'INVALID' }; }
}

function git(cwd, args) {
  // No shell, no PR-supplied flags/ref/path expressions, no fetch or credentials.
  return execFileSync('git', ['--no-pager', ...args], {
    cwd, encoding: 'utf8', shell: false, timeout: 10000,
    maxBuffer: MAX_EVENT_BYTES, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function inspectGit(report, event, context, cwd) {
  const isPr = context.eventName === 'pull_request';
  const pr = event.pull_request;
  const head = isPr ? pr?.head?.sha : context.githubSha;
  const base = isPr ? pr?.base?.sha : null;
  const number = isPr && positive(pr?.number) ? pr.number : null;
  report.provenance = {
    event: isPr ? 'pull_request' : context.eventName === 'workflow_dispatch' ? 'workflow_dispatch' : 'UNSUPPORTED',
    prNumber: number, sourceHead: sha(head) ? head : null, base: sha(base) ? base : null,
    githubSha: sha(context.githubSha) ? context.githubSha : null,
    ref: typeof context.ref === 'string' && /^refs\/[a-zA-Z0-9/_.-]{1,240}$/.test(context.ref) ? context.ref : null,
    checkout: null, parents: [], syntheticMerge: null, mergeBase: null,
    checkoutKind: isPr ? 'PR_SYNTHETIC_MERGE' : 'BRANCH_DISPATCH',
    fork: isPr && positive(pr?.head?.repo?.id) && positive(pr?.base?.repo?.id)
      ? pr.head.repo.id !== pr.base.repo.id : null,
  };
  if (!sha(head) || !sha(context.githubSha) ||
      (isPr && (!sha(base) || number === null)) ||
      (!isPr && context.eventName !== 'workflow_dispatch')) {
    report.checks.gitProvenance = { status: 'NOT_VERIFIED' };
    warn(report, 'EVENT_PROVENANCE_INVALID');
    return null;
  }
  try {
    const checkout = git(cwd, ['rev-parse', '--verify', 'HEAD']).trim();
    const parentText = git(cwd, ['show', '-s', '--format=%P', 'HEAD']).trim();
    const parents = parentText ? parentText.split(' ') : [];
    if (!sha(checkout) || !parents.every(sha)) throw new Error('Invalid Git output');
    Object.assign(report.provenance, { checkout, parents });
    const consistent = checkout === context.githubSha && (isPr
      ? context.ref === `refs/pull/${number}/merge` && parents.length === 2 && parents[0] === base && parents[1] === head
      : checkout === head && typeof context.ref === 'string' && /^refs\/(heads|tags)\/.+/.test(context.ref));
    report.checks.gitProvenance = { status: consistent ? 'MATCH' : 'MISMATCH' };
    if (!consistent) { warn(report, 'CHECKOUT_PROVENANCE_MISMATCH'); return null; }
    if (!isPr) return null;
    report.provenance.syntheticMerge = checkout;
    const bases = git(cwd, ['merge-base', '--all', base, head]).trim().split('\n');
    if (bases.length !== 1 || !sha(bases[0])) throw new Error('Ambiguous merge base');
    report.provenance.mergeBase = bases[0];
    const fields = git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', bases[0], head, '--']).split('\0');
    if (fields.pop() !== '' || fields.length % 2 || fields.length > MAX_PATHS * 2) throw new Error('Invalid or oversized diff');
    const paths = [];
    for (let i = 0; i < fields.length; i += 2) {
      const change = { A: 'CREATE', M: 'MODIFY', D: 'DELETE', T: 'MODIFY' }[fields[i]];
      if (!change || !exactPath(fields[i + 1])) throw new Error('Unsupported diff path/status');
      paths.push({ change, path: fields[i + 1] });
    }
    return paths;
  } catch {
    // Never expose stderr, command arguments, local paths or exception text.
    if (!report.checks.gitProvenance) report.checks.gitProvenance = { status: 'NOT_VERIFIED' };
    warn(report, 'GIT_HISTORY_OR_DIFF_NOT_VERIFIED');
    return null;
  }
}

function exactPath(p) {
  // Brackets are literal Git path characters (including Next.js dynamic routes).
  // Allowlist comparison uses exact strings, never glob or pattern expansion.
  return text(p, 1024) && !/[\x00-\x1f\x7f\\:*?{}]/.test(p) &&
    !p.startsWith('/') && p.split('/').every((part) => part && part !== '.' && part !== '..') && p === p.trim();
}

function auditDeclarations(report, metadata, event, actual) {
  const m = metadata.value ?? {};
  const taskPresent = record(m.task) && text(m.task.id, 80) &&
    /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)+$/i.test(m.task.id) && text(m.task.outcome);
  report.checks.task = { status: taskPresent ? 'PRESENT' : 'NOT_VERIFIED' };
  if (!taskPresent) warn(report, 'TASK_ID_OR_OUTCOME_MISSING_OR_INVALID');

  const sourcePresent = record(m.source) && sha(m.source.head) && sha(m.source.base);
  const sourceMatch = sourcePresent && report.checks.gitProvenance.status === 'MATCH' &&
    m.source.head === report.provenance.sourceHead && m.source.base === report.provenance.base &&
    (m.source.checkout === undefined || (sha(m.source.checkout) && m.source.checkout === report.provenance.checkout));
  report.checks.sourceDeclaration = { status: !sourcePresent ? 'NOT_VERIFIED' : sourceMatch ? 'MATCH' : 'MISMATCH' };
  if (!sourceMatch) warn(report, 'SOURCE_DECLARATION_MISSING_OR_MISMATCH');

  const declaredPaths = m.paths;
  const validPaths = Array.isArray(declaredPaths) && declaredPaths.length > 0 && declaredPaths.length <= MAX_PATHS &&
    declaredPaths.every((p) => record(p) && ['CREATE', 'MODIFY', 'DELETE'].includes(p.change) && exactPath(p.path)) &&
    new Set(declaredPaths.map((p) => p.path)).size === declaredPaths.length;
  const key = (p) => `${p.change}\0${p.path}`;
  const matchingPaths = actual !== null && validPaths && actual.length === declaredPaths.length &&
    actual.every((p) => declaredPaths.some((d) => key(p) === key(d)));
  report.checks.paths = {
    status: actual === null || !validPaths ? 'NOT_VERIFIED' : matchingPaths ? 'MATCH' : 'MISMATCH',
    actual, declaredCount: validPaths ? declaredPaths.length : null,
  };
  if (!matchingPaths) warn(report, 'EXACT_ALLOWLIST_MISSING_INVALID_OR_MISMATCH');

  const review = m.review;
  const reviewPresent = record(review) && text(review.reviewer, 100) &&
    ['PASS', 'FAIL', 'NOT_REVIEWED', 'PENDING'].includes(review.verdict) && sha(review.revision);
  report.checks.review = {
    declaration: reviewPresent ? 'PRESENT' : 'NOT_VERIFIED',
    declaredVerdict: reviewPresent ? review.verdict : null,
    revisionMatchesSource: reviewPresent ? review.revision === report.provenance.sourceHead : null,
    evidenceReferencePresent: record(review) && text(review.evidence, 2000),
    authentication: 'NOT_VERIFIED',
  };
  warn(report, reviewPresent ? 'REVIEW_DECLARATION_NOT_AUTHENTICATED' : 'REVIEW_EVIDENCE_MISSING_OR_INVALID');
  if (reviewPresent && review.revision !== report.provenance.sourceHead) warn(report, 'REVIEW_REVISION_MISMATCH');

  const ci = m.ci;
  const ciStatus = record(ci) && ['NOT_RUN', 'NOT_STARTED', 'PASS', 'FAIL', 'IN_PROGRESS', 'SKIP', 'CANCELLED'].includes(ci.status)
    ? ci.status : null;
  const notRun = ciStatus === 'NOT_RUN' || ciStatus === 'NOT_STARTED';
  const ciComplete = ciStatus !== null && !notRun && sha(ci.sourceHead) && text(ci.repository) &&
    positive(ci.prNumber) && positive(ci.runId) && positive(ci.attempt) &&
    ['pull_request', 'workflow_dispatch'].includes(ci.event) && text(ci.evidence, 2000);
  const ciMatch = ciComplete && ci.sourceHead === report.provenance.sourceHead &&
    ci.prNumber === report.provenance.prNumber && ci.repository === event.repository?.full_name;
  report.checks.ci = {
    declaredStatus: ciStatus,
    identity: notRun ? 'NOT_APPLICABLE' : !ciComplete ? 'NOT_VERIFIED' : ciMatch ? 'MATCH' : 'MISMATCH',
    authentication: 'NOT_VERIFIED',
    // The running audit is not evidence that later test/build gates passed.
    currentRunConclusion: 'NOT_VERIFIED',
  };
  warn(report, ciStatus === null ? 'CI_DECLARATION_MISSING_OR_INVALID' : notRun ? 'CI_DECLARED_NOT_RUN' : 'CI_DECLARATION_NOT_AUTHENTICATED');
  if (ciComplete && !ciMatch) warn(report, 'CI_COMMIT_OR_PR_MISMATCH');

  const dup = m.dup;
  const dupPresent = record(dup) && dup.id === 'LKC-DUP-001' &&
    ['NOT_STARTED', 'PARTIAL', 'IMPLEMENTED_UNREVIEWED', 'REVIEWED', 'CI_PASS', 'BLOCKED'].includes(dup.status) &&
    ['REUSE', 'EXTEND', 'CONTINUE_REVIEW', 'CONTINUE_CI', 'NEW_TASK', 'ESCALATE_BOUNDARY'].includes(dup.action) &&
    Array.isArray(dup.checkedScope) && dup.checkedScope.length > 0 && dup.checkedScope.length <= 20 &&
    dup.checkedScope.every((s) => text(s)) && text(dup.evidence, 2000);
  report.checks.dup = { declaration: dupPresent ? 'PRESENT' : 'NOT_VERIFIED', semanticVerification: 'NOT_PERFORMED' };
  warn(report, dupPresent ? 'DUP_METADATA_ONLY_SEMANTIC_CHECK_REQUIRED' : 'DUP_PREFLIGHT_DECLARATION_MISSING_OR_INVALID');
}

/** Inputs are serialized event JSON and allowlisted runner facts, not executable PR objects. */
export function auditEvent({ eventJson, eventName, githubSha, ref, cwd = process.cwd() }) {
  const report = reportShell();
  let event;
  try {
    if (typeof eventJson !== 'string' || Buffer.byteLength(eventJson) > MAX_EVENT_BYTES) throw new Error('Size');
    event = JSON.parse(eventJson);
    if (!record(event)) throw new Error('Shape');
  } catch {
    warn(report, 'EVENT_JSON_INVALID_OR_OVERSIZED');
    return report;
  }
  const actual = inspectGit(report, event, { eventName, githubSha, ref }, cwd);
  if (eventName !== 'pull_request') {
    report.checks.prMetadata = { status: 'NOT_APPLICABLE' };
    return report;
  }
  const metadata = parseMetadata(event.pull_request?.body);
  report.checks.prMetadata = { status: metadata.status };
  if (metadata.status !== 'PRESENT') warn(report, 'OPTIONAL_LKC_EVIDENCE_V1_BLOCK_MISSING_OR_INVALID');
  auditDeclarations(report, metadata, event, actual);
  return report;
}

export function runFromEnvironment(env = process.env, cwd = process.cwd()) {
  try {
    // Read only the event file explicitly supplied by the runner; never load .env.
    if (!env.GITHUB_EVENT_PATH || statSync(env.GITHUB_EVENT_PATH).size > MAX_EVENT_BYTES) throw new Error('Event');
    return auditEvent({
      eventJson: readFileSync(env.GITHUB_EVENT_PATH, 'utf8'),
      eventName: env.GITHUB_EVENT_NAME, githubSha: env.GITHUB_SHA, ref: env.GITHUB_REF, cwd,
    });
  } catch {
    const report = reportShell();
    warn(report, 'AUDIT_UNAVAILABLE');
    return report;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // No raw errors, title, body, actor, evidence URL or arbitrary environment values.
  process.stdout.write(`${JSON.stringify(runFromEnvironment(), null, 2)}\n`);
  // Metadata failures never change the exit code. Actual CI gates remain separate.
}
