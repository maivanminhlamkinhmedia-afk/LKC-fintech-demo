import { randomBytes } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, open, readFile, writeFile, unlink, copyFile, symlink } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertPortAvailable, connectStaging, demand, DUMMY_DATABASE_URL, HarnessError, safeFailure, validateStagingEnvironment, withCleanup } from './guard.mjs'
import { createFixturePlan, createFixtures, manifestPath, saveManifest, loadManifest, discoverCreatedArticles, cleanupFixtures } from './fixtures.mjs'
import { createDiagnosticOutputFilter } from './diagnostics.mjs'

function launch(args, env, cwd) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  // Never forward raw app/build diagnostics, auth output, SQL or credentials.
  child.stdout.resume(); child.stderr.resume()
  child.on('error', () => { child.cmsLaunchFailed = true })
  return child
}
async function completed(child) {
  return new Promise((resolveCode, reject) => {
    child.once('error', () => reject(new HarnessError('CHILD_PROCESS_START_FAILED')))
    child.once('exit', code => resolveCode(code ?? 1))
  })
}
function head(cwd) {
  try {
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    demand(dirty.trim() === '', 'CHECKOUT_HAS_TRACKED_CHANGES')
    const extraSources = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z', '--',
      'src', 'public', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'eslint.config.mjs',
      'scripts/cms-e2e', 'tests/e2e', 'playwright.config.ts'],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    demand(extraSources === '', 'CHECKOUT_HAS_UNTRACKED_BUILD_INPUTS')
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    demand(/^[a-f0-9]{40}$/.test(commit), 'CHECKOUT_HEAD_INVALID')
    return commit
  } catch (error) { throw error instanceof HarnessError ? error : new HarnessError('CHECKOUT_PROVENANCE_FAILED') }
}
async function buildSnapshot(cwd, runId) {
  const snapshot = resolve(cwd, '.next', `cms-e2e-build-${runId}`)
  await mkdir(snapshot, { recursive: true })
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src', 'public'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean)
  const configs = ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'eslint.config.mjs']
  for (const path of [...tracked, ...configs]) {
    // Explicit build source allowlist: never enumerate/copy .env, credentials,
    // Git internals, staging manifests or unrelated workspace files.
    demand(!path.split(/[\\/]/).some(part => part.startsWith('.env') || part === '..') && !/\.(?:pem|key)$/i.test(path), 'UNSAFE_BUILD_INPUT_PATH')
    const target = resolve(snapshot, path)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(resolve(cwd, path), target)
  }
  await symlink(resolve(cwd, 'node_modules'), resolve(snapshot, 'node_modules'), 'junction')
  return snapshot
}
async function waitForApp(child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    demand(child.pid && !child.cmsLaunchFailed && child.exitCode === null && child.signalCode === null, 'OWN_APP_EXITED_BEFORE_READY')
    try {
      if (child.cmsReady) {
        const response = await fetch('http://127.0.0.1:3001/dang-nhap', { signal: AbortSignal.timeout(1000), redirect: 'manual' })
        if (response.status === 200 && child.exitCode === null && child.signalCode === null) return
      }
    } catch { /* The runner polls only its own child after an exclusive port check. */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  throw new HarnessError('OWN_APP_START_TIMEOUT')
}
async function stopOwnChild(child) {
  if (!child?.pid || child.cmsLaunchFailed || child.exitCode !== null || child.signalCode !== null) return
  const closed = completed(child)
  child.kill()
  await closed
}

export async function runStaging(argv, sourceEnv, cwd = process.cwd()) {
  demand(argv.length === 2 && argv.includes('--staging') && argv.includes('--ci-reviewed'), 'REQUIRES_EXPLICIT_STAGING_AND_CI_REVIEWED_FLAGS')
  validateStagingEnvironment(sourceEnv)
  await assertPortAvailable()
  const commit = head(cwd)
  const manifest = createFixturePlan()
  const path = manifestPath(manifest.runId, cwd)
  const lockPath = resolve(cwd, 'playwright', '.cms-e2e', 'active.lock')
  await mkdir(dirname(lockPath), { recursive: true })
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) } catch { throw new HarnessError('ANOTHER_RUN_OR_STALE_LOCK_EXISTS') }
  let db, app, fixturesCommitted = false
  try {
    await lock.writeFile(JSON.stringify({ runId: manifest.runId, pid: process.pid, commit }))
    const runtimeEnv = { ...sourceEnv, NEXTAUTH_SECRET: randomBytes(48).toString('base64url'),
      NEXT_TELEMETRY_DISABLED: '1', GOOGLE_SHEET_ID: '', NODE_ENV: 'production', DOTENV_CONFIG_PATH: 'NUL' }
    // Build never receives staging credentials. A fresh build plus HEAD/BUILD_ID
    // provenance prevents accidentally running an earlier checkout's artifact.
    const buildEnv = { ...runtimeEnv, DATABASE_URL: DUMMY_DATABASE_URL, NEXTAUTH_SECRET: 'cms005-local-build-dummy-secret' }
    delete buildEnv.CMS_E2E_CREDENTIALS
    const snapshot = await buildSnapshot(cwd, manifest.runId)
    demand(await completed(launch([resolve(cwd, 'node_modules/next/dist/bin/next'), 'build', snapshot], buildEnv, snapshot)) === 0, 'DUMMY_BUILD_FAILED')
    demand(head(cwd) === commit, 'CHECKOUT_CHANGED_DURING_BUILD')
    const buildId = (await readFile(resolve(snapshot, '.next', 'BUILD_ID'), 'utf8')).trim()
    demand(buildId.length > 0, 'BUILD_ID_MISSING')
    await writeFile(resolve(snapshot, '.next', 'cms-e2e-build.json'), JSON.stringify({ commit, buildId }), { mode: 0o600 })
    await assertPortAvailable()
    db = await connectStaging(runtimeEnv)
    await saveManifest(path, manifest)
    await withCleanup(async () => {
      const { hash } = await import('bcryptjs')
      const credentials = await createFixtures(db, runtimeEnv, manifest, password => hash(password, 12))
      fixturesCommitted = true
      app = launch([resolve(cwd, 'node_modules/next/dist/bin/next'), 'start', snapshot, '--hostname', '127.0.0.1', '--port', '3001'], runtimeEnv, snapshot)
      let startupOutput = ''
      app.stdout.on('data', chunk => {
        startupOutput = `${startupOutput}${chunk.toString()}`.slice(-512)
        if (/Ready in/.test(startupOutput)) app.cmsReady = true
      })
      await writeFile(lockPath, JSON.stringify({ runId: manifest.runId, pid: process.pid, appPid: app.pid, commit }), { mode: 0o600 })
      await waitForApp(app)
      demand(head(cwd) === commit, 'CHECKOUT_CHANGED_BEFORE_TESTS')
      const testEnv = { ...runtimeEnv, CMS_E2E_RUNNING: 'YES', CMS_E2E_MANIFEST: path,
        CMS_E2E_RUN_ID: manifest.runId, CMS_E2E_CREDENTIALS: JSON.stringify(credentials), CMS_E2E_BUILD_HEAD: commit,
        PLAYWRIGHT_NO_COPY_PROMPT: '1' }
      const tests = spawn(process.execPath, [resolve(cwd, 'node_modules/@playwright/test/cli.js'), 'test'], {
        cwd, env: testEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      })
      // A matching prefix is insufficient: validate exact record fields, enums,
      // case/step codes and relative locations before forwarding any stdout.
      const output = createDiagnosticOutputFilter(line => process.stdout.write(line))
      tests.stdout.on('data', chunk => output.push(chunk))
      tests.stdout.on('end', () => output.end())
      tests.stderr.resume()
      demand(await completed(tests) === 0, 'BROWSER_SUITE_FAILED')
      demand(app.exitCode === null && app.signalCode === null, 'OWN_APP_EXITED_DURING_TESTS')
    }, async () => {
      await stopOwnChild(app)
      // A setup collision or uncertain commit response does not establish
      // ownership of existing rows. Preserve the manifest for operator review.
      demand(fixturesCommitted, 'FIXTURE_SETUP_UNCONFIRMED_NO_AUTOMATIC_DELETE')
      const latest = await loadManifest(path)
      await discoverCreatedArticles(db, runtimeEnv, latest, updated => saveManifest(path, updated))
      const counts = await cleanupFixtures(db, runtimeEnv, latest, { apply: true })
      process.stdout.write(`CMS_E2E CLEANUP ${JSON.stringify(counts)}\n`)
    })
    process.stdout.write(`CMS_E2E VERIFIED runId=${manifest.runId} commit=${commit}\n`)
  } finally {
    await stopOwnChild(app)
    if (db) await db.$disconnect().catch(() => {})
    await lock.close()
    await unlink(lockPath)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runStaging(process.argv.slice(2), process.env).catch(error => {
    process.stderr.write(`CMS_E2E STOP ${safeFailure(error)}\n`)
    process.exitCode = 1
  })
}
