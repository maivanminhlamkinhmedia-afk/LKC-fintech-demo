import { validateStagingEnvironment, validateBrowserArtifactSafety, demand } from '../../scripts/cms-e2e/guard.mjs'
import { loadManifest } from '../../scripts/cms-e2e/fixtures.mjs'

export default async function globalSetup() {
  validateStagingEnvironment(process.env)
  validateBrowserArtifactSafety(process.env)
  demand(process.env.CMS_E2E_RUNNING === 'YES' && Boolean(process.env.CMS_E2E_CREDENTIALS), 'USE_GUARDED_STAGING_RUNNER')
  const manifest = await loadManifest(process.env.CMS_E2E_MANIFEST)
  demand(manifest.runId === process.env.CMS_E2E_RUN_ID && /^[a-f0-9]{40}$/.test(process.env.CMS_E2E_BUILD_HEAD ?? ''), 'RUN_PROVENANCE_MISMATCH')
}
