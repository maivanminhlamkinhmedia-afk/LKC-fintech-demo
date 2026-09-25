import { createServer } from 'node:net'

export const STAGING_BASE_URL = 'http://127.0.0.1:3001'
export const STAGING_DATABASE = 'edpmjmha_lkcstage'
export const STAGING_USERNAME = 'edpmjmha_lkcstg'
export const DUMMY_DATABASE_URL = 'mysql://build:build@127.0.0.1:3306/build'

export class HarnessError extends Error {
  constructor(code) { super(code); this.name = 'HarnessError'; this.code = code }
}
export function demand(condition, code) { if (!condition) throw new HarnessError(code) }
export function safeFailure(error) { return error instanceof HarnessError ? error.code : 'HARNESS_FAILED_DETAILS_REDACTED' }
export function validateBrowserArtifactSafety(env) {
  // Playwright 1.63 can write error-context.md even with screenshots/traces off.
  // Its AI aria snapshot can include input values, including a failed login.
  demand(env.PLAYWRIGHT_NO_COPY_PROMPT === '1', 'BROWSER_CREDENTIAL_ARTIFACT_GUARD_REQUIRED')
}

// This function only validates supplied strings. Importing it never reads files,
// environment variables, sockets or the database.
export function validateStagingEnvironment(env) {
  demand(env.E2E_BASE_URL === STAGING_BASE_URL && env.NEXTAUTH_URL === STAGING_BASE_URL, 'STAGING_BASE_URL_MISMATCH')
  let url
  try { url = new URL(env.DATABASE_URL) } catch { throw new HarnessError('DATABASE_URL_INVALID') }
  let username, database, password
  try {
    username = decodeURIComponent(url.username)
    database = decodeURIComponent(url.pathname.slice(1))
    password = decodeURIComponent(url.password)
  } catch { throw new HarnessError('DATABASE_URL_INVALID') }
  demand(url.protocol === 'mysql:' && url.hostname === '127.0.0.1' && url.port === '3307'
    && username === STAGING_USERNAME && database === STAGING_DATABASE
    && !url.search && !url.hash && password.length > 0, 'STAGING_DATABASE_TARGET_MISMATCH')
  return { host: '127.0.0.1', port: 3307, user: username, database, password }
}

export async function assertDatabaseIdentity(db) {
  const rows = await db.$queryRaw`SELECT DATABASE() AS databaseName, CURRENT_USER() AS databaseUser`
  demand(rows.length === 1 && rows[0].databaseName === STAGING_DATABASE
    && typeof rows[0].databaseUser === 'string'
    && rows[0].databaseUser.split('@')[0] === STAGING_USERNAME, 'STAGING_SERVER_IDENTITY_MISMATCH')
}

export async function assertPortAvailable(probe = () => new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', () => reject(new HarnessError('PORT_3001_OCCUPIED_OR_UNAVAILABLE')))
  server.listen({ host: '127.0.0.1', port: 3001, exclusive: true }, () => server.close(resolve))
})) {
  try { await probe() } catch { throw new HarnessError('PORT_3001_OCCUPIED_OR_UNAVAILABLE') }
}

export async function connectStaging(env) {
  const target = validateStagingEnvironment(env)
  const [{ PrismaClient }, { PrismaMariaDb }] = await Promise.all([
    import('@prisma/client'), import('@prisma/adapter-mariadb'),
  ])
  const db = new PrismaClient({ adapter: new PrismaMariaDb({ ...target, connectionLimit: 2, allowPublicKeyRetrieval: true }), log: [] })
  try { await assertDatabaseIdentity(db); return db }
  catch (error) { await db.$disconnect().catch(() => {}); throw error }
}

// Used by the runner and mocked tests: cleanup failure always fails the run;
// the original error is never printed with credentials/SQL/body diagnostics.
export async function withCleanup(work, cleanup) {
  let result, workError
  try { result = await work() } catch (error) { workError = error }
  try { await cleanup() } catch { throw new HarnessError('CLEANUP_NOT_VERIFIED') }
  if (workError) throw workError
  return result
}
