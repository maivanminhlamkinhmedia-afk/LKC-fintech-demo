import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { smokeStandaloneHttp } from '../scripts/cms-media/smoke-standalone-http.mjs'

const script = fileURLToPath(new URL('../scripts/cms-media/smoke-standalone-http.mjs', import.meta.url))
const html = '<!doctype html><html><head><title>Public fixture</title></head><body>Public</body></html>'
const limits = { startupTimeoutMs: 3000, requestTimeoutMs: 600, totalTimeoutMs: 8000, shutdownTimeoutMs: 200 }
const serving = body => `const http=require('node:http'); const s=http.createServer((req,res)=>{${body}}); s.listen(Number(process.env.PORT),process.env.HOSTNAME);`
const good = `res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); res.end(${JSON.stringify(html)});`

async function fixture(t, source) {
  const directory = await mkdtemp(join(tmpdir(), 'lkc-http-fixture-'))
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })
  await writeFile(join(directory, 'server.js'), source)
  return directory
}

function gone(pid) {
  assert.ok(pid > 0)
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
}

async function portFree(port) {
  const server = net.createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolveListen)
  })
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
}

async function fails(t, source, code, options = {}) {
  const directory = await fixture(t, source)
  let caught
  await assert.rejects(smokeStandaloneHttp(directory, { ...limits, ...options }), error => {
    caught = error
    assert.equal(error.code, code)
    return true
  })
  if (caught.pid) gone(caught.pid)
  if (caught.port) await portFree(caught.port)
  return caught
}

test('real child serves both public routes on loopback; response fingerprints and cleanup', async t => {
  const directory = await fixture(t, serving(`if(!['/','/san-pham'].includes(req.url)) throw Error('unexpected path'); ${good}`))
  const result = await smokeStandaloneHttp(directory, limits)
  assert.equal(result.standaloneHttpSmoke, 'PASS')
  assert.equal(result.host, '127.0.0.1')
  assert.equal(result.platform, process.platform)
  assert.deepEqual(result.pages.map(page => page.path), ['/', '/san-pham'])
  for (const page of result.pages) { assert.equal(page.status, 200); assert.equal(page.bytes, Buffer.byteLength(html)); assert.match(page.sha256, /^[a-f0-9]{64}$/) }
  assert.equal(result.cleanup, 'PASS')
  gone(result.pid)
  await portFree(result.port)
})

test('startup exception fails and reaps the child', async t => {
  const error = await fails(t, "throw new Error('synthetic startup failure')", 'HTTP_SMOKE_STARTUP_FAILED')
  assert.equal(error.exitCode, 1)
})
test('early exit zero cannot masquerade as startup success', t => fails(t, 'process.exit(0)', 'HTTP_SMOKE_STARTUP_FAILED'))
test('startup timeout cleans a child that never binds', t => fails(t, 'setInterval(()=>{},1000)', 'HTTP_SMOKE_STARTUP_TIMEOUT', { startupTimeoutMs: 500 }))

test('occupied port is not mistaken for our server and its owner survives', async t => {
  let contacts = 0
  const owner = net.createServer(socket => { contacts++; socket.end() })
  await new Promise(resolveListen => owner.listen(0, '127.0.0.1', resolveListen))
  const port = owner.address().port
  try {
    const directory = await fixture(t, serving(good))
    await assert.rejects(smokeStandaloneHttp(directory, { ...limits, port }), { code: 'HTTP_SMOKE_PORT_COLLISION' })
    assert.equal(owner.listening, true)
    assert.equal(contacts, 0)
  } finally { await new Promise(resolveClose => owner.close(resolveClose)) }
})

test('absolute request timeout closes a hanging response', t => fails(t, serving(''), 'HTTP_SMOKE_REQUEST_TIMEOUT'))
test('child-side EADDRINUSE after reservation fails and cleans both listeners', t => fails(t, `
  const http=require('node:http');const first=http.createServer(()=>{});
  first.listen(Number(process.env.PORT),process.env.HOSTNAME,()=>http.createServer().listen(Number(process.env.PORT),process.env.HOSTNAME));`, 'HTTP_SMOKE_PORT_COLLISION'))
test('drip response cannot reset the absolute request deadline', t => fails(t, serving("res.writeHead(200,{'content-type':'text/html'});setInterval(()=>res.write(' '),30)"), 'HTTP_SMOKE_REQUEST_TIMEOUT'))
test('overall deadline is independent of startup/request deadlines', t => fails(t, serving(''), 'HTTP_SMOKE_TOTAL_TIMEOUT', { totalTimeoutMs: 700, requestTimeoutMs: 5000 }))

for (const status of [301, 404, 500]) {
  test(`status ${status} fails without following redirects`, t => fails(t, serving(`res.writeHead(${status},{'content-type':'text/html',location:'https://example.invalid/'});res.end(${JSON.stringify(html)})`), 'HTTP_SMOKE_HTTP_INVALID'))
}
test('JSON is not accepted as a public HTML page', t => fails(t, serving("res.writeHead(200,{'content-type':'application/json'});res.end('{}')"), 'HTTP_SMOKE_HTTP_INVALID'))
test('empty or incomplete HTML is rejected', t => fails(t, serving("res.writeHead(200,{'content-type':'text/html'});res.end('<html>')"), 'HTTP_SMOKE_HTTP_INVALID'))
test('malformed HTTP bytes are rejected and cleaned', t => fails(t, "require('node:net').createServer(s=>s.end('NOT HTTP\\r\\n')).listen(Number(process.env.PORT),process.env.HOSTNAME)", 'HTTP_SMOKE_HTTP_INVALID'))
test('truncated response is rejected', t => fails(t, serving("res.writeHead(200,{'content-type':'text/html','content-length':'999'});res.flushHeaders();res.write('short');setTimeout(()=>res.destroy(),30)"), 'HTTP_SMOKE_HTTP_INVALID'))
test('response memory is bounded', t => fails(t, serving("res.writeHead(200,{'content-type':'text/html'});res.end('x'.repeat(2*1024*1024+1))"), 'HTTP_SMOKE_BODY_TOO_LARGE'))
test('process crash after startup fails even after the first route passed', t => fails(t, serving(`if(req.url==='/san-pham')process.exit(73);else{${good}}`), 'HTTP_SMOKE_PROCESS_CRASH'))
test('child with SIGTERM handler is reaped (Windows terminate; POSIX kill fallback)', t => fails(t, "process.on('SIGTERM',()=>{});" + serving(''), 'HTTP_SMOKE_REQUEST_TIMEOUT'))

test('child receives dummy config, isolated home and no inherited credentials/proxy/loader', async t => {
  const keys = ['AWS_SECRET_ACCESS_KEY', 'HTTP_PROXY', 'NODE_OPTIONS', 'DATABASE_URL', 'NEXTAUTH_SECRET']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    for (const key of keys) process.env[key] = 'synthetic-parent-sentinel'
    const directory = await fixture(t, `
      if(process.env.AWS_SECRET_ACCESS_KEY||process.env.HTTP_PROXY||process.env.NODE_OPTIONS)throw Error('inherited');
      if(process.env.DATABASE_URL!=='mysql://dummy:dummy@127.0.0.1:9/http_smoke')throw Error('db');
      if(process.env.NEXTAUTH_SECRET!=='http-smoke-dummy-not-production')throw Error('auth');
      if(!process.env.HOME.includes('lkc-http-smoke-'))throw Error('home');
      ${serving(good)}`)
    const result = await smokeStandaloneHttp(directory, limits)
    gone(result.pid)
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key] }
  }
})

test('DB-style outbound TCP is blocked even if application catches the error', async t => {
  let contacts = 0
  const trap = net.createServer(socket => { contacts++; socket.destroy() })
  await new Promise(resolveListen => trap.listen(0, '127.0.0.1', resolveListen))
  try {
    await fails(t, `try{require('node:net').connect({host:'127.0.0.1',port:${trap.address().port}})}catch{};${serving(good)}`, 'HTTP_SMOKE_ISOLATION_BLOCKED')
    assert.equal(contacts, 0)
  } finally { await new Promise(resolveClose => trap.close(resolveClose)) }
})
test('external fetch is blocked before any request', t => fails(t, "try{fetch('https://example.invalid/')}catch{};" + serving(good), 'HTTP_SMOKE_ISOLATION_BLOCKED'))
test('DNS lookup is blocked', t => fails(t, "try{require('node:dns').lookup('example.invalid',()=>{})}catch{};" + serving(good), 'HTTP_SMOKE_ISOLATION_BLOCKED'))
test('descendant subprocess creation is blocked', t => fails(t, "try{require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'])}catch{};" + serving(good), 'HTTP_SMOKE_ISOLATION_BLOCKED'))
test('wildcard listener is blocked', t => fails(t, "require('node:http').createServer().listen(Number(process.env.PORT),'0.0.0.0')", 'HTTP_SMOKE_ISOLATION_BLOCKED'))

test('environment files are rejected before starting server', async t => {
  const directory = await fixture(t, serving(good))
  await writeFile(join(directory, '.env.production'), 'ONLY_SYNTHETIC=1')
  await assert.rejects(smokeStandaloneHttp(directory, limits), { code: 'HTTP_SMOKE_ENV_FILE_PRESENT' })
})
test('ambiguous server entrypoints fail closed', async t => {
  const directory = await fixture(t, serving(good))
  await mkdir(join(directory, 'nested'))
  await writeFile(join(directory, 'nested/server.js'), serving(good))
  await assert.rejects(smokeStandaloneHttp(directory, limits), { code: 'HTTP_SMOKE_ENTRYPOINT_INVALID' })
})

test('CLI interruption reaps its server and frees the port', { timeout: 12000 }, async t => {
  const directory = await fixture(t, `
    const s=require('node:http').createServer(()=>{});
    s.listen(Number(process.env.PORT),process.env.HOSTNAME,()=>require('node:fs').writeFileSync('bound.json',JSON.stringify({pid:process.pid,port:s.address().port,scratch:process.env.HOME})));`)
  const cli = spawn(process.execPath, [script, directory], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const closed = new Promise(resolveClose => cli.once('close', resolveClose))
  let stderr = ''
  cli.stderr.on('data', chunk => { stderr += chunk })
  let bound
  try {
    for (let i = 0; i < 150; i++) {
      try { bound = JSON.parse(await readFile(join(directory, 'bound.json'), 'utf8')); break } catch { await delay(20) }
    }
    assert.ok(bound, 'fixture bound before interruption')
    // Windows kill is uncatchable TerminateProcess; disconnect cleanup remains
    // covered there. POSIX SIGTERM additionally exercises the parent's handler.
    cli.kill('SIGTERM')
    await closed
    for (let i = 0; i < 100; i++) {
      try { process.kill(bound.pid, 0); await delay(20) } catch { break }
    }
    gone(bound.pid)
    await portFree(bound.port)
    if (process.platform !== 'win32') assert.equal(JSON.parse(stderr).code, 'HTTP_SMOKE_INTERRUPTED')
  } finally {
    if (cli.exitCode === null && cli.signalCode === null) cli.kill('SIGKILL')
    await closed
    // TerminateProcess/SIGKILL cannot run the parent's finally block. The test
    // owns this scratch path and removes it only after confirming child exit.
    if (bound?.scratch) {
      gone(bound.pid)
      assert.equal(dirname(resolve(bound.scratch)), resolve(tmpdir()))
      assert.ok(bound.scratch.startsWith(join(tmpdir(), 'lkc-http-smoke-')))
      await rm(bound.scratch, { recursive: true, force: true })
    }
  }
})
