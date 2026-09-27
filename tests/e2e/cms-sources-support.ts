import { expect, type Page, type Request } from '@playwright/test'

// The sources panel has its own manual actions. Never count login, article
// autosaves, GETs or RSC revalidation as source mutations.
export const isSourceAction = (request: Request) => request.method() === 'POST'
  && 'next-action' in request.headers()
  && /^\/creator\/articles\/[^/]+\/sources$/.test(new URL(request.url()).pathname)

export function countSourceActions(page: Page) {
  let count = 0
  page.on('request', request => { if (isSourceAction(request)) count++ })
  return () => count
}

export async function holdSourceResponses(page: Page, limit = 1) {
  const pending: { release: (drop: boolean) => void }[] = []
  let started = 0
  let disposed = false
  await page.route('**/creator/articles/**/sources', async route => {
    if (!isSourceAction(route.request()) || started >= limit || disposed) return route.continue()
    started++
    // The actual authenticated action executes against the staging app/DB.
    // Hold/drop its real response only; never synthesize a successful payload.
    const response = await route.fetch()
    if (disposed) return route.fulfill({ response })
    const drop = await new Promise<boolean>(release => { pending.push({ release }) })
    if (drop) await route.abort('failed')
    else await route.fulfill({ response })
  })
  return {
    started: () => started,
    async ready(index = 0) { await expect.poll(() => pending.length).toBeGreaterThan(index) },
    release(index = 0, drop = false) { pending[index]?.release(drop) },
    dispose() { disposed = true; for (const entry of pending) entry.release(false) },
  }
}
