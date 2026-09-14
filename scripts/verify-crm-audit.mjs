import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

// Explicit opt-in, isolated loopback development/test fixtures. Never repair history.
const base = new URL(process.env.CRM_VERIFY_BASE_URL || 'http://127.0.0.1:3107');
const databaseUrl = new URL(process.env.DATABASE_URL);
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
const loopback = ['localhost', '127.0.0.1', '[::1]'];
if (process.env.CRM_VERIFY_FIXTURES !== '1' || !loopback.includes(base.hostname)
  || !loopback.includes(databaseUrl.hostname) || !['http:', 'https:'].includes(base.protocol)
  || databaseUrl.protocol !== 'mysql:' || !/(?:^|_)(?:dev|test)(?:_|$)/i.test(databaseName)
  || /(?:^|_)(?:prod|production)(?:_|$)/i.test(databaseName)) {
  throw new Error('Set CRM_VERIFY_FIXTURES=1 and use a loopback app/MySQL development or test database.');
}
const prisma = new PrismaClient({ adapter: new PrismaMariaDb({
  host: databaseUrl.hostname, port: Number(databaseUrl.port || 3306),
  user: decodeURIComponent(databaseUrl.username), password: decodeURIComponent(databaseUrl.password),
  database: databaseName, connectionLimit: 5, allowPublicKeyRetrieval: true,
}) });
const marker = `crm015-${randomUUID()}`; const password = randomUUID();
const users = {}; const sessions = {}; const userIds = []; const auditIds = new Set();
const customerIds = []; const teamIds = []; const taskIds = [];
const fixtures = new Map(); const validFixtures = new Map();
const day = 86_400_000; const offset = 7 * 3_600_000;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const frozen = { period: 'custom', from: '2024-02-28', to: '2024-03-01' };
const poison = `${marker}-PRIVATE-PAYLOAD`;
const poisonKeys = ['password', 'passwordHash', 'token', 'session', 'secret', 'content', 'note', 'query', 'csv', 'unknownField', 'confirmationToken', 'NEXTAUTH_SECRET', 'description', 'title', 'name', 'previousName', 'newName'];
let baseline; let passwordHash; let assertions = 0;
function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  assertions += 1; console.log(`PASS: ${label}`);
}
async function snapshot() {
  const rows = await Promise.all(['customerProfile', 'customerTask', 'customerActivity', 'salesTeam', 'salesTeamMember', 'user', 'auditLog']
    .map((model) => prisma[model].findMany({ orderBy: { id: 'asc' } })));
  // Secrets stay only in memory and are hashed, never printed or rendered.
  return hash(rows);
}
function cookies(response, previous = '') {
  const jar = new Map(previous.split('; ').filter(Boolean).map((entry) => {
    const index = entry.indexOf('='); return [entry.slice(0, index), entry.slice(index + 1)];
  }));
  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';')[0]; const index = pair.indexOf('='); jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
}
async function request(cookie, path) {
  const response = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { cookie, origin: base.origin } });
  return { status: response.status, location: response.headers.get('location'), html: await response.text() };
}
async function read(actor, path, label) {
  const before = await snapshot(); const response = await request(sessions[actor] ?? '', path);
  check(before === await snapshot(), `${label}: GET changes no business/user/audit row`);
  return response;
}
async function login(user) {
  try {
    const csrf = await fetch(new URL('/api/auth/csrf', base), { signal: AbortSignal.timeout(30000) });
    let cookie = cookies(csrf); const { csrfToken } = await csrf.json();
    const response = await fetch(new URL('/api/auth/callback/credentials', base), {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { cookie, origin: base.origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email: user.email, password, json: 'true', callbackUrl: `${base.origin}/dashboard` }),
    });
    cookie = cookies(response, cookie); await response.text();
    const session = JSON.parse((await request(cookie, '/api/auth/session')).html).user;
    check(session?.id === user.id && session.role === user.role, `real credential login ${user.role}`);
    return cookie;
  } finally {
    // Login's existing writer generates an ID. Discover it only via this run's
    // exact pre-recorded random actor, then retain IDs for ID-only deletion.
    const rows = await prisma.auditLog.findMany({ where: { actorId: user.id, action: 'AUTH_LOGIN' }, select: { id: true } });
    for (const row of rows) auditIds.add(row.id);
  }
}
function path(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const entry of Array.isArray(value) ? value : [value]) query.append(key, entry);
  return `/sales/audit${query.size ? `?${query}` : ''}`;
}
function decodeHtml(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#x[\da-f]+|#\d+);/gi, (entity) => {
    if (/^&#x/i.test(entity)) return String.fromCodePoint(parseInt(entity.slice(3, -1), 16));
    if (entity.startsWith('&#')) return String.fromCodePoint(Number(entity.slice(2, -1)));
    return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity.toLowerCase()];
  });
}
const attribute = (tag, name) => decodeHtml(tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] ?? '');
const tags = (html, pattern) => [...html.matchAll(/<[^>]*>/g)].map(([tag]) => tag).filter((tag) => pattern.test(tag));
const rowIds = (html) => tags(html, /\bdata-audit-id=/).map((tag) => attribute(tag, 'data-audit-id'));
const rowArticles = (html) => [...html.matchAll(/<(article|tr)\b[^>]*\bdata-audit-id="[^"]*"[^>]*>[\s\S]*?<\/\1>/g)].map(([row]) => row);
const fieldKeys = (row) => tags(row, /\bdata-audit-field=/).map((tag) => attribute(tag, 'data-audit-field'));
const summaryValues = (row) => Object.fromEntries([...row.matchAll(/<div\b[^>]*\bdata-audit-field="[^"]*"[^>]*>[\s\S]*?<\/div>/g)]
  .map(([field]) => [attribute(field, 'data-audit-field'), attribute(tags(field, /\bdata-audit-value=/)[0] ?? '', 'data-audit-value')]));
const vietnamDisplay = (value) => new Intl.DateTimeFormat('vi-VN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23', timeZone: 'UTC',
}).format(new Date(new Date(value).getTime() + offset));
const safeDisplay = (key, value) => value === null ? 'Không có' : typeof value === 'boolean' ? value ? 'Có' : 'Không'
  : Array.isArray(value) ? value.join(', ') : /At$/.test(key)
    ? vietnamDisplay(value) : String(value);

// Independent inventory of actual CRM emitters. Never import production registry,
// query/filter/date helpers or the summarizer to calculate expected results.
const registry = {
  CUSTOMER_PROFILE_UPDATE: { category: 'CUSTOMER', entity: 'CustomerProfile', keys: ['status', 'priority'] },
  CUSTOMER_TASK_CREATE: { category: 'TASK', entity: 'CustomerTask', keys: ['customerId', 'priority'] },
  CUSTOMER_TASK_STATUS_UPDATE: { category: 'TASK', entity: 'CustomerTask', keys: ['status', 'previousStatus', 'customerId'] },
  CUSTOMER_PIPELINE_STATUS_CHANGE: { category: 'PIPELINE', entity: 'CustomerProfile', keys: ['previousStatus', 'newStatus'] },
  CUSTOMER_SALES_ASSIGNMENT: { category: 'ASSIGNMENT', entity: 'CustomerProfile', keys: ['previousSalesId', 'newSalesId'] },
  CUSTOMER_ACTIVITY_CREATE: { category: 'INTERACTION', entity: 'CustomerProfile', keys: ['customerId', 'activityId', 'activityType'] },
  CUSTOMER_NEXT_CONTACT_UPDATE: { category: 'CONTACT', entity: 'CustomerProfile', keys: ['customerId', 'previousNextContactAt', 'nextContactAt', 'operation'] },
  CUSTOMER_TASK_PLAN_UPDATE: { category: 'TASK', entity: 'CustomerTask', keys: ['customerId', 'taskId', 'changedFields', 'previousPriority', 'priority', 'previousDueAt', 'dueAt'] },
  CUSTOMER_BULK_PRIORITY_UPDATE: { category: 'BULK_OPERATION', entity: 'CustomerProfile', keys: ['customerId', 'previousPriority', 'priority', 'bulk'] },
  CUSTOMER_CSV_EXPORT: { category: 'EXPORT', entity: 'CustomerProfile', keys: ['rowCount', 'filtersActive', 'format'] },
  SALES_TEAM_CREATE: { category: 'TEAM', entity: 'SalesTeam', keys: ['managerId'] },
  SALES_TEAM_RENAME: { category: 'TEAM', entity: 'SalesTeam', keys: [] },
  SALES_TEAM_MANAGER_CHANGE: { category: 'TEAM', entity: 'SalesTeam', keys: ['previousManagerId', 'newManagerId'] },
  SALES_TEAM_MEMBER_ADD: { category: 'TEAM', entity: 'SalesTeamMember', keys: ['teamId', 'userId'] },
  SALES_TEAM_MEMBER_REMOVE: { category: 'TEAM', entity: 'SalesTeamMember', keys: ['teamId', 'userId', 'assignedCustomerCount', 'nonClosedCustomerCount', 'confirmationUsed'] },
};
const actions = Object.keys(registry); const categories = [...new Set(Object.values(registry).map((item) => item.category))];
const knownAction = (action) => Object.hasOwn(registry, action);
function rangeFor(params, now = new Date()) {
  if (params.period === 'custom') return { start: new Date(`${params.from}T00:00:00+07:00`), end: new Date(new Date(`${params.to}T00:00:00+07:00`).getTime() + day) };
  const vietnam = new Date(now.getTime() + offset); const end = Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate() + 1) - offset;
  const days = params.period === '7d' ? 7 : params.period === '90d' ? 90 : 30;
  return { start: new Date(end - days * day), end: new Date(end) };
}
async function oracle(params) {
  const range = rangeFor(params);
  const rows = await prisma.auditLog.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const universe = rows.filter((row) => knownAction(row.action) && row.createdAt >= range.start && row.createdAt < range.end
    && (!params.action || row.action === params.action) && (!params.category || registry[row.action].category === params.category));
  return { universe, rows: universe.filter((row) => !params.actorId || row.actorId === params.actorId) };
}
async function consolePage(actor, params = {}, label = 'audit console', invalid = false) {
  const expected = invalid ? { rows: [], universe: [] } : await oracle(params);
  const pageCount = Math.max(1, Math.ceil(expected.rows.length / 50)); const page = invalid ? 1 : Math.min(Number(params.page || 1), pageCount);
  const response = await read(actor, path(params), label);
  check(response.status === 200, `${label}: authorized HTTP 200`);
  const wrapper = tags(response.html, /\bdata-audit-total=/)[0];
  if (invalid) check(!wrapper && tags(response.html, /\bdata-audit-range=/).length === 0,
    `${label}: invalid request omits timeline count/range instead of presenting an empty successful query`);
  else {
    check(wrapper && attribute(wrapper, 'data-audit-total') === String(expected.rows.length)
      && attribute(wrapper, 'data-audit-page') === String(page) && attribute(wrapper, 'data-audit-page-count') === String(pageCount), `${label}: exact filtered count, bounded/clamped page and page count`);
    const range = rangeFor(params); const rangeTag = tags(response.html, /\bdata-audit-range=/)[0];
    check(rangeTag && attribute(rangeTag, 'data-start') === range.start.toISOString() && attribute(rangeTag, 'data-end') === range.end.toISOString(),
      `${label}: exact inclusive Vietnam day range with exclusive UTC end`);
  }
  const selected = expected.rows.slice((page - 1) * 50, page * 50);
  check(hash(rowIds(response.html)) === hash(selected.map((row) => row.id)), `${label}: exact rows in createdAt DESC/id DESC order with at most 50 records`);
  check(!response.html.includes(poison) && !response.html.includes(password) && !response.html.includes(passwordHash), `${label}: arbitrary metadata, secrets, task/activity/customer free text never reach HTML or serialized response`);
  const articles = rowArticles(response.html);
  check(articles.length === selected.length && articles.every((row) => !/<form\b|<button\b/.test(row)), `${label}: audit rows have no edit/delete/undo/mutation controls`);
  for (const row of articles) {
    const stored = selected.find((entry) => entry.id === attribute(row, 'data-audit-id')); const definition = registry[stored.action];
    check(attribute(row, 'data-audit-action') === stored.action && attribute(row, 'data-audit-category') === definition.category, `${label}: known action maps to its explicit CRM category`);
    const entityMatches = stored.entityType === definition.entity;
    const entityId = entityMatches && stored.action !== 'CUSTOMER_CSV_EXPORT' && typeof stored.entityId === 'string' && /^[A-Za-z0-9_-]{1,191}$/.test(stored.entityId) ? stored.entityId : '';
    check(attribute(row, 'data-audit-entity-type') === (entityMatches ? definition.entity : 'Unknown')
      && attribute(row, 'data-audit-entity-id') === entityId && attribute(row, 'data-audit-actor-id') === (stored.actorId ?? ''),
    `${label}: entity and actor identifiers follow the stored event, with malformed entities suppressed`);
    const time = tags(row, /^<time\b/)[0];
    check(time && attribute(time, 'dateTime') === stored.createdAt.toISOString(), `${label}: event time preserves its exact historical UTC instant`);
    const renderedTime = row.match(/<time\b[^>]*>([\s\S]*?)<\/time>/)?.[1] ?? '';
    check(decodeHtml(renderedTime.replace(/<!--[^]*?-->/g, '')).includes(vietnamDisplay(stored.createdAt)),
      `${label}: event time displays fixed UTC+7 with full year, including historical instants`);
    const fixture = fixtures.get(stored.id);
    if (fixture) {
      check(hash(fieldKeys(row).sort()) === hash([...fixture.keys].sort()), `${label}: fixture summary exposes exactly its typed allowlist, never raw metadata`);
      const actualValues = summaryValues(row);
      check(fixture.keys.every((key) => actualValues[key] === fixture.values[key]), `${label}: sanitized ID/enum/count/date/boolean/changed-field values are exact`);
      if (fixture.link) check(row.includes(`href="/sales/customers/${fixture.link}"`), `${label}: customer link follows known registry semantics`);
      else check(!/href="\/sales\/customers\//.test(row), `${label}: null/export/team/malformed entity never fabricates a customer link`);
    }
    if (stored.actorId === null) check(!row.includes(users.admin.name) && !row.includes(users.super.name)
      && /không|unknown|system|hệ thống/i.test(decodeHtml(row)), `${label}: null actor is neutral, not session/owner inference`);
  }
  if (invalid) check(/role="alert"/.test(response.html), `${label}: malformed filters fail closed with a visible warning`);
  return response;
}
async function actorOptions(params, label) {
  const response = await consolePage('admin', params, label);
  const universe = (await oracle(params)).universe; const ids = [...new Set(universe.map((row) => row.actorId).filter(Boolean))];
  const expected = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { id: 'asc' }, take: 200 });
  const select = [...response.html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map(([tag]) => tag).find((tag) => attribute(tag, 'name') === 'actorId');
  const options = [...(select ?? '').matchAll(/<option\b[^>]*>/g)].map(([tag]) => attribute(tag, 'value')).filter(Boolean);
  const hasPlaceholder = params.actorId && !expected.some((user) => user.id === params.actorId);
  const expectedIds = [...(hasPlaceholder ? [params.actorId] : []), ...expected.map((user) => user.id)];
  check(Boolean(select) && hash(options) === hash(expectedIds), `${label}: at most 200 named actors in ID order from the same period/action/category universe, plus only the selected-ID placeholder`);
  const optionRows = [...(select ?? '').matchAll(/<option\b[^>]*>[\s\S]*?<\/option>/g)].map(([option]) => option);
  check(expected.every((user) => decodeHtml(optionRows.find((option) => attribute(option, 'value') === user.id) ?? '').includes(user.name)),
    `${label}: every named option uses the current stored actor name`);
  if (hasPlaceholder) check(/>ID đã chọn<\/option>/.test(optionRows.find((option) => attribute(option, 'value') === params.actorId) ?? ''),
    `${label}: selected actor outside suggestions is neutral and does not confirm account existence`);
  return response;
}
async function createUser(key, role = 'CLIENT', name = `${marker} ${key}`) {
  const id = `${marker}-${key}`; userIds.push(id);
  const user = await prisma.user.create({ data: { id, email: `${marker}-${key.toLowerCase()}@example.test`, name, password: passwordHash, role } });
  users[key] = user; return user;
}
async function createAudit(key, action, metadata, options = {}) {
  const id = `${marker}-audit-${key}`; auditIds.add(id);
  const definition = knownAction(action) ? registry[action] : undefined; const entityType = options.entityType ?? definition?.entity ?? 'User';
  const entityId = options.entityId === undefined ? entityType === 'CustomerProfile' ? customerIds[0] : entityType === 'CustomerTask' ? taskIds[0] : `${marker}-entity-${key}` : options.entityId;
  await prisma.auditLog.create({ data: { id, action, entityType, entityId,
    actorId: options.actorId === undefined ? users.admin.id : options.actorId, createdAt: options.createdAt ?? new Date('2024-02-29T02:30:00.123Z'),
    metadata: metadata === null ? Prisma.JsonNull : metadata,
  } });
  let link = null;
  if (definition && entityType === definition.entity && action !== 'CUSTOMER_CSV_EXPORT') {
    const candidate = entityType === 'CustomerProfile' ? entityId : entityType === 'CustomerTask' && metadata && !Array.isArray(metadata) ? metadata.customerId : null;
    if (typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,191}$/.test(candidate)) link = candidate;
  }
  const keys = options.keys ?? [];
  fixtures.set(id, { keys, link, values: Object.fromEntries(keys.map((key) => [key, safeDisplay(key, metadata[key])])) }); return id;
}

try {
  baseline = await snapshot(); passwordHash = await bcrypt.hash(password, 10);
  for (const [key, role] of Object.entries({ super: 'SUPER_ADMIN', admin: 'ADMIN', manager: 'MANAGER', salesManager: 'SALES_MANAGER', sales: 'SALES', client: 'CLIENT', creator: 'CREATOR', analyst: 'ANALYST', employee: 'EMPLOYEE' })) {
    sessions[key] = await login(await createUser(key, role));
  }
  const customerUser = await createUser('customer', 'CLIENT', poison);
  const customerId = `${marker}-customer-profile`; customerIds.push(customerId);
  await prisma.customerProfile.create({ data: { id: customerId, userId: customerUser.id, customerCode: `${marker}-customer-code`, assignedSalesId: users.sales.id,
    status: 'LEAD', priority: 'HIGH', note: poison, source: poison, lastContactAt: new Date('2020-01-01T00:00:00Z'), nextContactAt: new Date('2030-01-01T00:00:00Z') } });
  const taskId = `${marker}-task`; taskIds.push(taskId);
  await prisma.customerTask.create({ data: { id: taskId, customerId, assignedToId: users.sales.id, createdById: users.admin.id, title: poison, description: poison, priority: 'URGENT', status: 'TODO' } });
  await prisma.customerActivity.create({ data: { id: `${marker}-activity`, customerId, actorId: users.sales.id, type: 'NOTE', title: poison, content: poison } });
  const teamId = `${marker}-team`; teamIds.push(teamId);
  await prisma.salesTeam.create({ data: { id: teamId, name: poison, managerId: users.salesManager.id } });
  await prisma.salesTeamMember.create({ data: { id: `${marker}-membership`, teamId, userId: users.sales.id } });
  const values = {
    CUSTOMER_PROFILE_UPDATE: { status: 'ACTIVE', priority: 'HIGH' },
    CUSTOMER_TASK_CREATE: { customerId, priority: 'URGENT' },
    CUSTOMER_TASK_STATUS_UPDATE: { status: 'DONE', previousStatus: 'TODO', customerId },
    CUSTOMER_PIPELINE_STATUS_CHANGE: { previousStatus: 'LEAD', newStatus: 'PROSPECT' },
    CUSTOMER_SALES_ASSIGNMENT: { previousSalesId: null, newSalesId: users.sales.id },
    CUSTOMER_ACTIVITY_CREATE: { customerId, activityId: `${marker}-activity`, activityType: 'CALL' },
    CUSTOMER_NEXT_CONTACT_UPDATE: { customerId, previousNextContactAt: null, nextContactAt: '2026-09-15T02:30:00.123Z', operation: 'SET' },
    CUSTOMER_TASK_PLAN_UPDATE: { customerId, taskId, changedFields: ['title', 'priority', 'dueAt'], previousPriority: 'LOW', priority: 'URGENT', previousDueAt: null, dueAt: '2026-09-15T02:30:00.123Z' },
    CUSTOMER_BULK_PRIORITY_UPDATE: { customerId, previousPriority: 'LOW', priority: 'HIGH', bulk: true },
    CUSTOMER_CSV_EXPORT: { rowCount: 12, filtersActive: true, format: 'csv' },
    SALES_TEAM_CREATE: { managerId: users.salesManager.id },
    SALES_TEAM_RENAME: {},
    SALES_TEAM_MANAGER_CHANGE: { previousManagerId: users.salesManager.id, newManagerId: users.admin.id },
    SALES_TEAM_MEMBER_ADD: { teamId, userId: users.sales.id },
    SALES_TEAM_MEMBER_REMOVE: { teamId, userId: users.sales.id, assignedCustomerCount: 1, nonClosedCustomerCount: 1, confirmationUsed: true },
  };
  const privateFields = Object.fromEntries(poisonKeys.map((key) => [key, `${poison}-${key}`]));
  for (const action of actions) {
    const options = { keys: registry[action].keys, ...(action === 'CUSTOMER_CSV_EXPORT' ? { entityId: null } : {}) };
    const id = await createAudit(`valid-${action}`, action, { ...values[action], ...privateFields, actorId: users.super.id }, options);
    validFixtures.set(action, id);
    await createAudit(`null-${action}`, action, null, { ...(action === 'CUSTOMER_CSV_EXPORT' ? { entityId: null } : {}) });
    await createAudit(`scalar-${action}`, action, poison);
    await createAudit(`array-${action}`, action, [{ ...values[action], ...privateFields }]);
    const malformed = Object.fromEntries(registry[action].keys.map((key) => [key, `<script>${poison}</script>`]));
    await createAudit(`invalid-${action}`, action, { ...malformed, ...privateFields });
  }
  const nullActorId = await createAudit('null-actor', 'CUSTOMER_PROFILE_UPDATE', values.CUSTOMER_PROFILE_UPDATE, { actorId: null, keys: registry.CUSTOMER_PROFILE_UPDATE.keys });
  const scriptName = `<script data-crm-audit-actor="literal">${marker}</script>`;
  const scriptActor = await createUser('script-actor', 'SALES', scriptName);
  const scriptActorId = await createAudit('stored-actor', 'CUSTOMER_TASK_CREATE', values.CUSTOMER_TASK_CREATE, { actorId: scriptActor.id, keys: registry.CUSTOMER_TASK_CREATE.keys });
  const mismatchId = await createAudit('wrong-entity', 'CUSTOMER_TASK_CREATE', values.CUSTOMER_TASK_CREATE, { entityType: 'CustomerProfile' });
  await createAudit('invalid-entity-id', 'CUSTOMER_PROFILE_UPDATE', values.CUSTOMER_PROFILE_UPDATE, { entityId: '../bad', keys: registry.CUSTOMER_PROFILE_UPDATE.keys });
  for (const action of ['AUTH_LOGIN', 'USER_CREATE', 'USER_ROLE_UPDATE', 'USER_STATUS_UPDATE', 'UNKNOWN_FUTURE_ACTION', 'CUSTOMER_FAKE_EVENT', '__proto__']) {
    await createAudit(`excluded-${action}`, action, privateFields);
  }
  // These match a real action under common case-insensitive/PAD SPACE MySQL
  // collations. Keep them older than the first 50 valid rows so count/options
  // tests catch leaks even when the visible first page happens to look safe.
  const collationActor = await createUser('collation-only', 'SALES', `${marker} actor with no exact CRM actions`);
  for (const [key, action] of [['lowercase', 'customer_csv_export'], ['trailing-space', 'CUSTOMER_CSV_EXPORT ']]) {
    await createAudit(`excluded-${key}`, action, { rowCount: 2, filtersActive: false, format: 'csv', ...privateFields },
      { actorId: collationActor.id, entityType: 'CustomerProfile', entityId: null, createdAt: new Date('2024-02-28T02:00:00.000Z') });
  }
  const sameTimeIds = [];
  for (let index = 0; index < 61; index += 1) sameTimeIds.push(await createAudit(`tie-${String(index).padStart(3, '0')}`, 'CUSTOMER_ACTIVITY_CREATE', values.CUSTOMER_ACTIVITY_CREATE,
    { keys: registry.CUSTOMER_ACTIVITY_CREATE.keys, actorId: users.super.id, createdAt: new Date('2024-03-01T03:00:00.000Z') }));
  for (const [key, timestamp] of [
    ['before', '2024-02-27T16:59:59.999Z'], ['start', '2024-02-27T17:00:00.000Z'],
    ['leap-start', '2024-02-28T17:00:00.000Z'], ['month-start', '2024-02-29T17:00:00.000Z'],
    ['last', '2024-03-01T16:59:59.999Z'], ['end', '2024-03-01T17:00:00.000Z'],
    ['year-before', '2023-12-31T16:59:59.999Z'], ['year-start', '2023-12-31T17:00:00.000Z'],
  ]) await createAudit(`boundary-${key}`, 'CUSTOMER_CSV_EXPORT', { rowCount: 0, filtersActive: false, format: 'csv' },
    { keys: registry.CUSTOMER_CSV_EXPORT.keys, entityId: null, createdAt: new Date(timestamp) });
  for (const age of [0, 6, 29, 89, 91]) {
    await createAudit(`preset-${age}`, 'CUSTOMER_PROFILE_UPDATE', values.CUSTOMER_PROFILE_UPDATE,
      { keys: registry.CUSTOMER_PROFILE_UPDATE.keys, createdAt: new Date(Date.now() - age * day) });
  }

  for (const actor of ['super', 'admin']) await consolePage(actor, frozen, `${actor}: full CRM audit universe`);
  for (const [actor, user] of Object.entries(users).filter(([key]) => sessions[key])) {
    const allowed = ['SUPER_ADMIN', 'ADMIN'].includes(user.role);
    if (!allowed) {
      const denied = await read(actor, path(frozen), `${user.role}: blocked audit route`);
      check(denied.status === 307 && denied.location === '/dashboard' && rowIds(denied.html).length === 0, `${user.role}: sales:read or other permissions never grant audit access`);
    }
    const dashboard = await read(actor, '/dashboard', `${user.role}: portal navigation`);
    check(dashboard.status === 200 && /data-audit-link=/.test(dashboard.html) === allowed, `${user.role}: portal audit navigation follows least privilege`);
    if (['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_MANAGER', 'SALES'].includes(user.role)) {
      const sales = await read(actor, '/sales', `${user.role}: sales dashboard navigation`);
      check(sales.status === 200 && /data-audit-link=/.test(sales.html) === allowed, `${user.role}: audit dashboard card follows least privilege`);
    }
  }
  const anonymous = await read('anonymous', path(frozen), 'anonymous audit request');
  check(anonymous.status === 307 && anonymous.location === '/dang-nhap', 'anonymous audit access requires login');

  const actionChoicesPage = await consolePage('admin', frozen, 'action registry choices');
  const actionSelect = [...actionChoicesPage.html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map(([tag]) => tag).find((tag) => attribute(tag, 'name') === 'action');
  const actionChoices = [...(actionSelect ?? '').matchAll(/<option\b[^>]*>/g)].map(([tag]) => attribute(tag, 'value')).filter(Boolean);
  check(hash(actionChoices.sort()) === hash([...actions].sort()), 'filter action choices contain exactly all 15 actual CRM emitters, no auth/user/future actions');
  for (const action of actions) {
    const page = await consolePage('admin', { ...frozen, action, actorId: users.admin.id }, `known action ${action}`);
    const row = rowArticles(page.html).find((article) => attribute(article, 'data-audit-id') === validFixtures.get(action));
    check(Boolean(row), `${action}: valid historical event remains visible with malformed siblings`);
    const text = decodeHtml(row);
    for (const [key, value] of Object.entries(values[action])) {
      if (typeof value === 'string' && !/At$/.test(key)) check(text.includes(value), `${action}: safe structured ${key} is visible`);
      if (typeof value === 'number') check(text.includes(String(value)), `${action}: approved count ${key} is visible`);
    }
  }
  for (const category of categories) await consolePage('admin', { ...frozen, category }, `registry category ${category}`);
  await consolePage('admin', { ...frozen, category: 'TASK', action: 'CUSTOMER_CSV_EXPORT' }, 'conflicting valid action/category remains empty');
  await actorOptions(frozen, 'actor options for selected historical universe');
  await actorOptions({ ...frozen, action: 'CUSTOMER_CSV_EXPORT' }, 'case/space action variants cannot affect exact-action count, rows or actor suggestions');
  await actorOptions({ ...frozen, category: 'EXPORT' }, 'case/space action variants cannot affect exact-category count, rows or actor suggestions');
  await actorOptions({ ...frozen, actorId: collationActor.id }, 'actor with only case/space variants has no CRM rows and only a neutral selected-ID placeholder');
  await actorOptions({ ...frozen, category: 'TEAM', actorId: users.admin.id }, 'actor selection does not widen action/category universe');
  await actorOptions({ ...frozen, actorId: `${marker}-missing` }, 'unknown actor does not reveal unrelated users');
  await consolePage('admin', { ...frozen, actorId: users.client.id }, 'existing unrelated actor yields no CRM rows');
  await consolePage('admin', { ...frozen, actorId: scriptActor.id }, 'historical actor is stored relation, not task assignee');

  const first = await consolePage('admin', { ...frozen, action: 'CUSTOMER_ACTIVITY_CREATE' }, 'same timestamp first page');
  const second = await consolePage('admin', { ...frozen, action: 'CUSTOMER_ACTIVITY_CREATE', page: '2' }, 'same timestamp second page');
  check(hash(rowIds(first.html)) === hash([...sameTimeIds].reverse().slice(0, 50)), 'same-time history has explicit id DESC tie breaking');
  check(!rowIds(first.html).some((id) => rowIds(second.html).includes(id)), 'successive pages do not duplicate frozen audit rows');
  const pagination = tags(first.html, /^<a\b/).map((tag) => attribute(tag, 'href')).filter((href) => href.startsWith('/sales/audit?'));
  check(pagination.some((href) => {
    const url = new URL(href, base); return url.searchParams.get('page') === '2' && url.searchParams.get('period') === 'custom'
      && url.searchParams.get('from') === frozen.from && url.searchParams.get('to') === frozen.to && url.searchParams.get('action') === 'CUSTOMER_ACTIVITY_CREATE';
  }), 'pagination retains period, inclusive dates and registry action');
  await consolePage('admin', { ...frozen, page: '1000' }, 'largest valid page clamps to final records');
  const actorPage = await consolePage('admin', { ...frozen, category: 'TASK' }, 'stored actor and entity semantics');
  const actorRow = rowArticles(actorPage.html).find((row) => attribute(row, 'data-audit-id') === scriptActorId);
  check(actorRow?.includes('&lt;script') && decodeHtml(actorRow).includes(scriptName) && !actorRow.includes('<script data-crm-audit-actor='), 'script-looking stored actor name is escaped literal text');
  const mismatch = rowArticles(actorPage.html).find((row) => attribute(row, 'data-audit-id') === mismatchId);
  check(mismatch && !/href="\/sales\/customers\//.test(mismatch), 'task action with mismatched entity type cannot invent a customer link');
  const nullPage = await consolePage('admin', { ...frozen, action: 'CUSTOMER_PROFILE_UPDATE' }, 'neutral nullable actor');
  check(rowIds(nullPage.html).includes(nullActorId), 'nullable historical actor does not hide the audit event');
  const renamedActor = `${marker} renamed current display name`;
  await prisma.user.update({ where: { id: scriptActor.id }, data: { name: renamedActor } });
  const renamed = await consolePage('admin', { ...frozen, actorId: scriptActor.id }, 'current actor display name after rename');
  check(renamed.html.includes(renamedActor) && !renamed.html.includes(scriptName), 'display uses current stored actor relation, not historical name snapshot');

  for (const period of [undefined, '7d', '30d', '90d']) await consolePage('admin', period ? { period } : {}, `${period ?? 'default 30d'} preset`);
  for (const [from, to] of [['2024-02-29', '2024-02-29'], ['2024-03-01', '2024-03-01'], ['2024-01-01', '2024-01-01'], ['2024-01-01', '2024-12-31']]) {
    await consolePage('admin', { period: 'custom', from, to }, 'UTC+7 midnight, leap/month/year or exact 366-day boundary');
  }
  for (const [params, label] of [
    [{ period: 'INVALID' }, 'invalid period'], [{ period: ['30d', '7d'] }, 'repeated period'],
    [{ ...frozen, from: '2024-02-30' }, 'impossible from date'], [{ ...frozen, to: '2024-13-01' }, 'impossible to date'],
    [{ period: 'custom' }, 'missing custom dates'], [{ ...frozen, from: '2024-03-02' }, 'reversed date range'],
    [{ period: 'custom', from: '2024-01-01', to: '2025-01-01' }, 'over 366 days'],
    [{ ...frozen, from: ['2024-02-28', '2024-02-28'] }, 'repeated from'], [{ ...frozen, to: ['2024-03-01', '2024-03-01'] }, 'repeated to'],
    [{ ...frozen, action: 'AUTH_LOGIN' }, 'non-CRM action'], [{ ...frozen, action: 'CUSTOMER_FAKE_EVENT' }, 'invented CRM action'],
    [{ ...frozen, action: 'customer_csv_export' }, 'case-variant action'], [{ ...frozen, action: 'CUSTOMER_CSV_EXPORT ' }, 'trailing-space action'],
    [{ ...frozen, action: '__proto__' }, 'inherited-object-key action'],
    [{ ...frozen, action: ['CUSTOMER_PROFILE_UPDATE', 'CUSTOMER_PROFILE_UPDATE'] }, 'repeated action'],
    [{ ...frozen, category: 'UNKNOWN' }, 'unknown category'], [{ ...frozen, category: ['TASK', 'TEAM'] }, 'repeated category'],
    [{ ...frozen, actorId: '../bad' }, 'malformed actor'], [{ ...frozen, actorId: ['one', 'two'] }, 'repeated actor'],
    [{ ...frozen, page: '-1' }, 'negative page'], [{ ...frozen, page: '1001' }, 'over-bound page'],
    [{ ...frozen, page: '999999999999999' }, 'huge page'], [{ ...frozen, page: ['1', '1'] }, 'repeated page'],
    [{ period: '7d', from: 'not-a-date' }, 'invalid unused preset date'],
  ]) await consolePage('admin', params, `fail-closed filter: ${label}`, true);
  await consolePage('admin', { ...frozen, customerId, taskId, metadata: 'untrusted-url-text', q: 'ignored-query-text', OR: '1=1' }, 'unknown query fields never enter audit predicates');

  await prisma.user.update({ where: { id: users.admin.id }, data: { role: 'MANAGER' } });
  const demoted = await read('admin', path(frozen), 'demoted admin stale session');
  check(demoted.status === 307 && demoted.location === '/dashboard', 'demoted admin immediately loses server audit access');
  const demotedNav = await read('admin', '/dashboard', 'demoted admin stale navigation');
  check(demotedNav.status === 200 && !/data-audit-link=/.test(demotedNav.html), 'demoted admin loses audit navigation');
  await prisma.user.update({ where: { id: users.admin.id }, data: { role: 'ADMIN' } });
  for (const status of ['SUSPENDED', 'DISABLED', 'INVITED']) {
    await prisma.user.update({ where: { id: users.admin.id }, data: { status } });
    const denied = await read('admin', path(frozen), `${status}: stale admin session`);
    check(denied.status === 307 && ['/dang-nhap', '/dashboard'].includes(denied.location), `${status}: stale admin cannot inspect audit history`);
    await prisma.user.update({ where: { id: users.admin.id }, data: { status: 'ACTIVE' } });
  }

  // Bounded 201-actor fixture universe demonstrates the actual 200-option limit.
  const cappedPeriod = { period: 'custom', from: '1902-01-01', to: '1902-01-01', action: 'CUSTOMER_CSV_EXPORT' };
  for (let index = 0; index < 201; index += 1) {
    const actor = await createUser(`option-${String(index).padStart(3, '0')}`, 'SALES', `${marker} option ${String(index).padStart(3, '0')}`);
    await createAudit(`option-${String(index).padStart(3, '0')}`, 'CUSTOMER_CSV_EXPORT', { rowCount: 0, filtersActive: false, format: 'csv' },
      { actorId: actor.id, entityId: null, keys: registry.CUSTOMER_CSV_EXPORT.keys, createdAt: new Date('1902-01-01T02:00:00Z') });
  }
  await actorOptions(cappedPeriod, '201 actors produce at most 200 bounded options');
  await actorOptions({ ...cappedPeriod, actorId: users['option-000'].id }, 'selected actor does not shrink the capped option universe');
  await consolePage('super', { ...cappedPeriod, actorId: users['option-200'].id }, 'valid actor outside option cap remains explicitly filterable');
  await consolePage('admin', { ...frozen, action: 'SALES_TEAM_RENAME' }, 'team rename reveals neither historical free-text name');
} finally {
  try {
    await prisma.$transaction(async (tx) => {
      // Never delete audits by action, date, prefix, actor or any broad predicate.
      // Every audit ID was recorded before fixture creation, or captured from
      // the real login of an exact pre-recorded randomized fixture actor.
      if (auditIds.size) await tx.auditLog.deleteMany({ where: { id: { in: [...auditIds] } } });
      if (customerIds.length) await tx.customerProfile.deleteMany({ where: { id: { in: customerIds } } });
      if (teamIds.length) {
        await tx.salesTeamMember.deleteMany({ where: { teamId: { in: teamIds } } });
        await tx.salesTeam.deleteMany({ where: { id: { in: teamIds } } });
      }
      if (userIds.length) await tx.user.deleteMany({ where: { id: { in: userIds } } });
    }, { timeout: 30_000 });
    if (baseline) check(baseline === await snapshot(), 'cleanup: exact fixture removal restores every original business/user/audit row');
  } finally { await prisma.$disconnect(); }
}
console.log(`AUDIT VERIFICATION COMPLETE: ${assertions} assertions passed`);
