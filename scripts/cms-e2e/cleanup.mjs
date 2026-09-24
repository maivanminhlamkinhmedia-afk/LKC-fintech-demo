import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertPortAvailable, connectStaging, demand, safeFailure, validateStagingEnvironment } from './guard.mjs'
import { loadManifest, saveManifest, discoverCreatedArticles, cleanupFixtures } from './fixtures.mjs'

export async function cleanupRun(argv, env) {
  demand(argv.length >= 2 && argv[0] === '--manifest' && typeof argv[1] === 'string'
    && (argv.length === 2 || argv.length === 3 && argv[2] === '--apply'), 'USE_MANIFEST_PATH_AND_OPTIONAL_APPLY')
  validateStagingEnvironment(env)
  if (argv.includes('--apply')) await assertPortAvailable()
  const path = argv[1]
  const manifest = await loadManifest(path)
  const db = await connectStaging(env)
  try {
    // Only --apply updates a recovery manifest; default check remains read-only.
    if (argv.includes('--apply')) await discoverCreatedArticles(db, env, manifest, updated => saveManifest(path, updated))
    const counts = await cleanupFixtures(db, env, manifest, { apply: argv.includes('--apply') })
    process.stdout.write(`CMS_E2E ${argv.includes('--apply') ? 'CLEANUP_VERIFIED' : 'CHECK_ONLY'} ${JSON.stringify(counts)}\n`)
  } finally { await db.$disconnect() }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  cleanupRun(process.argv.slice(2), process.env).catch(error => {
    process.stderr.write(`CMS_E2E STOP ${safeFailure(error)}\n`)
    process.exitCode = 1
  })
}
