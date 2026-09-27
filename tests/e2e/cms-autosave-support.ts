import { expect, type Page, type Request } from '@playwright/test'

export const isArticleAction = (request: Request) => request.method() === 'POST'
  && 'next-action' in request.headers() && new URL(request.url()).pathname.startsWith('/creator/articles/')

export async function pauseEditorClock(page: Page) {
  // Clean/new pages only, after hydration and before edits/composition (or after
  // confirmed leave). Advance fake time, not wall time. The generous future
  // target avoids racing Date.now() against the separate pauseAt protocol call.
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 60_000)
}

export function countArticleActions(page: Page) {
  let count = 0
  page.on('request', request => { if (isArticleAction(request)) count++ })
  return () => count
}

export async function holdActionResponses(page: Page, limit = 1) {
  const pending: { release: (drop: boolean) => void }[] = []
  let started = 0
  let disposed = false
  await page.route('**/creator/articles/**', async route => {
    if (!isArticleAction(route.request()) || started >= limit || disposed) return route.continue()
    started++
    // Forward the unchanged authenticated request to the real app/DB. Only its
    // actual response is delayed or lost; no success/auth payload is fabricated.
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
