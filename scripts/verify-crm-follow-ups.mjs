import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { CustomerTaskStatus, PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

// Local fixture verification only: no migrations, seeding or business-data repair.
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
const marker = `crm009-${randomUUID()}`;
const password = randomUUID();
const users = {}; const sessions = {}; const customers = {}; const tasks = {};
const userIds = []; const teamIds = [];
const userSelect = { id: true, email: true, name: true, role: true, status: true, phone: true, lastLoginAt: true, createdAt: true, updatedAt: true };
let baseline; let passwordHash; let assertions = 0;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  assertions += 1; console.log(`PASS: ${label}`);
}
async function snapshot(exceptTaskId) {
  const models = ['customerProfile', 'customerTask', 'customerActivity', 'salesTeam', 'salesTeamMember'];
  if (!exceptTaskId) models.push('auditLog');
  const rows = await Promise.all(models.map((model) => prisma[model].findMany({ orderBy: { id: 'asc' } })));
  if (exceptTaskId) rows[1] = rows[1].map((row) => {
    if (row.id !== exceptTaskId) return row;
    const stable = { ...row }; delete stable.status; delete stable.completedAt; delete stable.updatedAt;
    return stable;
  });
  rows.push(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: userSelect }));
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
async function request(cookie, path, options = {}) {
  const response = await fetch(new URL(path, base), {
    ...options, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { cookie, origin: base.origin, ...options.headers },
  });
  return { status: response.status, location: response.headers.get('location'), html: await response.text() };
}
async function login(user) {
  const csrfResponse = await fetch(new URL('/api/auth/csrf', base), { signal: AbortSignal.timeout(30000) });
  let cookie = cookies(csrfResponse);
  const { csrfToken } = await csrfResponse.json();
  const response = await fetch(new URL('/api/auth/callback/credentials', base), {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { cookie, origin: base.origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email: user.email, password, json: 'true', callbackUrl: `${base.origin}/sales/follow-ups` }),
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
const forms = (html) => [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(([form]) => form);
function taskForm(html, taskId) {
  const form = forms(html).find((entry) => [...entry.matchAll(/<input\b[^>]*>/g)].some(([tag]) => attribute(tag, 'name') === 'taskId' && attribute(tag, 'value') === taskId));
  if (!form) throw new Error('Expected fixture task status form in rendered HTML');
  return form;
}
async function submit(actor, path, form, fields) {
  const body = new FormData();
  for (const [tag] of form.matchAll(/<input\b[^>]*>/g)) {
    if (attribute(tag, 'type') === 'hidden') body.append(attribute(tag, 'name'), attribute(tag, 'value'));
  }
  if (![...body.keys()].some((key) => key.startsWith('$ACTION_'))) throw new Error('Missing rendered Server Action metadata');
  for (const [key, value] of Object.entries(fields)) {
    body.delete(key);
    if (value !== null) for (const entry of Array.isArray(value) ? value : [value]) body.append(key, entry);
  }
  return request(sessions[actor], path, { method: 'POST', body });
}
const route = (filters = {}) => `/sales/follow-ups?${new URLSearchParams({ q: marker, ...filters })}`;
const visibleIds = (html) => new Set([...html.matchAll(/<article\b[^>]*data-task-id="([^"]+)"/g)].map(([, id]) => decodeHtml(id)));
const sameSet = (actual, expected) => actual.size === expected.length && expected.every((id) => actual.has(id));
function dayBounds(now) {
  const local = new Date(now.getTime() + 7 * 3600000);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 7 * 3600000;
  return { start, end: start + 86400000 };
}
function dueMatches(task, due, now) {
  if (due === 'none') return task.dueAt === null;
  if (!task.dueAt) return false;
  const time = task.dueAt.getTime(); const { start, end } = dayBounds(now);
  return due === 'overdue' ? time < now.getTime() : due === 'upcoming' ? time >= now.getTime() : time >= start && time < end;
}
function metrics(html, keys, label) {
  const now = new Date(); const openKeys = keys.filter((key) => ['TODO', 'IN_PROGRESS'].includes(tasks[key].status));
  const expected = { open: openKeys.length, overdue: 0, today: 0, upcoming: 0 };
  for (const key of ['overdue', 'today', 'upcoming']) expected[key] = openKeys.filter((taskKey) => dueMatches(tasks[taskKey], key, now)).length;
  for (const [key, count] of Object.entries(expected)) {
    const tags = [...html.matchAll(/<[^>]*\bdata-metric="[^"]+"[^>]*>/g)].map(([tag]) => tag);
    const metric = tags.find((tag) => attribute(tag, 'data-metric') === key);
    check(metric && attribute(metric, 'data-count') === String(count), `${label}: scoped/filtered ${key} metric = ${count}`);
  }
}
async function expectTasks(actor, filters, keys, label, checkMetrics = true) {
  const response = await request(sessions[actor], route(filters));
  check(response.status === 200 && sameSet(visibleIds(response.html), keys.map((key) => tasks[key].id)), label);
  if (checkMetrics) metrics(response.html, keys, label);
  return response;
}
async function createUser(key, role = 'CLIENT', name = `${marker} ${key}`) {
  const user = await prisma.user.create({ data: { id: `${marker}-${key}`, email: `${marker}-${key.toLowerCase()}@example.test`, name, password: passwordHash, role } });
  userIds.push(user.id); users[key] = user; return user;
}
async function rejected(actor, form, fields, label, denied = false) {
  const before = await snapshot(); const response = await submit(actor, route(), form, fields);
  check(denied ? response.status === 303 && response.location === '/dashboard' : response.status === 200, `${label}: safe response`);
  check(before === await snapshot(), `${label}: no task, customer, team, user, activity or audit changes`);
}
async function changeStatus(actor, key, status, path = route()) {
  const task = tasks[key]; const before = await prisma.customerTask.findUniqueOrThrow({ where: { id: task.id } });
  const preserved = await snapshot(task.id); const auditsBefore = await prisma.auditLog.count();
  const logsBefore = await prisma.auditLog.count({ where: { entityId: task.id, action: 'CUSTOMER_TASK_STATUS_UPDATE' } });
  const page = await request(sessions[actor], path); const form = taskForm(page.html, task.id);
  const started = Date.now(); const response = await submit(actor, path, form, {
    taskId: task.id, status, customerId: customers.foreign.id, assignedToId: users.salesB.id,
    assignedSalesId: users.salesB.id, teamId: teamIds[1], title: 'Forged title', priority: 'LOW',
  });
  const after = await prisma.customerTask.findUniqueOrThrow({ where: { id: task.id } });
  check(response.status === 200 && after.status === status, `${users[actor].role}: task ${before.status} -> ${status} persisted`);
  check(preserved === await snapshot(task.id), `${users[actor].role}: ownership, unrelated task fields/rows, users, activities and teams unchanged`);
  const changed = before.status !== status;
  const logs = await prisma.auditLog.findMany({ where: { entityId: task.id, action: 'CUSTOMER_TASK_STATUS_UPDATE' }, orderBy: { createdAt: 'desc' } });
  check(logs.length === logsBefore + Number(changed) && await prisma.auditLog.count() === auditsBefore + Number(changed), `${users[actor].role}: exact status audit count including no-op`);
  if (changed) {
    check(logs[0].actorId === users[actor].id && logs[0].entityType === 'CustomerTask' && logs[0].metadata.status === status
      && logs[0].metadata.customerId === task.customerId && logs[0].metadata.previousStatus === before.status,
    `${users[actor].role}: audit identifies actual task/customer, actor and status`);
    check(status === 'DONE' ? after.completedAt?.getTime() >= started && after.completedAt.getTime() <= Date.now() : after.completedAt === null,
      `${users[actor].role}: completion timestamp set only for DONE and cleared on reopen`);
  } else check(hash(after) === hash(before), `${users[actor].role}: no-op preserves complete task row and completion timestamp`);
  tasks[key] = { ...task, ...after };
  check(visibleIds((await request(sessions[actor], route({ status }))).html).has(task.id), `${users[actor].role}: updated task visible under new status filter`);
  return form;
}

try {
  baseline = await snapshot(); passwordHash = await bcrypt.hash(password, 10);
  for (const [key, role] of Object.entries({ super: 'SUPER_ADMIN', admin: 'ADMIN', manager: 'MANAGER', managerA: 'SALES_MANAGER', managerB: 'SALES_MANAGER', salesA: 'SALES', salesPeer: 'SALES', salesB: 'SALES', client: 'CLIENT', creator: 'CREATOR', analyst: 'ANALYST', employee: 'EMPLOYEE' })) {
    sessions[key] = await login(await createUser(key, role));
  }
  const teamA = await prisma.salesTeam.create({ data: { name: `${marker} team A`, managerId: users.managerA.id } }); teamIds.push(teamA.id);
  const teamB = await prisma.salesTeam.create({ data: { name: `${marker} team B`, managerId: users.managerB.id } }); teamIds.push(teamB.id);
  await prisma.salesTeamMember.createMany({ data: [{ teamId: teamA.id, userId: users.salesA.id }, { teamId: teamA.id, userId: users.salesPeer.id }, { teamId: teamB.id, userId: users.salesB.id }] });
  const literal = '50%_\\value'; const decoy = '500Xvalue';
  const customerDefinitions = {
    own: ['salesA', 'ACTIVE', 'HIGH'], peer: ['salesPeer', 'LEAD', 'LOW'], foreign: ['salesB', 'PROSPECT', 'MEDIUM'], unassigned: [null, 'DORMANT', 'LOW'],
    literalName: ['salesA', 'CLOSED', 'LOW'], literalCode: ['salesA', 'ACTIVE', 'MEDIUM'], decoyName: ['salesA', 'CLOSED', 'LOW'], decoyCode: ['salesA', 'ACTIVE', 'MEDIUM'],
  };
  for (const [key, [sales, status, priority]] of Object.entries(customerDefinitions)) {
    const name = key.endsWith('Name') ? `${marker} Name ${key === 'literalName' ? literal : decoy}` : `${marker} Customer ${key}`;
    const customerCode = key.endsWith('Code') ? `${marker} Code ${key === 'literalCode' ? literal : decoy}` : `${marker}-${key}-code`;
    const user = await createUser(`customer-${key}`, 'CLIENT', name);
    customers[key] = await prisma.customerProfile.create({ data: { userId: user.id, assignedSalesId: sales ? users[sales].id : null, customerCode, status, priority, note: 'Preserve this profile' } });
  }
  const now = new Date(); const { start, end } = dayBounds(now); const past = new Date(now.getTime() - 3600000);
  const definitions = {
    past: ['own', 'salesA', 'TODO', 'URGENT', past], today: ['own', 'salesA', 'IN_PROGRESS', 'HIGH', new Date(start + 12 * 3600000)],
    future: ['own', 'salesPeer', 'TODO', 'LOW', new Date(end + 3600000)], none: ['own', 'salesA', 'TODO', 'MEDIUM', null],
    unassignedTask: ['own', null, 'TODO', 'LOW', null],
    done: ['own', 'salesA', 'DONE', 'HIGH', new Date(start + 1800000)], cancelled: ['own', 'salesA', 'CANCELLED', 'LOW', new Date(end - 1800000)],
    startBoundary: ['own', 'salesA', 'TODO', 'MEDIUM', new Date(start)], endBoundary: ['own', 'salesA', 'IN_PROGRESS', 'MEDIUM', new Date(end)],
    visibleMismatch: ['own', 'salesB', 'TODO', 'HIGH', past], peer: ['peer', 'salesPeer', 'TODO', 'URGENT', new Date(end + 7200000)],
    foreignMismatch: ['foreign', 'salesA', 'TODO', 'HIGH', past], foreign: ['foreign', 'salesB', 'DONE', 'LOW', null],
    unassigned: ['unassigned', 'salesA', 'IN_PROGRESS', 'MEDIUM', new Date(now.getTime() + 3600000)],
    literalName: ['literalName', 'salesA', 'TODO', 'LOW', null], literalCode: ['literalCode', 'salesA', 'TODO', 'LOW', null],
    literalTitle: ['own', 'salesA', 'TODO', 'LOW', null], decoyName: ['decoyName', 'salesA', 'TODO', 'LOW', null],
    decoyCode: ['decoyCode', 'salesA', 'TODO', 'LOW', null], decoyTitle: ['own', 'salesA', 'TODO', 'LOW', null],
  };
  for (const [key, [customerKey, sales, status, priority, dueAt]] of Object.entries(definitions)) {
    const title = key.endsWith('Title') ? `${marker} Title ${key === 'literalTitle' ? literal : decoy}` : `${marker} Task ${key}`;
    tasks[key] = { ...await prisma.customerTask.create({ data: { customerId: customers[customerKey].id, assignedToId: sales ? users[sales].id : null, createdById: users.admin.id,
      title, status, priority, dueAt, completedAt: status === 'DONE' ? new Date(now.getTime() - 86400000) : null, description: 'Preserve task description' } }), customerKey };
  }
  const all = Object.keys(tasks); const own = all.filter((key) => customers[tasks[key].customerKey].assignedSalesId === users.salesA.id);
  const managed = [...own, 'peer'];
  for (const actor of ['super', 'admin', 'manager']) await expectTasks(actor, {}, all, `${users[actor].role}: global list and metrics`);
  await expectTasks('managerA', {}, managed, 'SALES_MANAGER: customer-scoped list and metrics');
  await expectTasks('salesA', {}, own, 'SALES: customer scope, not task-assignee scope');
  for (const actor of ['managerA', 'salesA']) {
    await expectTasks(actor, { salesId: users.salesB.id }, ['visibleMismatch'], `${actor}: foreign task assignee filter cannot expose foreign customer`);
    await expectTasks(actor, { teamId: teamB.id }, ['visibleMismatch'], `${actor}: foreign task team filter intersects customer scope`);
    await expectTasks(actor, { salesId: `${marker}-missing` }, [], `${actor}: nonexistent Sales filter safely empty`);
    await expectTasks(actor, { teamId: `${marker}-missing` }, [], `${actor}: nonexistent team filter safely empty`);
  }
  for (const actor of ['client', 'creator', 'analyst', 'employee']) {
    const response = await request(sessions[actor], route());
    check(response.status === 307 && response.location === '/dashboard', `${users[actor].role}: workbench route blocked`);
  }
  for (const [filters, expected, label] of [
    [{ status: 'TODO', priority: 'URGENT', salesId: users.salesA.id, teamId: teamA.id, due: 'overdue', customerStatus: 'ACTIVE', customerPriority: 'HIGH' }, ['past'], 'all filters combine'],
    [{ customerStatus: 'PROSPECT', customerPriority: 'MEDIUM' }, ['foreignMismatch', 'foreign'], 'customer status and priority'],
    [{ salesId: users.salesPeer.id }, ['future', 'peer'], 'Sales filter targets task assignee'],
    [{ teamId: teamB.id }, ['visibleMismatch', 'foreign'], 'team filter targets task assignee membership'],
    [{ q: `${marker} Name ${literal}` }, ['literalName'], 'literal customer name excludes wildcard decoy'],
    [{ q: `${marker} Code ${literal}` }, ['literalCode'], 'literal customer code excludes wildcard decoy'],
    [{ q: `${marker} Title ${literal}` }, ['literalTitle'], 'literal task title excludes wildcard decoy'],
  ]) await expectTasks('admin', filters, expected, label);
  for (const status of Object.values(CustomerTaskStatus)) {
    await expectTasks('admin', { status }, all.filter((key) => tasks[key].status === status), `real Prisma task status ${status}`);
  }
  for (const due of ['overdue', 'today', 'upcoming', 'none']) {
    await expectTasks('admin', { due }, all.filter((key) => dueMatches(tasks[key], due, new Date())), `UTC+7 due ${due}, all statuses in list/open-only metrics`);
  }
  const invalid = await expectTasks('salesA', { status: 'BAD', priority: 'INVALID', salesId: '../../other', teamId: 'x'.repeat(200), due: 'bad', customerStatus: 'BAD', customerPriority: 'BAD', page: '-1' }, own,
    'invalid filters ignored without changing customer scope');
  check(decodeHtml(invalid.html).includes('không hợp lệ'), 'invalid-filter notice is visible');
  const repeated = await request(sessions.salesA, `${route()}&status=TODO&status=DONE&salesId=${users.salesB.id}&salesId=${users.salesA.id}`);
  check(repeated.status === 200 && sameSet(visibleIds(repeated.html), own.map((key) => tasks[key].id)), 'repeated parameters are ignored without widening scope');
  const empty = await expectTasks('salesA', { q: `${marker}-no-match` }, [], 'clear empty results and zero metrics');
  const reset = [...empty.html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(([tag]) => tag).find((tag) => decodeHtml(tag).includes('Xóa bộ lọc'));
  check(reset && attribute(reset, 'href') === '/sales/follow-ups', 'reset link clears every query parameter');
  const resetResponse = await request(sessions.salesA, '/sales/follow-ups');
  check(resetResponse.status === 200 && own.every((key) => visibleIds(resetResponse.html).has(tasks[key].id)), 'reset restores authorized fixture tasks');
  const readOnly = await request(sessions.manager, route());
  check(!forms(readOnly.html).some((form) => /name="taskId"/.test(form)), 'MANAGER retains read-only task operations');
  const operationPage = await request(sessions.salesA, route());
  check(Object.values(CustomerTaskStatus).every((status) => taskForm(operationPage.html, tasks.past.id).includes(`value="${status}"`)), 'status form offers every real Prisma task status');

  await changeStatus('super', 'past', 'IN_PROGRESS');
  await changeStatus('admin', 'past', 'DONE');
  const actionForm = await changeStatus('admin', 'past', 'DONE');
  await changeStatus('salesA', 'past', 'TODO');
  await changeStatus('managerA', 'peer', 'CANCELLED');
  for (const [fields, label] of [
    [{ taskId: tasks.past.id, status: 'INVALID' }, 'invalid status'], [{ taskId: tasks.past.id, status: ['TODO', 'DONE'] }, 'repeated status'],
    [{ taskId: [tasks.past.id, tasks.foreign.id], status: 'DONE' }, 'repeated taskId'], [{ taskId: '../bad', status: 'DONE' }, 'malformed taskId'],
    [{ taskId: `${marker}-missing`, status: 'DONE' }, 'missing task'], [{ taskId: customers.own.id, status: 'DONE' }, 'customer ID cannot stand in for task ID'],
    [{ taskId: tasks.foreignMismatch.id, customerId: customers.own.id, status: 'DONE' }, 'foreign customer task assigned to current Sales'],
    [{ taskId: tasks.foreign.id, customerId: customers.own.id, status: 'DONE' }, 'foreign task with forged owned customer'],
  ]) await rejected('salesA', actionForm, fields, `SALES ${label}`);
  await rejected('managerA', actionForm, { taskId: tasks.foreignMismatch.id, status: 'DONE' }, 'SALES_MANAGER foreign customer task');
  for (const actor of ['manager', 'client', 'creator', 'analyst', 'employee']) await rejected(actor, actionForm, { taskId: tasks.past.id, status: 'DONE' }, `${users[actor].role}: stolen task action`, true);
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'CLIENT' } });
  await rejected('salesA', actionForm, { taskId: tasks.past.id, status: 'DONE' }, 'demoted Sales session denied', true);
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'SALES' } });
  await prisma.customerProfile.update({ where: { id: customers.own.id }, data: { assignedSalesId: users.salesB.id } });
  for (const actor of ['salesA', 'managerA']) await rejected(actor, actionForm, { taskId: tasks.past.id, status: 'DONE' }, `${actor}: stale task form after customer reassignment`);
  await prisma.customerProfile.update({ where: { id: customers.own.id }, data: { assignedSalesId: users.salesA.id } });
  const peerMembership = await prisma.salesTeamMember.findUniqueOrThrow({ where: { userId: users.salesPeer.id } });
  const peerForm = taskForm((await request(sessions.managerA, route())).html, tasks.peer.id);
  await prisma.salesTeamMember.delete({ where: { id: peerMembership.id } });
  await rejected('managerA', peerForm, { taskId: tasks.peer.id, status: 'DONE' }, 'manager stale task form after fixture team membership removal');
  await prisma.salesTeamMember.create({ data: peerMembership });
  await changeStatus('salesA', 'past', 'IN_PROGRESS', `/sales/customers/${customers.own.id}`);

  const paging = `${marker}-paging`;
  await prisma.customerTask.createMany({ data: Array.from({ length: 32 }, (_, index) => ({ id: `${paging}-${index}`, customerId: customers.own.id,
    assignedToId: users.salesA.id, createdById: users.admin.id, title: `${paging} ${index}`, status: 'TODO', priority: 'HIGH' })) });
  const first = await request(sessions.salesA, route({ q: paging, status: 'TODO', priority: 'HIGH' }));
  const second = await request(sessions.salesA, route({ q: paging, status: 'TODO', priority: 'HIGH', page: '2' }));
  const firstIds = visibleIds(first.html); const secondIds = visibleIds(second.html);
  check(first.status === 200 && second.status === 200 && firstIds.size === 30 && secondIds.size === 2 && [...firstIds].every((id) => !secondIds.has(id)), 'pagination returns 30 + 2 tasks without duplicates');
  const nextLink = [...first.html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => attribute(tag, 'href')).find((href) => {
    const parsed = new URL(href, base); return parsed.pathname === '/sales/follow-ups' && parsed.searchParams.get('page') === '2';
  });
  const nextParams = nextLink ? new URL(nextLink, base).searchParams : null;
  check(nextParams?.get('q') === paging && nextParams.get('status') === 'TODO' && nextParams.get('priority') === 'HIGH', 'pagination preserves the complete active filter combination');
  const last = await request(sessions.salesA, route({ q: paging, page: '1000000' }));
  check(last.status === 200 && visibleIds(last.html).size === 2, 'oversized valid page clamps to final results');
  for (const path of ['/sales', '/sales/customers', `/sales/customers/${customers.own.id}`, '/sales/pipeline', '/sales/assignment', '/sales/teams', `/sales/teams/${teamA.id}`]) {
    check((await request(sessions.admin, path)).status === 200, `existing CRM regression route ${path.replace(customers.own.id, '[id]').replace(teamA.id, '[id]')}`);
  }
  for (const actor of ['super', 'admin', 'managerA', 'salesA', 'manager']) {
    const dashboard = await request(sessions[actor], '/sales');
    check(dashboard.html.includes('href="/sales/follow-ups"') && dashboard.html.includes('href="/sales/customers"') && dashboard.html.includes('href="/sales/pipeline"'), `${users[actor].role}: workbench and existing dashboard links`);
  }
} finally {
  try {
    if (userIds.length) await prisma.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await tx.customerProfile.deleteMany({ where: { userId: { in: userIds } } });
      await tx.salesTeamMember.deleteMany({ where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: userIds } }] } });
      await tx.salesTeam.deleteMany({ where: { id: { in: teamIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    if (baseline) check(baseline === await snapshot(), 'cleanup: original customer/task/team/user/activity/audit database snapshot restored');
  } finally { await prisma.$disconnect(); }
}
console.log(`FOLLOW-UP VERIFICATION COMPLETE: ${assertions} assertions passed`);
