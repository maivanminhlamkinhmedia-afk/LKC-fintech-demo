import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createAppJournalOutputFilter, MAX_APP_JOURNAL_LINE_LENGTH } from '../scripts/cms-e2e/app-journal-output.mjs'

const marker = (phase, errno) => `CMS_MEDIA_JOURNAL_ADVANCE_FAILED phase=${phase} errno=${errno}`
const safe = (phase, errno) => `CMS_E2E APP_JOURNAL phase=${phase} errno=${errno}\n`
const PRIVATE = 'SYNTHETIC_PRIVATE_PASSWORD_COOKIE_SQL_PATH'

test('app journal filter accepts exact producer schema across chunks, CRLF, and final tail', () => {
  const lines = [], filter = createAppJournalOutputFilter(line => lines.push(line))
  const first = Buffer.from(`${marker('write', 'EIO')}\r\n`)
  filter.push(first.subarray(0, 9))
  filter.push(first.subarray(9, 27))
  filter.push(Buffer.concat([first.subarray(27), Buffer.from(`${marker('rename', 'OTHER')}\n${marker('close', 'EPERM')}`)]))
  filter.end()
  filter.end()
  assert.deepEqual(lines, [safe('write', 'EIO'), safe('rename', 'OTHER'), safe('close', 'EPERM')])
})

test('app journal allowlist matches every producer phase and errno fallback', () => {
  const lines = [], filter = createAppJournalOutputFilter(line => lines.push(line))
  const phases = ['open', 'write', 'sync', 'close', 'rename']
  const errnos = ['EACCES', 'EPERM', 'EEXIST', 'ENOENT', 'EBUSY', 'EIO', 'ENOSPC', 'EMFILE', 'OTHER']
  for (const phase of phases) for (const errno of errnos) filter.push(`${marker(phase, errno)}\n`)
  filter.end()
  assert.deepEqual(lines, phases.flatMap(phase => errnos.map(errno => safe(phase, errno))))
})

test('app journal filter drops raw, forged, controlled, unknown, and oversized lines', () => {
  const lines = [], filter = createAppJournalOutputFilter(line => lines.push(line))
  const valid = marker('sync', 'ENOSPC')
  for (const line of [
    PRIVATE, `prefix ${valid}`, `${valid} suffix`, `${valid} extra=1`,
    marker('commit', 'EIO'), marker('sync', 'ESECRET'),
    `\x1b[31m${valid}\x1b[0m`, `${valid}\r${PRIVATE}`, `${valid}\u2028`,
    `CMS_E2E CASE {"status":"passed","payload":"${PRIVATE}"}`,
    `CMS_E2E RESULT {"status":"passed"}`, `CMS_E2E CLEANUP ${PRIVATE}`,
    `CMS_E2E VERIFIED ${PRIVATE}`, `CMS_E2E STOP ${PRIVATE}`,
    `${PRIVATE.repeat(MAX_APP_JOURNAL_LINE_LENGTH)}${valid}`,
  ]) filter.push(`${line}\n`)
  filter.push(`${valid}\n`)
  filter.end()
  assert.deepEqual(lines, [safe('sync', 'ENOSPC')])
})

test('app journal output callback failure closes only diagnostic transport', () => {
  let writes = 0
  const filter = createAppJournalOutputFilter(() => { writes++; throw new Error(PRIVATE) })
  assert.doesNotThrow(() => {
    filter.push(`${marker('open', 'EACCES')}\n${marker('write', 'EIO')}\n`)
    filter.end()
  })
  assert.equal(writes, 1)
})

test('real runner app launcher forwards only journal records and preserves child exit', () => {
  const runUrl = new URL('../scripts/cms-e2e/run.mjs', import.meta.url).href
  const childCode = `
    const first = ${JSON.stringify(marker('write', 'EIO'))};
    process.stdout.write(${JSON.stringify(PRIVATE + ' stdout\n')});
    process.stderr.write(${JSON.stringify(PRIVATE + ' stderr\n')});
    process.stderr.write(first.slice(0, 17));
    await new Promise(resolve => setTimeout(resolve, 20));
    process.stderr.write(first.slice(17) + '\\r\\n' + ${JSON.stringify(marker('rename', 'OTHER'))} + '\\n');
    process.stderr.write(${JSON.stringify(`prefix ${marker('sync', 'EIO')}\nCMS_E2E VERIFIED ${PRIVATE}\n`)});
    process.stderr.write(${JSON.stringify(marker('close', 'EPERM'))});
    process.exitCode = 23;
  `
  const runnerCode = `
    import { launchApp } from ${JSON.stringify(runUrl)};
    const child = launchApp(['--input-type=module', '-e', ${JSON.stringify(childCode)}], process.env, process.cwd());
    child.once('close', code => {
      process.stdout.write('CHILD_EXIT ' + code + '\\n');
      process.exitCode = code === 23 ? 0 : 1;
    });
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', runnerCode], {
    cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(result.status, 0, `runner failed with signal ${result.signal}`)
  // Node may warn about importing an existing TypeScript helper in run.mjs;
  // neither wrapper stderr nor runner stdout may contain the child's payload.
  assert.equal(result.stderr.includes(PRIVATE), false)
  assert.equal(result.stderr.includes(marker('write', 'EIO')), false)
  assert.equal(result.stdout, `${safe('write', 'EIO')}${safe('rename', 'OTHER')}${safe('close', 'EPERM')}CHILD_EXIT 23\n`)
  assert.equal(result.stdout.includes(PRIVATE), false)
})
