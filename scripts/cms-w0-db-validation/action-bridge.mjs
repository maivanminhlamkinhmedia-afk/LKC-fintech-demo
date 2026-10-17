import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { check, safePath } from './evidence.mjs';
import { assertRuntimePermit } from './run.mjs';

// Bounded test coordination, NOT a mutation retry mechanism.
export function createBarrier(parties, timeoutMs = 4000) {
  check(Number.isInteger(parties) && parties >= 1 && parties <= 3
    && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10000, 'W0_BARRIER_REFUSED');
  let arrivals = 0, done = false, timer;
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  promise.catch(() => {});
  return Object.freeze({
    arrive() {
      check(!done && arrivals < parties, 'W0_BARRIER_REFUSED');
      if (!timer) timer = setTimeout(() => { done = true; reject(new Error('W0_TIMEOUT')); }, timeoutMs);
      if (++arrivals === parties) { done = true; clearTimeout(timer); resolve(); }
      return promise;
    },
    cancel() { if (!done) { done = true; clearTimeout(timer); reject(new Error('W0_BARRIER_CANCELLED')); } },
  });
}

/** Framework/session seam only. All model operations forward to real Prisma.
 * Importing this module neither loads the application nor connects to a DB.
 * A caller-created object cannot satisfy the runner's private permit WeakSet.
 */
export async function installActionBridge({ permit, sourceRoot }) {
  assertRuntimePermit(permit);
  const root = pathToFileURL(sourceRoot.replaceAll('\\', '/') + '/src/');
  const require = createRequire(join(sourceRoot, 'package.json'));
  const ts = require('typescript');
  const context = new AsyncLocalStorage();
  const key = Symbol.for('cms-w0-real-db-action-bridge');
  check(!globalThis[key], 'W0_BRIDGE_COLLISION');
  const ctx = () => { const s = context.getStore(); check(s, 'W0_BRIDGE_CONTEXT_MISSING'); return s; };
  let hasPermission;
  const adapter = {
    authOptions: Object.freeze({ syntheticSessionBoundary: true }),
    async getServerSession() { return structuredClone(ctx().session); },
    async requirePermission(permission) {
      const s = ctx();
      if (!s.session?.user?.id || !hasPermission(s.session.user.role, permission)) throw new Error('W0_SESSION_DENIED');
      return structuredClone(s.session);
    },
    revalidatePath() { ctx().observations.revalidations++; },
    prisma: new Proxy({}, { get(_t, name) {
      const s = ctx();
      if (name !== '$transaction') {
        const value = s.client[name]; return typeof value === 'function' ? value.bind(s.client) : value;
      }
      return async (callback, options) => {
        check(options?.isolationLevel === 'Serializable', 'W0_ISOLATION_NOT_REQUESTED');
        s.observations.transactions++;
        let returned = false;
        try {
          const result = await s.client.$transaction(async tx => {
            const rows = await tx.$queryRawUnsafe('SELECT CONNECTION_ID() AS id');
            const connectionId = Number(rows[0].id);
            check(Number.isSafeInteger(connectionId) && connectionId > 0, 'W0_CONNECTION_ID_INVALID');
            s.observations.connectionIds.push(connectionId);
            const instrumented = new Proxy(tx, { get(t, k) {
              if (k !== 'article') { const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; }
              return new Proxy(t.article, { get(model, method) {
                const f = model[method]; if (typeof f !== 'function') return f;
                return async (...args) => {
                  const value = await f.apply(model, args);
                  if (['create', 'updateMany'].includes(method)) s.observations.writes++;
                  if (method === 'findFirst' && args[0]?.select?.contentJson && value) {
                    if (s.inspectTransaction) await s.inspectTransaction(connectionId);
                    if (s.barrier) await s.barrier.arrive();
                  }
                  return value;
                };
              } });
            } });
            const value = await callback(instrumented);
            if (s.fault === 'ROLLBACK') throw new Error('W0_INJECTED_PRECOMMIT_FAILURE');
            return value;
          }, { ...options, maxWait: 10000, timeout: 15000 });
          returned = true; s.observations.commits++;
          if (s.fault === 'LOST_ACK') { s.observations.lostAck++; throw new Error('W0_INJECTED_LOST_ACK'); }
          return result;
        } catch (error) {
          if (!returned) s.observations.failedTransactions++;
          // Error code only, never the DB error message, SQL, meta or stack.
          const code = Object.getOwnPropertyDescriptor(error ?? {}, 'code')?.value;
          if (['P2034', 'P2028'].includes(code)) s.observations.conflicts.push(code);
          throw error;
        }
      };
    } }),
  };
  globalThis[key] = adapter;
  const data = code => `data:text/javascript,${encodeURIComponent(`const a=globalThis[Symbol.for('cms-w0-real-db-action-bridge')];${code}`)}`;
  const replacements = new Map([
    ['@/lib/prisma', data('export const prisma=a.prisma;')],
    ['@/lib/auth', data('export const authOptions=a.authOptions;')],
    ['@/lib/authz', data('export const requirePermission=a.requirePermission;')],
    ['next-auth', data('export const getServerSession=a.getServerSession;')],
    ['next/cache', data('export const revalidatePath=a.revalidatePath;')],
    ['server-only', 'data:text/javascript,export {};'],
  ]);
  const hook = registerHooks({
    resolve(specifier, c, next) {
      if (c.parentURL?.startsWith(root.href)) {
        if (replacements.has(specifier)) return next(replacements.get(specifier), c);
        if (specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`, root).href, c);
        if (specifier.startsWith('./') && !/\.[cm]?[jt]s$/.test(specifier)) return next(new URL(`${specifier}.ts`, c.parentURL).href, c);
      }
      return next(specifier, c);
    },
    load(url, c, next) {
      if (url.startsWith(root.href) && url.endsWith('.ts')) {
        const rel = 'src/' + fileURLToPath(url).slice(fileURLToPath(root).length).replaceAll('\\', '/');
        const bytes = readFileSync(safePath(sourceRoot, rel), 'utf8');
        const result = ts.transpileModule(bytes, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
        return { format: 'module', source: result.outputText, shortCircuit: true };
      }
      return next(url, c);
    },
  });
  try {
    ({ hasPermission } = await import(new URL('lib/roles.ts', root)));
    const actions = await import(new URL('features/cms/article-draft-actions.ts', root));
    const queries = await import(new URL('features/cms/article-draft-query.ts', root));
    return Object.freeze({
      async invoke(client, session, operation, args, controls = {}) {
        assertRuntimePermit(permit);
        check(['createArticleDraft', 'updateArticleDraft', 'getArticleDraftForEdit'].includes(operation), 'W0_BRIDGE_OPERATION_REFUSED');
        check(Object.keys(controls).every(k => ['fault', 'barrier', 'inspectTransaction'].includes(k))
          && [undefined, 'ROLLBACK', 'LOST_ACK'].includes(controls.fault), 'W0_BRIDGE_CONTROL_REFUSED');
        const observations = { transactions: 0, writes: 0, commits: 0, failedTransactions: 0, lostAck: 0, revalidations: 0, connectionIds: [], conflicts: [] };
        const s = { client, session: structuredClone(session), observations, ...controls };
        const fn = actions[operation] ?? queries[operation];
        const result = await context.run(s, () => fn(...args));
        return { result, observations };
      },
      close() { hook.deregister(); delete globalThis[key]; },
    });
  } catch (error) { hook.deregister(); delete globalThis[key]; throw error; }
}
