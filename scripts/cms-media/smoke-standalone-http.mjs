import net from 'node:net'
import http from 'node:http'
import tls from 'node:tls'
import dns from 'node:dns'
import dgram from 'node:dgram'
import childProcess from 'node:child_process'
import workerThreads from 'node:worker_threads'
import { syncBuiltinESMExports } from 'node:module'
import { createHash } from 'node:crypto'
import { readdir, lstat, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const self = fileURLToPath(import.meta.url)
const host = '127.0.0.1'
const maxBytes = 2 * 1024 * 1024
const fault = (code, details = {}) => Object.assign(new Error(code), { code, ...details })

// Preloaded only in the owned child, before server.js. This is a guard for a
// trusted build, NOT a security sandbox for hostile JS/native addons. It blocks
// ordinary Node egress, DNS, subprocesses and workers; no DB/API is exercised.
function installChildGuard() {
  const send = message => { if (process.connected) process.send(message) }
  const blocked = () => {
    send({ type: 'blocked' })
    throw fault('HTTP_SMOKE_ISOLATION_BLOCKED')
  }
  net.Socket.prototype.connect = blocked
  tls.connect = blocked
  dgram.createSocket = blocked
  for (const api of [dns, dns.promises]) {
    const lookup = api.lookup
    for (const key of Object.keys(api)) {
      if (/^(lookup|resolve|reverse)/.test(key) && typeof api[key] === 'function') api[key] = blocked
    }
    // net.Server.listen calls lookup even for a literal IPv4 address. Node
    // resolves this literal without DNS traffic; every other lookup is denied.
    api.lookup = (name, ...args) => name === host ? lookup.call(api, name, ...args) : blocked()
    api.Resolver = class { constructor() { blocked() } }
  }
  for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = blocked
  workerThreads.Worker = class { constructor() { blocked() } }
  globalThis.fetch = blocked
  const listen = net.Server.prototype.listen
  net.Server.prototype.listen = function (...args) {
    const options = args[0]
    const port = Number(typeof options === 'object' ? options.port : options)
    const address = typeof options === 'object' ? options.host : args[1]
    if (address !== host || port !== Number(process.env.PORT)) return blocked()
    this.once('error', error => send({ type: 'listen-error', code: error.code }))
    this.once('listening', () => {
      const bound = this.address()
      if (bound?.address !== host || bound?.port !== port) return blocked()
      send({ type: 'bound', port, pid: process.pid })
    })
    return listen.apply(this, args)
  }
  process.once('disconnect', () => process.exit(1))
  syncBuiltinESMExports()
}

function bounded(value, fallback, maximum) {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < 1 || result > maximum) throw fault('HTTP_SMOKE_OPTION_INVALID')
  return result
}

async function entrypoint(bundle) {
  const found = []
  let visited = 0
  async function walk(directory, depth) {
    if (depth > 12 || ++visited > 10000) throw fault('HTTP_SMOKE_BUNDLE_INVALID')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.env' || entry.name.startsWith('.env.')) throw fault('HTTP_SMOKE_ENV_FILE_PRESENT')
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory() && !['node_modules', '.git', '.next', 'public'].includes(entry.name)) await walk(join(directory, entry.name), depth + 1)
      if (entry.isFile() && entry.name === 'server.js') found.push(join(directory, entry.name))
    }
  }
  if (!(await lstat(bundle)).isDirectory()) throw fault('HTTP_SMOKE_BUNDLE_INVALID')
  await walk(bundle, 0)
  if (found.length !== 1) throw fault('HTTP_SMOKE_ENTRYPOINT_INVALID')
  return found[0]
}

function reservePort(port) {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.once('error', error => reject(fault(error.code === 'EADDRINUSE' ? 'HTTP_SMOKE_PORT_COLLISION' : 'HTTP_SMOKE_BIND_FAILED')))
    server.listen({ host, port, exclusive: true }, () => {
      const selected = server.address().port
      server.close(error => error ? reject(error) : resolvePort(selected))
    })
  })
}

function isolatedEnv(scratch, port) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (['SYSTEMROOT', 'WINDIR', 'COMSPEC'].includes(key.toUpperCase())) env[key] = value
  }
  return { ...env, NODE_ENV: 'production', HOSTNAME: host, PORT: String(port),
    HOME: scratch, USERPROFILE: scratch, APPDATA: scratch, LOCALAPPDATA: scratch, TEMP: scratch, TMP: scratch,
    NEXT_TELEMETRY_DISABLED: '1', NODE_DISABLE_COMPILE_CACHE: '1',
    DATABASE_URL: 'mysql://dummy:dummy@127.0.0.1:9/http_smoke',
    NEXTAUTH_URL: `http://${host}:${port}`, NEXTAUTH_SECRET: 'http-smoke-dummy-not-production',
    GOOGLE_SHEET_ID: '', GOOGLE_SHEET_NEWS_TAB: 'News', GOOGLE_SHEET_VIDEOS_TAB: 'Videos',
    LKC_HTTP_SMOKE_CHILD: '1' }
}

function waitFor(promise, signal) {
  return new Promise((resolveWait, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolveWait, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function requestPage(port, path, timeoutMs, signal) {
  return new Promise((resolvePage, reject) => {
    const request = http.get({ hostname: host, port, path, agent: false, signal,
      headers: { Accept: 'text/html', 'Accept-Encoding': 'identity', Connection: 'close' } })
    const timer = setTimeout(() => request.destroy(fault('HTTP_SMOKE_REQUEST_TIMEOUT')), timeoutMs)
    let settled = false
    function finish(error, result) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) { request.destroy(); reject(error) } else resolvePage(result)
    }
    request.on('error', error => finish(signal.aborted ? signal.reason : fault(error.code === 'HTTP_SMOKE_REQUEST_TIMEOUT' ? error.code : 'HTTP_SMOKE_HTTP_INVALID')))
    request.once('response', response => {
      const contentType = response.headers['content-type'] ?? ''
      if (response.statusCode !== 200 || !/^text\/html(?:;|$)/i.test(contentType)) {
        response.destroy()
        return finish(fault('HTTP_SMOKE_HTTP_INVALID', { path, status: response.statusCode }))
      }
      const chunks = []
      let bytes = 0
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > maxBytes) { response.destroy(); finish(fault('HTTP_SMOKE_BODY_TOO_LARGE')); return }
        chunks.push(chunk)
      })
      response.on('error', () => finish(fault('HTTP_SMOKE_HTTP_INVALID')))
      response.on('end', () => {
        const body = Buffer.concat(chunks)
        const html = body.toString('utf8')
        if (!response.complete || !/^\s*<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html)
          || !/<body[\s>]/i.test(html) || !/<\/html>\s*$/i.test(html)) return finish(fault('HTTP_SMOKE_HTTP_INVALID'))
        finish(null, { path, status: response.statusCode, contentType, bytes, sha256: createHash('sha256').update(body).digest('hex') })
      })
    })
  })
}

async function closesWithin(closed, milliseconds) {
  let timer
  try { return await Promise.race([closed.then(() => true), new Promise(resolveTimer => { timer = setTimeout(() => resolveTimer(false), milliseconds) })]) }
  finally { clearTimeout(timer) }
}

export async function smokeStandaloneHttp(bundlePath, options = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 18)) throw fault('HTTP_SMOKE_NODE_MINIMUM_22_18')
  if (typeof bundlePath !== 'string' || !bundlePath) throw fault('HTTP_SMOKE_BUNDLE_REQUIRED')
  const startupMs = bounded(options.startupTimeoutMs, 15000, 120000)
  const requestMs = bounded(options.requestTimeoutMs, 5000, 120000)
  const totalMs = bounded(options.totalTimeoutMs, 30000, 180000)
  const shutdownMs = bounded(options.shutdownTimeoutMs, 2000, 10000)
  const requestedPort = options.port ?? 0
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw fault('HTTP_SMOKE_OPTION_INVALID')
  const server = await entrypoint(resolve(bundlePath))
  const port = await reservePort(requestedPort)
  const scratch = await mkdtemp(join(tmpdir(), 'lkc-http-smoke-'))
  const controller = new AbortController()
  const abort = code => controller.abort(fault(code))
  const interrupt = () => abort('HTTP_SMOKE_INTERRUPTED')
  let child, closed, startupTimer, totalTimer, result, failure
  let stdout = '', stderr = ''
  try {
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', interrupt)
    totalTimer = setTimeout(() => abort('HTTP_SMOKE_TOTAL_TIMEOUT'), totalMs)
    // Explicit preload cannot be replaced by inherited NODE_OPTIONS. The child
    // cannot spawn descendants through ordinary Node APIs; disconnect also exits it.
    child = childProcess.spawn(process.execPath, ['--import', pathToFileURL(self).href, server], {
      cwd: dirname(server), env: isolatedEnv(scratch, port), windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], shell: false,
    })
    closed = new Promise(resolveClosed => child.once('close', resolveClosed))
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-8192) })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192) })
    child.once('error', () => abort('HTTP_SMOKE_STARTUP_FAILED'))
    let bound = false
    child.once('exit', (exitCode, signal) => controller.abort(fault(bound ? 'HTTP_SMOKE_PROCESS_CRASH' : 'HTTP_SMOKE_STARTUP_FAILED', { exitCode, signal })))
    const ready = new Promise(resolveReady => {
      child.on('message', message => {
        if (message?.type === 'blocked') abort('HTTP_SMOKE_ISOLATION_BLOCKED')
        if (message?.type === 'listen-error') abort(message.code === 'EADDRINUSE' ? 'HTTP_SMOKE_PORT_COLLISION' : 'HTTP_SMOKE_STARTUP_FAILED')
        if (message?.type === 'bound' && message.port === port && message.pid === child.pid) { bound = true; resolveReady() }
      })
    })
    startupTimer = setTimeout(() => abort('HTTP_SMOKE_STARTUP_TIMEOUT'), startupMs)
    await waitFor(ready, controller.signal)
    clearTimeout(startupTimer)
    const pages = []
    for (const path of ['/', '/san-pham']) pages.push(await waitFor(requestPage(port, path, requestMs, controller.signal), controller.signal))
    if (controller.signal.aborted) throw controller.signal.reason
    result = { standaloneHttpSmoke: 'PASS', platform: process.platform, node: process.version, host, port, pid: child.pid, pages }
  } catch (error) {
    // A socket reset can arrive just before the process exit event. Give the
    // owned child a bounded chance to report its exit before classifying it.
    if (error.code === 'HTTP_SMOKE_HTTP_INVALID' && closed) await closesWithin(closed, 100)
    failure = controller.signal.reason?.code === 'HTTP_SMOKE_PROCESS_CRASH' ? controller.signal.reason : error
  }
  finally {
    clearTimeout(startupTimer)
    clearTimeout(totalTimer)
    if (child && closed) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      if (!await closesWithin(closed, shutdownMs)) {
        child.kill('SIGKILL')
        if (!await closesWithin(closed, shutdownMs)) failure = fault('HTTP_SMOKE_CLEANUP_FAILED')
      }
    }
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    if (dirname(resolve(scratch)) !== resolve(tmpdir()) || !resolve(scratch).startsWith(resolve(tmpdir()) + sep)) throw fault('HTTP_SMOKE_SCRATCH_INVALID')
    await rm(scratch, { recursive: true, force: true })
  }
  if (failure) throw Object.assign(failure, { pid: child?.pid, port, stdout, stderr })
  return { ...result, cleanup: 'PASS' }
}

if (process.env.LKC_HTTP_SMOKE_CHILD === '1' && process.send) installChildGuard()
else if (process.argv[1] && resolve(process.argv[1]) === self) {
  try {
    if (process.argv.length !== 3) throw fault('HTTP_SMOKE_USAGE: node smoke-standalone-http.mjs <standalone-directory>')
    console.log(JSON.stringify(await smokeStandaloneHttp(process.argv[2])))
  } catch (error) {
    console.error(JSON.stringify({ standaloneHttpSmoke: 'FAIL', code: error.code ?? 'HTTP_SMOKE_FAILED', pid: error.pid, port: error.port, exitCode: error.exitCode }))
    process.exitCode = 1
  }
}
