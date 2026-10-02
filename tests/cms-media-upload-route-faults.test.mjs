import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { registerHooks } from 'node:module'

const id = 'a'.repeat(32), assetId = 'b'.repeat(32), key = `${'c'.repeat(32)}.png`
const actor = { id: 'fixture-creator', role: 'CREATOR', status: 'ACTIVE' }
let state
const clone = value => structuredClone(value)
function scenario(fail = null) {
  state = { fail, transactionCount: 0, root: { path: 'synthetic', identity: 'd'.repeat(32) }, row: null, objectPresent: false,
    operation: { version: 1, kind: 'upload', id, assetId, actorId: actor.id, key,
      rootIdentity: 'd'.repeat(32), startedAt: new Date().toISOString(), stage: 'intent',
      metadata: { originalFilename: 'synthetic.png', altText: 'Synthetic', caption: null, mimeType: 'image/png' },
      digest: null, size: null, width: null, height: null } }
}
const adapter = {
  actor,
  prisma: {
    mediaAsset: { async findUnique() { if (state.fail === 'read') throw Error('synthetic read failure'); return clone(state.row) } },
    async $transaction(work) {
      state.transactionCount++
      if (state.fail === 'actorTransaction' && state.transactionCount === 1
        || state.fail === 'transaction' && state.transactionCount === 2) throw Error('synthetic transaction failure')
      return work({
        user: { async findUnique() { return clone(actor) } },
        mediaAsset: { async create({ data }) { state.row = { ...clone(data), createdAt: new Date(), updatedAt: new Date() }; return clone(state.row) } },
      })
    },
  },
  async openMediaRoot() { if (state.fail === 'storage') throw new adapter.MediaError('MEDIA_STORAGE_UNAVAILABLE'); return state.root },
  async readMediaOperation() { return clone(state.operation) },
  async withMediaLock(_root, _kind, _id, work) {
    if (state.fail === 'busy') throw new adapter.MediaError('MEDIA_BUSY')
    return work()
  },
  async advanceMediaOperation(_root, operation) {
    if (state.fail === 'dispatchJournal' && operation.stage === 'dispatched'
      || state.fail === 'fileJournal' && operation.stage === 'file-ready'
      || state.fail === 'afterDbAck' && operation.stage === 'committed') throw Error('synthetic journal failure')
    state.operation = clone(operation)
  },
  async writeCanonicalFile(_root, _key, bytes) { state.objectPresent = true; return { size: bytes.length } },
  async canonicalizeImage() {
    if (state.fail === 'codec') throw Error('synthetic codec setup failure')
    return { bytes: Buffer.from('canonical'), width: 1, height: 1, mimeType: 'image/png' }
  },
}
globalThis[Symbol.for('cms-media-route-faults')] = adapter
const data = code => `data:text/javascript,${encodeURIComponent(`const a=globalThis[Symbol.for('cms-media-route-faults')];${code}`)}`
const root = new URL('../src/', import.meta.url)
const replacements = new Map([
  ['server-only', 'data:text/javascript,export {};'],
  ['next-auth', data('export const getServerSession=async()=>({user:a.actor});')],
  ['@/lib/auth', data('export const authOptions={};')],
  ['@/lib/prisma', data('export const prisma=a.prisma;')],
  ['./access', data('export const canAccessCms=()=>true;')],
  ['./media-store', data('export const freshMediaActor=async()=>a.actor;export const mediaDTO=row=>row;')],
  ['@/features/cms/media-store', data('export const mediaDTO=row=>row;')],
  ['@/features/cms/media-storage', data(`
    export const openMediaRoot=(...x)=>a.openMediaRoot(...x);
    export const readMediaOperation=(...x)=>a.readMediaOperation(...x);
    export const withMediaLock=(...x)=>a.withMediaLock(...x);
    export const advanceMediaOperation=(...x)=>a.advanceMediaOperation(...x);
    export const writeCanonicalFile=(...x)=>a.writeCanonicalFile(...x);
  `)],
  ['@/features/cms/media-codec', data('export const canonicalizeImage=(...x)=>a.canonicalizeImage(...x);')],
])
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (replacements.has(specifier)) return next(replacements.get(specifier), context)
  if (specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`, root).href, context)
  if (context.parentURL?.startsWith(root.href) && specifier.startsWith('./') && !specifier.endsWith('.ts')) {
    return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return next(specifier, context)
} })
let route
try {
  const contract = await import('../src/features/cms/media-contract.ts')
  adapter.MediaError = contract.MediaError
  route = await import('../src/app/api/cms/media/uploads/[operationId]/route.ts')
} finally { hooks.deregister() }
after(() => { delete globalThis[Symbol.for('cms-media-route-faults')] })

const context = { params: Promise.resolve({ operationId: id }) }
async function post() {
  const response = await route.POST(new Request(`http://127.0.0.1:3001/api/cms/media/uploads/${id}`, {
    method: 'POST', headers: { origin: 'http://127.0.0.1:3001', 'content-type': 'image/png' },
    body: Buffer.from('synthetic image'), duplex: 'half',
  }), context)
  return { status: response.status, body: await response.json() }
}

test('actual upload route maps faults to safe codes at distinct durable boundaries', async () => {
  for (const [fault, status, code, stage, rowPresent, objectPresent] of [
    ['read', 500, 'INTERNAL_ERROR', 'intent', false, false],
    ['actorTransaction', 500, 'INTERNAL_ERROR', 'intent', false, false],
    ['dispatchJournal', 500, 'INTERNAL_ERROR', 'intent', false, false],
    ['codec', 500, 'INTERNAL_ERROR', 'dispatched', false, false],
    ['fileJournal', 500, 'INTERNAL_ERROR', 'canonical-ready', false, true],
    ['afterDbAck', 500, 'INTERNAL_ERROR', 'file-ready', true, true],
    ['transaction', 500, 'UNKNOWN_OUTCOME', 'file-ready', false, true],
    ['busy', 409, 'MEDIA_BUSY', 'intent', false, false],
    ['storage', 503, 'MEDIA_STORAGE_UNAVAILABLE', 'intent', false, false],
  ]) {
    scenario(fault)
    const result = await post()
    assert.equal(result.status, status, fault)
    assert.equal(result.body.ok, false, fault)
    assert.equal(result.body.error.code, code, fault)
    assert.equal(state.operation.stage, stage, fault)
    assert.equal(!!state.row, rowPresent, fault)
    assert.equal(state.objectPresent, objectPresent, fault)
    if (fault === 'afterDbAck') {
      state.fail = null
      const receipt = await route.GET(new Request(`http://127.0.0.1:3001/api/cms/media/uploads/${id}`), context)
      assert.equal(receipt.status, 200)
      assert.equal((await receipt.json()).state, 'COMMITTED')
    }
  }
})
