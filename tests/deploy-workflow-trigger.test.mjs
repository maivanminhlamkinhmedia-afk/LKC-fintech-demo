import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// js-yaml is already locked through ESLint; no network or workflow execution is needed.
const { dump, JSON_SCHEMA, load } = createRequire(import.meta.url)('js-yaml');
const source = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const lock = '${{ false }}';

function mapping(value, name) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be a mapping`);
}

function parse(source) {
  return load(source, {
    schema: JSON_SCHEMA,
    json: false,
    onWarning(warning) { throw warning; },
  });
}

function assertManualGate(source) {
  const workflow = parse(source);
  mapping(workflow, 'workflow');
  mapping(workflow.on, 'on');
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'], 'only workflow_dispatch is allowed');
  assert.deepEqual(workflow.on.workflow_dispatch, {}, 'dispatch must not accept approval inputs');

  mapping(workflow.concurrency, 'concurrency');
  assert.equal(workflow.concurrency.group, 'deploy-cpanel', 'keep the deployment concurrency group');
  assert.equal(workflow.concurrency['cancel-in-progress'], false, 'never cancel an in-progress deploy');

  mapping(workflow.jobs, 'jobs');
  assert.ok(Object.hasOwn(workflow.jobs, 'build-and-deploy'), 'keep the existing deploy job');
  for (const [name, job] of Object.entries(workflow.jobs)) {
    mapping(job, `jobs.${name}`);
    assert.ok(Object.hasOwn(job, 'if'), `${name} must have its own job-level lock`);
    assert.equal(job.if, lock, `${name} must use the literal false job-level lock`);
    if (Object.hasOwn(job, 'concurrency')) {
      mapping(job.concurrency, `${name}.concurrency`);
      assert.equal(job.concurrency['cancel-in-progress'], false, `${name} must never cancel an in-progress deploy`);
    }
  }
}

// Mutations stay in memory and exercise the same validator as the real file.
function rejectsMutation(name, mutate, expected) {
  test(name, () => {
    const workflow = parse(source);
    mutate(workflow);
    assert.throws(() => assertManualGate(dump(workflow, { schema: JSON_SCHEMA })), expected);
  });
}

test('deploy YAML permits only manual dispatch and locks every job before any steps or secrets', () => {
  assertManualGate(source);
});

test('restoring the original push: main trigger fails the gate', () => {
  const mutated = source.replace(/^(on:\s*)$/m, '$1\n  push:\n    branches: [main]');
  assert.notEqual(mutated, source, 'push mutation must change the fixture');
  assert.throws(() => assertManualGate(mutated), /only workflow_dispatch/);
});

test('removing the job-level false lock fails the gate', () => {
  const mutated = source.replace(/^    if:.*\r?\n/m, '');
  assert.notEqual(mutated, source, 'lock mutation must change the fixture');
  assert.throws(() => assertManualGate(mutated), /job-level lock/);
});

for (const [event, config] of Object.entries({
  push: { branches: ['main'] },
  pull_request: {},
  pull_request_target: {},
  schedule: [{ cron: '0 0 * * *' }],
  workflow_run: { workflows: ['CI'], types: ['completed'] },
  repository_dispatch: {},
  workflow_call: {},
  release: { types: ['published'] },
})) {
  rejectsMutation(`rejects added ${event} trigger`, (workflow) => {
    workflow.on[event] = config;
  }, /only workflow_dispatch/);
}

for (const trigger of ['push', ['push', 'workflow_dispatch'], null, {}]) {
  rejectsMutation(`rejects alternate trigger structure ${JSON.stringify(trigger)}`, (workflow) => {
    workflow.on = trigger;
  }, /on must be a mapping|only workflow_dispatch/);
}

rejectsMutation('dispatch inputs cannot represent PO approval', (workflow) => {
  workflow.on.workflow_dispatch = { inputs: { po_approved: { type: 'boolean', default: true } } };
}, /dispatch must not accept approval inputs/);

for (const condition of [
  true,
  false,
  'false',
  '${{ true }}',
  '${{ always() }}',
  '${{ inputs.po_approved }}',
  "${{ contains(github.event.pull_request.labels.*.name, 'po-approved') }}",
  "${{ contains(github.event.head_commit.message, 'PO APPROVED') }}",
  "${{ github.event_name == 'workflow_dispatch' }}",
]) {
  rejectsMutation(`rejects replacement lock ${JSON.stringify(condition)}`, (workflow) => {
    workflow.jobs['build-and-deploy'].if = condition;
  }, /literal false job-level lock/);
}

rejectsMutation('step-level locks cannot replace the job-level lock', (workflow) => {
  const job = workflow.jobs['build-and-deploy'];
  delete job.if;
  for (const step of job.steps) step.if = lock;
}, /job-level lock/);

rejectsMutation('environment: production cannot replace PO approval or the lock', (workflow) => {
  const job = workflow.jobs['build-and-deploy'];
  delete job.if;
  job.environment = 'production';
}, /job-level lock/);

rejectsMutation('an additional unlocked job cannot bypass the gate', (workflow) => {
  workflow.jobs.bypass = { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo bypass' }] };
}, /bypass must have its own job-level lock/);

for (const cancellation of [true, 'false', '${{ true }}']) {
  rejectsMutation(`rejects workflow cancellation ${JSON.stringify(cancellation)}`, (workflow) => {
    workflow.concurrency['cancel-in-progress'] = cancellation;
  }, /never cancel an in-progress deploy/);
}

rejectsMutation('job concurrency cannot enable cancellation', (workflow) => {
  workflow.jobs['build-and-deploy'].concurrency = { group: 'deploy-cpanel', 'cancel-in-progress': true };
}, /never cancel an in-progress deploy/);

rejectsMutation('the deployment concurrency group must stay stable', (workflow) => {
  workflow.concurrency.group = 'another-group';
}, /keep the deployment concurrency group/);

for (const jobs of [null, [], {}]) {
  rejectsMutation(`rejects missing job structure ${JSON.stringify(jobs)}`, (workflow) => {
    workflow.jobs = jobs;
  }, /jobs must be a mapping|keep the existing deploy job/);
}

for (const [name, malformed, expected] of [
  ['invalid YAML', 'on: [', { name: 'YAMLException' }],
  ['duplicate trigger key', `${source}\non: { push: {} }\n`, /duplicated mapping key/],
  ['duplicate job lock', source.replace(/^    if:.*$/m, '$&\n    if: true'), /duplicated mapping key/],
  ['multiple YAML documents', `${source}\n---\non: push\n`, /single document/],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => assertManualGate(malformed), expected);
  });
}
