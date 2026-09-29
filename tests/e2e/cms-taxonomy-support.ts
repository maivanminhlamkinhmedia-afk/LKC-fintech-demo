import { expect, type Page, type Request, type Response } from '@playwright/test'

const names = ['createTaxonomy', 'updateTaxonomy', 'deleteTaxonomy', 'searchTaxonomy',
  'updateArticleClassification', 'searchArticleClassificationOptions'] as const
export type TaxonomyAction = typeof names[number]
export function publicActionReferences(script: string): Map<TaxonomyAction, string> {
  const result = new Map<TaxonomyAction, string>()
  // Pinned Next 16 production client metadata, served publicly to the browser.
  // Do not read the private server-reference manifest/encryption key.
  for (const match of script.matchAll(/createServerReference\)\("([a-f0-9]{40,64})",[^;]{0,250}?,"(\w+)"\)/g)) {
    if (names.includes(match[2] as TaxonomyAction)) result.set(match[2] as TaxonomyAction, match[1])
  }
  return result
}
export function isTaxonomyAction(request: Request, ids: ReadonlyMap<TaxonomyAction, string>, actions: readonly TaxonomyAction[]) {
  if (request.method() !== 'POST') return false
  const id = request.headers()['next-action'], path = new URL(request.url()).pathname
  return actions.some(name => ids.get(name) === id && typeof id === 'string'
    && (name.includes('Classification') ? /^\/creator\/articles\/[^/]+\/classification$/.test(path) : path === '/creator/taxonomy'))
}
export function observeTaxonomyActions(page: Page) {
  const ids = new Map<TaxonomyAction, string>(), counts = new Map<TaxonomyAction, number>()
  const failures: string[] = []
  let unavailableMetadataReads = 0
  const reads = new Set<Promise<void>>()
  const onResponse = (response: Response) => {
    const url = new URL(response.url())
    if (url.origin !== new URL(page.url()).origin || !/^\/_next\/static\/.*\.js$/.test(url.pathname)) return
    const work = response.text().then(script => {
      for (const [name, id] of publicActionReferences(script)) {
        if (ids.has(name) && ids.get(name) !== id) failures.push('AMBIGUOUS_PUBLIC_ACTION_ID')
        ids.set(name, id)
      }
    }).catch(() => { unavailableMetadataReads++ }).finally(() => { reads.delete(work) })
    reads.add(work)
  }
  page.on('response', onResponse)
  page.on('request', request => { for (const name of names) if (isTaxonomyAction(request, ids, [name])) counts.set(name, (counts.get(name) ?? 0) + 1) })
  return {
    ids,
    count: (...actions: TaxonomyAction[]) => actions.reduce((sum, name) => sum + (counts.get(name) ?? 0), 0),
    async ready(...actions: TaxonomyAction[]) {
      // An aborted, unrelated public chunk during navigation cannot invalidate
      // identities already found. Missing required exports still fail closed.
      await expect.poll(() => {
        const missing = actions.filter(name => !ids.has(name))
        return { missing, unavailableMetadataReads: missing.length ? unavailableMetadataReads : 0 }
      }).toEqual({ missing: [], unavailableMetadataReads: 0 })
      await Promise.all([...reads]); expect(failures).toEqual([])
    },
  }
}
export async function holdTaxonomyResponses(page: Page, ids: ReadonlyMap<TaxonomyAction, string>, actions: readonly TaxonomyAction[], limit = 1) {
  const pending: { release: (drop: boolean) => void }[] = []
  let started = 0, disposed = false
  await page.route('**/creator/**', async route => {
    if (disposed || started >= limit || !isTaxonomyAction(route.request(), ids, actions)) return route.continue()
    started++
    const response = await route.fetch() // Real authenticated request and DB response; never synthetic success.
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
