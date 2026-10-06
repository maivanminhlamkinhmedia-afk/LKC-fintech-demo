import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, writeFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { registerHooks } from 'node:module'

// Real media-storage and real Windows files. Only one named filesystem call at
// a time is fault-injected; these synthetic errors do not identify staging's errno.
const repo = process.cwd(), scratch = path.join(repo, '.next', 'cms009-local')
await mkdir(scratch, { recursive: true })
const proxyPath = path.join(scratch, 'journal-fs-proxy.mjs')
await writeFile(proxyPath, `
import * as fs from 'node:fs/promises';
const state=()=>globalThis[Symbol.for('cms-media-journal-fault')];
const error=code=>Object.assign(new Error('synthetic filesystem fault'),{code});
export const mkdir=fs.mkdir,readFile=fs.readFile,readdir=fs.readdir,realpath=fs.realpath,lstat=fs.lstat,unlink=fs.unlink,link=fs.link,rmdir=fs.rmdir;
export async function open(file,...args){
  const journal=file.endsWith('.journal'), s=state();
  if(journal&&s?.phase==='open')throw error('EACCES');
  const handle=await fs.open(file,...args);
  if(!journal)return handle;
  return new Proxy(handle,{get(target,key){
    if(key==='writeFile')return async(...values)=>{if(s?.phase==='write')throw error('EIO');return target.writeFile(...values)};
    if(key==='sync')return async()=>{if(s?.phase==='sync')throw error('EIO');return target.sync()};
    if(key==='close')return async()=>{await target.close();if(s?.phase==='close')throw error('EIO')};
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
}
export async function rename(source,target){
  const s=state();
  if(source.endsWith('.journal')&&s?.phase==='rename')throw error('EPERM');
  try{return await fs.rename(source,target)}
  catch(failure){
    if(failure?.code==='EPERM'&&s?.phase?.startsWith('held-')){
      s.renameFailures++;
      if(s.phase==='held-transient')await s.release();
    }
    throw failure;
  }
};
`)
const sourceRoot = new URL('../../src/features/cms/', import.meta.url)
const proxyUrl = new URL('../../.next/cms009-local/journal-fs-proxy.mjs', import.meta.url)
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return next('data:text/javascript,export {};', context)
  if (specifier === 'node:fs/promises' && context.parentURL?.endsWith('/media-storage.ts')) return next(proxyUrl.href, context)
  if (context.parentURL?.startsWith(sourceRoot.href) && specifier.startsWith('./') && !specifier.endsWith('.ts')) {
    return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return next(specifier, context)
} })
const storage = await import('../../src/features/cms/media-storage.ts')
const priorRoot = process.env.CMS_MEDIA_ROOT, priorMode = process.env.CMS_MEDIA_ROOT_MODE
const rows = []
try {
  for (const phase of ['normal', 'open', 'write', 'sync', 'close', 'rename',
    'held-transient', 'held-persistent', 'existing-temp', 'concurrent-lock']) {
    const rootPath = path.join(scratch, randomBytes(12).toString('hex'))
    process.env.CMS_MEDIA_ROOT = rootPath; process.env.CMS_MEDIA_ROOT_MODE = 'local'
    const root = await storage.provisionMediaRoot(rootPath)
    const id = randomBytes(16).toString('hex')
    const operation = { version: 1, kind: 'upload', id, assetId: randomBytes(16).toString('hex'), actorId: 'synthetic-creator',
      key: `${randomBytes(16).toString('hex')}.png`, rootIdentity: root.identity, startedAt: new Date().toISOString(),
      stage: 'intent', metadata: { originalFilename: 'synthetic.png', altText: 'Synthetic', caption: null, mimeType: 'image/png' },
      digest: null, size: null, width: null, height: null }
    await storage.createMediaOperation(root, operation)
    const temp = path.join(rootPath, 'tmp', `${id}.journal`)
    if (phase === 'existing-temp') await writeFile(temp, 'synthetic previous attempt')
    operation.stage = 'dispatched'
    const held = phase.startsWith('held-')
      ? await open(path.join(rootPath, 'operations', `${id}.json`), 'r') : null
    let released = false
    const state = { phase, renameFailures: 0, release: async () => {
      if (!released) { released = true; await held?.close() }
    } }
    globalThis[Symbol.for('cms-media-journal-fault')] = state
    const diagnostics = [], originalError = console.error
    console.error = (...args) => { diagnostics.push(args.join(' ')) }
    let code = 'NONE'
    try {
      if (phase === 'concurrent-lock') {
        let release, entered
        const hold = new Promise(resolve => { release = resolve })
        const started = new Promise(resolve => { entered = resolve })
        const first = storage.withMediaLock(root, 'operation', id, async () => {
          entered(); await hold; await storage.advanceMediaOperation(root, operation)
        })
        await started
        await assert.rejects(() => storage.withMediaLock(root, 'operation', id, async () => {}),
          error => error.code === 'MEDIA_BUSY')
        code = 'MEDIA_BUSY'; release(); await first
      } else await storage.advanceMediaOperation(root, operation)
    }
    catch (error) { code = ['EACCES', 'EEXIST', 'EIO', 'EPERM'].includes(error?.code) ? error.code : 'OTHER' }
    finally {
      await state.release(); console.error = originalError
      delete globalThis[Symbol.for('cms-media-journal-fault')]
    }
    const receipt = JSON.parse(await readFile(path.join(rootPath, 'operations', `${id}.json`), 'utf8'))
    let tempPresent = false
    try { tempPresent = (await lstat(temp)).isFile() } catch (error) { if (error?.code !== 'ENOENT') throw error }
    const loggedPhase = phase === 'existing-temp' ? 'open'
      : phase.startsWith('held-') ? 'rename' : phase
    assert.deepEqual(diagnostics, ['normal', 'held-transient', 'concurrent-lock'].includes(phase) ? []
      : [`CMS_MEDIA_JOURNAL_ADVANCE_FAILED phase=${loggedPhase} errno=${code}`])
    if (phase.startsWith('held-') && process.platform === 'win32') {
      assert.equal(state.renameFailures, phase === 'held-transient' ? 1 : 3)
    }
    rows.push({ phase, code, journalStage: receipt.stage, tempPresent,
      renameFailures: state.renameFailures })
  }
  assert.deepEqual(rows.map(row => [row.phase, row.journalStage, row.tempPresent]), [
    ['normal', 'dispatched', false], ['open', 'intent', false], ['write', 'intent', true],
    ['sync', 'intent', true], ['close', 'intent', true], ['rename', 'intent', true],
    ['held-transient', 'dispatched', false], ['held-persistent', 'intent', true],
    ['existing-temp', 'intent', true], ['concurrent-lock', 'dispatched', false],
  ])
  console.log(JSON.stringify({ result: 'PASS', node: process.version, cases: rows }))
} finally {
  delete globalThis[Symbol.for('cms-media-journal-fault')]
  if (priorRoot === undefined) delete process.env.CMS_MEDIA_ROOT; else process.env.CMS_MEDIA_ROOT = priorRoot
  if (priorMode === undefined) delete process.env.CMS_MEDIA_ROOT_MODE; else process.env.CMS_MEDIA_ROOT_MODE = priorMode
  hooks.deregister()
}
