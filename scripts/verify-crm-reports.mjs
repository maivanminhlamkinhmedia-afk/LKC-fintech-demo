import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { CustomerActivityType, CustomerPriority, CustomerStatus, PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

// Explicit local fixture opt-in. No migrations, business-data repair or report writes.
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
const marker = `crm010-${randomUUID()}`; const password = randomUUID();
const users = {}; const sessions = {}; const customerIds = []; const userIds = []; const teamIds = [];
const userSelect = { id: true, email: true, name: true, role: true, status: true, phone: true, lastLoginAt: true, createdAt: true, updatedAt: true };
let baseline; let passwordHash; let assertions = 0;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  assertions += 1; console.log(`PASS: ${label}`);
}
async function snapshot() {
  const rows = await Promise.all(['customerProfile', 'customerTask', 'customerActivity', 'salesTeam', 'salesTeamMember', 'auditLog']
    .map((model) => prisma[model].findMany({ orderBy: { id: 'asc' } })));
  rows.push(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: userSelect }));
  return hash(rows);
}
async function oracleData() {
  // Test-only independent oracle. Production reporting must not use this fetch-and-group strategy.
  const [customers, tasks, activities, memberships, teams] = await Promise.all([
    prisma.customerProfile.findMany({ select: { id: true, assignedSalesId: true, createdAt: true, status: true, priority: true } }),
    prisma.customerTask.findMany({ select: { customerId: true, assignedToId: true, status: true, dueAt: true, completedAt: true } }),
    prisma.customerActivity.findMany({ select: { customerId: true, createdAt: true, type: true } }),
    prisma.salesTeamMember.findMany({ select: { userId: true, teamId: true } }),
    prisma.salesTeam.findMany({ select: { id: true, name: true, managerId: true } }),
  ]);
  return { customers, tasks, activities, memberships, teams };
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
async function request(cookie, path, options = {}) {
  const response = await fetch(new URL(path, base), {
    ...options, redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { cookie, origin: base.origin, ...options.headers },
  });
  return { status: response.status, location: response.headers.get('location'), html: await response.text() };
}
async function login(user) {
  const csrf = await fetch(new URL('/api/auth/csrf', base), { signal: AbortSignal.timeout(30000) });
  let cookie = cookies(csrf); const { csrfToken } = await csrf.json();
  const response = await fetch(new URL('/api/auth/callback/credentials', base), {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { cookie, origin: base.origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email: user.email, password, json: 'true', callbackUrl: `${base.origin}/sales/reports` }),
  });
  cookie = cookies(response, cookie); await response.text();
  const session = JSON.parse((await request(cookie, '/api/auth/session')).html).user;
  check(session?.id === user.id && session.role === user.role, `real credential login ${user.role}`);
  return cookie;
}
function decodeHtml(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#x[\da-f]+|#\d+);/gi, (entity) => {
    if (/^&#x/i.test(entity)) return String.fromCodePoint(parseInt(entity.slice(3, -1), 16));
    if (entity.startsWith('&#')) return String.fromCodePoint(Number(entity.slice(2, -1)));
    return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity.toLowerCase()];
  });
}
const attribute = (tag, name) => decodeHtml(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '');
const tagsWith = (html, name) => [...html.matchAll(new RegExp(`<[^>]*\\b${name}(?:="[^"]*")?[^>]*>`, 'g'))].map(([tag]) => tag);
function route(values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  return params.size ? `/sales/reports?${params}` : '/sales/reports';
}
const isoDay = (time) => new Date(time + 7 * 3600000).toISOString().slice(0, 10);
const dayStart = (day) => new Date(`${day}T00:00:00+07:00`).getTime();
function periodRange(period = '30d', from, to, now = new Date()) {
  const today = isoDay(now.getTime()); const end = dayStart(today) + 86400000;
  if (period === 'custom') return { from, to, start: dayStart(from), end: dayStart(to) + 86400000 };
  const start = period === 'ytd' ? dayStart(`${today.slice(0, 4)}-01-01`) : end - Number(period.slice(0, -1)) * 86400000;
  return { from: isoDay(start), to: today, start, end };
}
const custom = { period: 'custom', from: '2026-09-01', to: '2026-09-14' };
const customRange = periodRange(custom.period, custom.from, custom.to);
const inRange = (date, range) => date !== null && date.getTime() >= range.start && date.getTime() < range.end;
function authorizedCustomers(model, actor) {
  if (['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(users[actor].role)) return model.customers;
  if (users[actor].role === 'SALES_MANAGER') {
    const teamIds = new Set(model.teams.filter((team) => team.managerId === users[actor].id).map((team) => team.id));
    const salesIds = new Set(model.memberships.filter((member) => teamIds.has(member.teamId)).map((member) => member.userId));
    return model.customers.filter((customer) => salesIds.has(customer.assignedSalesId));
  }
  return model.customers.filter((customer) => customer.assignedSalesId === users[actor].id);
}
function reportOracle(model, actor, filters, range) {
  const ownerTeams = new Map(model.memberships.map((member) => [member.userId, member.teamId]));
  const authorized = authorizedCustomers(model, actor);
  const customers = authorized.filter((customer) => (!filters.salesId || customer.assignedSalesId === filters.salesId)
    && (!filters.teamId || ownerTeams.get(customer.assignedSalesId) === filters.teamId)
    && (!filters.status || customer.status === filters.status) && (!filters.priority || customer.priority === filters.priority));
  function summarize(portfolio) {
    const ids = new Set(portfolio.map((customer) => customer.id));
    const tasks = model.tasks.filter((task) => ids.has(task.customerId));
    const open = tasks.filter((task) => ['TODO', 'IN_PROGRESS'].includes(task.status));
    const now = Date.now(); const today = dayStart(isoDay(now));
    return { customers: portfolio.length, newCustomers: portfolio.filter((customer) => inRange(customer.createdAt, range)).length,
      open: open.length, overdue: open.filter((task) => task.dueAt && task.dueAt.getTime() < now).length,
      today: open.filter((task) => task.dueAt && task.dueAt.getTime() >= today && task.dueAt.getTime() < today + 86400000).length,
      completed: tasks.filter((task) => task.status === 'DONE' && inRange(task.completedAt, range)).length,
      activities: model.activities.filter((activity) => ids.has(activity.customerId) && inRange(activity.createdAt, range)).length };
  }
  const distribution = (values, rows, key) => Object.fromEntries(values.map((value) => [value, rows.filter((row) => row[key] === value).length]));
  const ids = new Set(customers.map((customer) => customer.id));
  const activities = model.activities.filter((activity) => ids.has(activity.customerId) && inRange(activity.createdAt, range));
  const salesIds = [...new Set(customers.map((customer) => customer.assignedSalesId))];
  const teamIds = [...new Set(customers.map((customer) => ownerTeams.get(customer.assignedSalesId) ?? null))];
  return { metrics: summarize(customers),
    status: distribution(Object.values(CustomerStatus), customers, 'status'),
    priority: distribution(Object.values(CustomerPriority), customers, 'priority'),
    activity: distribution(Object.values(CustomerActivityType), activities, 'type'),
    sales: Object.fromEntries(salesIds.map((id) => [id ?? 'none', summarize(customers.filter((customer) => customer.assignedSalesId === id))])),
    team: Object.fromEntries(teamIds.map((id) => [id ?? 'none', summarize(customers.filter((customer) => (ownerTeams.get(customer.assignedSalesId) ?? null) === id))])),
    allowedSales: new Set(authorized.map((customer) => customer.assignedSalesId).filter(Boolean)),
    allowedTeams: new Set(authorized.map((customer) => ownerTeams.get(customer.assignedSalesId)).filter(Boolean)),
  };
}
function tableRows(html, type) {
  return tagsWith(html, 'data-report-row').filter((tag) => attribute(tag, 'data-report-row') === type).map((tag) => ({
    id: attribute(tag, 'data-id'), customers: Number(attribute(tag, 'data-customers')), newCustomers: Number(attribute(tag, 'data-new-customers')),
    open: Number(attribute(tag, 'data-open')), overdue: Number(attribute(tag, 'data-overdue')), completed: Number(attribute(tag, 'data-completed')),
  }));
}
function parsedSnapshot(html) {
  const names = ['data-report-metric', 'data-report-distribution', 'data-report-row', 'data-report-table'];
  return hash(names.map((name) => tagsWith(html, name).map((tag) => [...tag.matchAll(/\bdata-[\w-]+="[^"]*"/g)].map(([item]) => item).sort()).sort()));
}
function checkOptions(html, oracle, label, selected = {}) {
  const selects = [...html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map(([tag]) => tag);
  for (const [key, allowed] of [['salesId', oracle.allowedSales], ['teamId', oracle.allowedTeams]]) {
    const select = selects.find((tag) => attribute(tag, 'name') === key);
    check(Boolean(select), `${label}: ${key} filter exists`);
    const values = [...select.matchAll(/<option\b[^>]*>/g)].map(([tag]) => attribute(tag, 'value')).filter(Boolean);
    const visible = values.filter((value) => allowed.has(value));
    check(values.every((value) => allowed.has(value) || value === selected[key]) && new Set(values).size === values.length,
      `${label}: ${key} identities remain within authorization (except echoed submitted placeholder)`);
    const selectedAllowance = typeof selected[key] === 'string' && allowed.has(selected[key]) ? 1 : 0;
    check(visible.length >= Math.min(allowed.size, 100) && visible.length <= 100 + selectedAllowance, `${label}: ${key} authorized options are bounded at 100 plus selected placeholder`);
  }
}
async function verifyReport(actor, params = {}, expectedFilters = params, range = periodRange(), label = 'report') {
  const before = await snapshot(); const response = await request(sessions[actor], route(params));
  check(response.status === 200, `${label}: HTTP 200`);
  check(before === await snapshot(), `${label}: GET report made no business/audit/user changes`);
  const oracle = reportOracle(await oracleData(), actor, expectedFilters, range);
  const rangeTag = tagsWith(response.html, 'data-report-range')[0];
  check(rangeTag && attribute(rangeTag, 'data-from') === range.from && attribute(rangeTag, 'data-to') === range.to
    && attribute(rangeTag, 'data-start') === new Date(range.start).toISOString() && attribute(rangeTag, 'data-end') === new Date(range.end).toISOString(),
  `${label}: exact UTC+7 reporting boundaries and inclusive UI end date`);
  const metrics = tagsWith(response.html, 'data-report-metric');
  for (const [key, value] of Object.entries(oracle.metrics)) {
    const tag = metrics.find((item) => attribute(item, 'data-report-metric') === key);
    check(tag && attribute(tag, 'data-count') === String(value), `${label}: ${key} = ${value}`);
  }
  for (const kind of ['status', 'priority', 'activity']) {
    const tags = tagsWith(response.html, 'data-report-distribution').filter((tag) => attribute(tag, 'data-report-distribution') === kind);
    check(tags.length === Object.keys(oracle[kind]).length && new Set(tags.map((tag) => attribute(tag, 'data-value'))).size === tags.length
      && tags.every((tag) => attribute(tag, 'data-count') === String(oracle[kind][attribute(tag, 'data-value')])),
      `${label}: every real ${kind} distribution value matches independent oracle`);
    if (kind !== 'activity') check(tags.every((tag) => {
      const expected = oracle.metrics.customers ? oracle[kind][attribute(tag, 'data-value')] * 100 / oracle.metrics.customers : 0;
      return attribute(tag, 'data-percentage') !== '' && Math.abs(Number(attribute(tag, 'data-percentage')) - expected) <= 0.051;
    }), `${label}: ${kind} percentages reconcile safely to current customer total`);
  }
  for (const type of ['sales', 'team']) {
    const wrapper = tagsWith(response.html, 'data-report-table').find((tag) => attribute(tag, 'data-report-table') === type);
    const count = Object.keys(oracle[type]).length; const pageCount = Math.max(1, Math.ceil(count / 20));
    const page = Math.min(Number(expectedFilters[type === 'sales' ? 'page' : 'teamPage'] || 1), pageCount);
    const rows = tableRows(response.html, type);
    check(wrapper && attribute(wrapper, 'data-total') === String(count) && attribute(wrapper, 'data-page') === String(page)
      && attribute(wrapper, 'data-page-count') === String(pageCount), `${label}: ${type} table bounds/count/page`);
    check(rows.length === Math.min(20, Math.max(0, count - (page - 1) * 20)) && new Set(rows.map((row) => row.id)).size === rows.length
      && rows.every((row) => oracle[type][row.id] && ['customers', 'newCustomers', 'open', 'overdue', 'completed'].every((key) => row[key] === oracle[type][row.id][key])),
    `${label}: ${type} current-ownership workload rows match oracle`);
  }
  checkOptions(response.html, oracle, label, params);
  const forms = [...response.html.matchAll(/<form\b[^>]*>/g)].map(([tag]) => tag);
  check(forms.length > 0 && forms.every((tag) => attribute(tag, 'method').toLowerCase() === 'get') && !/name="\$ACTION_/.test(response.html),
    `${label}: report exposes GET filters only, no business mutation action`);
  return { ...response, oracle };
}
async function createUser(key, role = 'SALES') {
  const user = await prisma.user.create({ data: { id: `${marker}-${key}`, email: `${marker}-${key.toLowerCase()}@example.test`, name: `${marker} ${key}`, password: passwordHash, role } });
  userIds.push(user.id); users[key] = user; return user;
}
async function createCustomer(key, salesId, status, priority, createdAt) {
  const client = await createUser(`customer-${key}`, 'CLIENT');
  const customer = await prisma.customerProfile.create({ data: { userId: client.id, assignedSalesId: salesId, customerCode: `${marker}-${key}`, status, priority, createdAt } });
  customerIds.push(customer.id); return customer;
}
async function task(customer, key, data = {}) {
  return prisma.customerTask.create({ data: { customerId: customer.id, assignedToId: users.salesA.id, createdById: users.admin.id,
    title: `${marker} ${key}`, status: 'TODO', priority: 'MEDIUM', createdAt: new Date(customRange.start - 86400000), ...data } });
}

try {
  baseline = await snapshot(); passwordHash = await bcrypt.hash(password, 10);
  for (const [key, role] of Object.entries({ super: 'SUPER_ADMIN', admin: 'ADMIN', manager: 'MANAGER', managerA: 'SALES_MANAGER', managerB: 'SALES_MANAGER', salesA: 'SALES', salesPeer: 'SALES', salesB: 'SALES', noTeam: 'SALES', client: 'CLIENT', creator: 'CREATOR', analyst: 'ANALYST', employee: 'EMPLOYEE' })) {
    sessions[key] = await login(await createUser(key, role));
  }
  const teamA = await prisma.salesTeam.create({ data: { name: `${marker} team A`, managerId: users.managerA.id } }); teamIds.push(teamA.id);
  const teamB = await prisma.salesTeam.create({ data: { name: `${marker} team B`, managerId: users.managerB.id } }); teamIds.push(teamB.id);
  await prisma.salesTeamMember.createMany({ data: [{ teamId: teamA.id, userId: users.salesA.id }, { teamId: teamA.id, userId: users.salesPeer.id }, { teamId: teamB.id, userId: users.salesB.id }] });
  const own = [];
  const dates = [customRange.start - 1, customRange.start, customRange.end - 1, customRange.end, customRange.start + 86400000];
  for (const [index, status] of Object.values(CustomerStatus).entries()) own.push(await createCustomer(`own-${index}`, users.salesA.id, status,
    Object.values(CustomerPriority)[index % 3], new Date(dates[index])));
  const peer = await createCustomer('peer', users.salesPeer.id, 'LEAD', 'HIGH', new Date(customRange.start));
  const foreign = await createCustomer('foreign', users.salesB.id, 'CLOSED', 'HIGH', new Date(customRange.start));
  const unowned = await createCustomer('unowned', null, 'PROSPECT', 'MEDIUM', new Date(customRange.end - 1));
  const unteamed = await createCustomer('unteamed', users.noTeam.id, 'DORMANT', 'LOW', new Date(customRange.start - 1));
  const now = Date.now(); const today = dayStart(isoDay(now));
  await task(own[0], 'old-open-overdue-foreign-assignee', { assignedToId: users.salesB.id, dueAt: new Date(now - 3600000) });
  await task(own[1], 'today', { status: 'IN_PROGRESS', dueAt: new Date(today + 12 * 3600000) });
  await task(own[1], 'null-assignee-no-deadline', { assignedToId: null });
  await task(peer, 'peer-upcoming', { assignedToId: users.salesPeer.id, dueAt: new Date(today + 2 * 86400000) });
  await task(foreign, 'foreign-customer-current-sales-assignee', { assignedToId: users.salesA.id, dueAt: new Date(now - 3600000) });
  for (const [key, portfolio] of [['unowned', unowned], ['unteamed', unteamed]]) {
    await task(portfolio, `${key}-open-overdue`, { assignedToId: users.salesA.id, dueAt: new Date(now - 3600000) });
    await task(portfolio, `${key}-completed-in-period`, { assignedToId: users.salesB.id, status: 'DONE', completedAt: new Date(customRange.start) });
  }
  await task(own[0], 'completed-at-start-created-before', { status: 'DONE', completedAt: new Date(customRange.start) });
  await task(own[0], 'completed-at-inclusive-end', { status: 'DONE', completedAt: new Date(customRange.end - 1) });
  await task(own[0], 'completed-at-exclusive-end', { status: 'DONE', completedAt: new Date(customRange.end), createdAt: new Date(customRange.start) });
  await task(own[0], 'reopened-with-legacy-completion-timestamp', { status: 'TODO', completedAt: new Date(customRange.start) });
  await task(own[0], 'completed-with-null-date', { status: 'DONE', completedAt: null });
  await task(own[0], 'cancelled-old-overdue', { status: 'CANCELLED', dueAt: new Date(now - 3600000) });
  for (const [index, type] of Object.values(CustomerActivityType).entries()) {
    await prisma.customerActivity.create({ data: { customerId: own[index % own.length].id, actorId: users.salesB.id, type, title: `${marker} ${type}`, createdAt: new Date(customRange.start + index * 1000) } });
  }
  for (const [key, date] of [['before', customRange.start - 1], ['end-included', customRange.end - 1], ['end-excluded', customRange.end]]) {
    await prisma.customerActivity.create({ data: { customerId: own[0].id, actorId: null, type: 'NOTE', title: `${marker} ${key}`, createdAt: new Date(date) } });
  }
  const scopedBefore = {};
  for (const actor of ['super', 'admin', 'manager', 'managerA', 'salesA', 'noTeam']) {
    const result = await verifyReport(actor, custom, custom, customRange, `${users[actor].role} ${actor}: all report sections`);
    if (['managerA', 'salesA'].includes(actor)) {
      scopedBefore[actor] = parsedSnapshot(result.html);
      check(!result.html.includes(users.salesB.email) && !result.html.includes(users.salesB.name) && !result.html.includes(teamB.name), `${actor}: foreign identities absent from rows/options/serialized report`);
    }
  }
  const ownReport = await verifyReport('salesA', custom, custom, customRange, 'period versus snapshot proof');
  check(ownReport.oracle.metrics.customers === 5 && ownReport.oracle.metrics.newCustomers === 3 && ownReport.oracle.metrics.completed === 2,
    'fixture proves snapshot includes outside-period customers and completedAt excludes reopened/null/exclusive-end cases');
  const noDataBefore = await snapshot();
  for (const actor of ['client', 'creator', 'analyst', 'employee']) {
    const response = await request(sessions[actor], route(custom));
    check(response.status === 307 && response.location === '/dashboard', `${users[actor].role}: report blocked`);
  }
  check(noDataBefore === await snapshot(), 'unauthorized report requests are read-only');
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'CLIENT' } });
  const demotedBefore = await snapshot();
  const demoted = await request(sessions.salesA, route(custom));
  check(demoted.status === 307 && demoted.location === '/dashboard', 'previous Sales session cannot read reports after role demotion');
  check(demotedBefore === await snapshot(), 'demoted-session report request is read-only');
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'SALES' } });

  // Changes to a foreign customer's entire reporting footprint must affect no scoped result.
  const additionalForeign = await createCustomer('foreign-added', users.salesB.id, 'ACTIVE', 'MEDIUM', new Date(customRange.start));
  await task(additionalForeign, 'foreign-added-overdue', { assignedToId: users.salesA.id, dueAt: new Date(now - 3600000) });
  await task(additionalForeign, 'foreign-added-completed', { assignedToId: users.salesA.id, status: 'DONE', completedAt: new Date(customRange.start) });
  await prisma.customerActivity.create({ data: { customerId: additionalForeign.id, actorId: users.salesA.id, type: 'CALL', title: `${marker} foreign change`, createdAt: new Date(customRange.start) } });
  for (const actor of ['salesA', 'managerA']) {
    const response = await verifyReport(actor, custom, custom, customRange, `${actor}: after foreign customer/task/activity changes`);
    check(parsedSnapshot(response.html) === scopedBefore[actor], `${actor}: foreign changes affect NONE of visible metrics/distributions/workload/activity totals`);
    check(!response.html.includes(users.salesB.email) && !response.html.includes(users.salesB.name) && !response.html.includes(teamB.name),
      `${actor}: foreign identities remain absent after foreign footprint grows`);
    for (const filters of [{ salesId: users.salesB.id }, { teamId: teamB.id }]) {
      const result = await verifyReport(actor, { ...custom, ...filters }, filters, customRange, `${actor}: forged foreign ownership filter`);
      check(result.oracle.metrics.customers === 0 && !result.html.includes(users.salesB.email) && !result.html.includes(teamB.name), `${actor}: foreign filters return zero without identity leakage`);
    }
  }
  await verifyReport('admin', { ...custom, salesId: users.salesA.id, teamId: teamA.id, status: 'LEAD', priority: 'LOW' },
    { salesId: users.salesA.id, teamId: teamA.id, status: 'LEAD', priority: 'LOW' }, customRange, 'combined customer-ownership/status/priority filters');
  await verifyReport('salesA', { ...custom, status: 'CLOSED', priority: 'MEDIUM' }, { status: 'CLOSED', priority: 'MEDIUM' }, customRange, 'status/priority do not bypass customer scope');
  for (const period of ['7d', '30d', '90d', 'ytd']) await verifyReport('admin', { period }, {}, periodRange(period), `preset ${period}`);
  await verifyReport('salesA', {}, {}, periodRange(), 'default 30-day report');
  await verifyReport('salesA', { period: '7d', from: custom.from, to: custom.to }, {}, periodRange('7d'), 'valid custom-date parameters do not override preset');
  const invalidCases = [
    [{ period: 'bad' }, {}, periodRange(), 'invalid period'], [{ period: ['7d', '90d'] }, {}, periodRange(), 'repeated period'],
    [{ period: 'custom', from: '2026-02-30', to: custom.to }, {}, periodRange(), 'impossible date'],
    [{ period: 'custom', from: '2026-9-01', to: custom.to }, {}, periodRange(), 'malformed YYYY-MM-DD'],
    [{ period: 'custom', from: custom.to, to: custom.from }, {}, periodRange(), 'reversed range'],
    [{ period: 'custom', from: [custom.from, custom.to], to: custom.to }, {}, periodRange(), 'repeated date'],
    [{ period: 'custom', to: custom.to }, {}, periodRange(), 'missing custom date'],
    [{ period: 'custom', from: '2025-01-01', to: '2026-12-31' }, {}, periodRange(), 'range beyond 366 inclusive days'],
    [{ period: '7d', from: 'invalid', to: custom.to }, {}, periodRange('7d'), 'invalid ignored preset date preserves preset'],
    [{ ...custom, salesId: '../../foreign', teamId: 'x'.repeat(200), status: 'WON', priority: 'URGENT', page: '-1', teamPage: '1e9' }, {}, customRange, 'malformed IDs/enums/pages'],
    [{ ...custom, salesId: [users.salesB.id, users.salesA.id], teamId: [teamB.id, teamA.id], status: ['LEAD', 'CLOSED'], priority: ['LOW', 'HIGH'], page: ['1', '2'], teamPage: ['1', '2'] }, {}, customRange, 'repeated ownership/enums/pages'],
    [{ ...custom, page: '999999999999999', teamPage: '999999999999999' }, {}, customRange, 'oversized page values'],
  ];
  for (const [params, filters, range, label] of invalidCases) {
    const response = await verifyReport('salesA', params, filters, range, `safe invalid query: ${label}`);
    check(decodeHtml(response.html).includes('không hợp lệ'), `${label}: visible invalid-filter notice`);
  }
  const empty = await verifyReport('salesA', { ...custom, salesId: `${marker}-missing` }, { salesId: `${marker}-missing` }, customRange, 'empty report has zero metrics and safe percentages');
  const reset = [...empty.html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(([tag]) => tag).find((tag) => decodeHtml(tag).includes('Xóa bộ lọc'));
  check(reset && attribute(reset, 'href') === '/sales/reports', 'reset removes filters and restores default period');

  // Bounded fixtures prove both 20-row tables paginate; extra owners exercise the 100-option cap.
  for (let index = 0; index < 103; index += 1) {
    const sales = await createUser(`paging-sales-${String(index).padStart(3, '0')}`);
    if (index < 22) {
      const team = await prisma.salesTeam.create({ data: { name: `${marker} paging team ${index}`, managerId: users.managerA.id } }); teamIds.push(team.id);
      await prisma.salesTeamMember.create({ data: { teamId: team.id, userId: sales.id } });
    }
    await createCustomer(`paging-${index}`, sales.id, 'LEAD', 'LOW', new Date(customRange.start));
  }
  const first = await verifyReport('admin', custom, custom, customRange, 'large workload page 1 and identity option caps');
  check(decodeHtml(first.html).includes('tối đa 100'), 'truncated identity option list has an explicit 100-option notice');
  const second = await verifyReport('admin', { ...custom, page: '2', teamPage: '2' }, { page: '2', teamPage: '2' }, customRange, 'independent workload page 2');
  for (const type of ['sales', 'team']) {
    const firstIds = tableRows(first.html, type).map((row) => row.id); const secondIds = tableRows(second.html, type).map((row) => row.id);
    check(firstIds.length === 20 && secondIds.length > 0 && !firstIds.some((id) => secondIds.includes(id)), `${type}: page partitions are bounded and non-overlapping`);
  }
  const again = await request(sessions.admin, route(custom));
  check(hash(tableRows(again.html, 'sales')) === hash(tableRows(first.html, 'sales')) && hash(tableRows(again.html, 'team')) === hash(tableRows(first.html, 'team')),
    'workload ordering is deterministic across identical requests');
  const links = [...first.html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => attribute(tag, 'href'));
  for (const key of ['page', 'teamPage']) check(links.some((href) => {
    const url = new URL(href, base); return url.pathname === '/sales/reports' && url.searchParams.get(key) === '2'
      && url.searchParams.get('period') === custom.period && url.searchParams.get('from') === custom.from && url.searchParams.get('to') === custom.to;
  }), `${key}: pagination preserves custom reporting period`);
  await verifyReport('admin', { ...custom, page: '1000000', teamPage: '1000000' }, { page: '1000000', teamPage: '1000000' }, customRange, 'large valid pages clamp to final groups');
  for (const path of ['/sales', '/sales/customers', `/sales/customers/${own[0].id}`, '/sales/pipeline', '/sales/follow-ups', '/sales/assignment', '/sales/teams', `/sales/teams/${teamA.id}`]) {
    check((await request(sessions.admin, path)).status === 200, `existing CRM regression route ${path.replace(own[0].id, '[id]').replace(teamA.id, '[id]')}`);
  }
  for (const actor of ['super', 'admin', 'manager', 'managerA', 'salesA']) {
    const dashboard = await request(sessions[actor], '/sales');
    check(['/sales/reports', '/sales/customers', '/sales/pipeline', '/sales/follow-ups'].every((path) => dashboard.html.includes(`href="${path}"`)), `${users[actor].role}: reporting and existing dashboard navigation`);
  }
} finally {
  try {
    if (userIds.length) await prisma.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await tx.customerProfile.deleteMany({ where: { id: { in: customerIds } } });
      await tx.salesTeamMember.deleteMany({ where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: userIds } }] } });
      await tx.salesTeam.deleteMany({ where: { id: { in: teamIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    if (baseline) check(baseline === await snapshot(), 'cleanup: original customer/task/team/user/activity/audit database snapshot restored');
  } finally { await prisma.$disconnect(); }
}
console.log(`REPORT VERIFICATION COMPLETE: ${assertions} assertions passed`);
