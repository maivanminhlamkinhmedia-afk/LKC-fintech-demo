import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { CustomerTaskPriority, PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

// Explicit opt-in, isolated loopback development/test fixtures only. No seed/repair/migration.
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
const marker = `crm013-${randomUUID()}`; const password = randomUUID();
const users = {}; const sessions = {}; const customers = {}; const tasks = {}; const userIds = []; const teamIds = [];
const day = 86_400_000; const offset = 7 * 3_600_000;
const userSelect = { id: true, email: true, name: true, role: true, status: true, phone: true, lastLoginAt: true, createdAt: true, updatedAt: true };
const reportActors = ['admin', 'managerA', 'salesA', 'salesB'];
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = (value) => value?.toISOString() ?? null;
const localInput = (value) => value ? new Date(value.getTime() + offset).toISOString().slice(0, 16) : '';
const detailPath = (customer) => `/sales/customers/${customer.id}`;
const workbenchPath = (params = {}) => `/sales/follow-ups?${new URLSearchParams({ q: marker, ...params })}`;
let baseline; let passwordHash; let assertions = 0;
function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  assertions += 1; console.log(`PASS: ${label}`);
}
async function businessRows(taskId, allowedFields = []) {
  const taskRows = await prisma.customerTask.findMany({ orderBy: { id: 'asc' } });
  const rows = [taskRows.map((task) => {
    if (task.id !== taskId) return task;
    const stable = { ...task }; for (const field of allowedFields) delete stable[field]; return stable;
  })];
  rows.push(...await Promise.all(['customerProfile', 'customerActivity', 'salesTeam', 'salesTeamMember'].map((model) => prisma[model].findMany({ orderBy: { id: 'asc' } }))));
  rows.push(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: userSelect }));
  return rows;
}
async function snapshot() {
  return hash([await businessRows(), await prisma.auditLog.findMany({ orderBy: { id: 'asc' } })]);
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
    body: new URLSearchParams({ csrfToken, email: user.email, password, json: 'true', callbackUrl: `${base.origin}/sales` }),
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
const articles = (html) => [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].map(([article]) => article);
const taskIds = (html) => articles(html).map((article) => attribute(article, 'data-task-id')).filter(Boolean);
const dataTags = (html, pattern) => [...html.matchAll(/<[^>]*\bdata-[\w-]+="[^"]*"[^>]*>/g)].map(([tag]) => tag).filter((tag) => pattern.test(tag));
const dataAttributes = (tag) => Object.fromEntries([...tag.matchAll(/\b(data-[\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decodeHtml(value)]));
const stableObjects = (rows) => hash(rows.map((row) => Object.entries(row).sort()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
function inputValue(form, name) {
  const input = [...form.matchAll(/<input\b[^>]*>/g)].map(([tag]) => tag).find((tag) => attribute(tag, 'name') === name);
  return input ? attribute(input, 'value') : undefined;
}
function planningForm(html, taskId) {
  const form = forms(html).find((entry) => /data-task-plan-form=/.test(entry) && inputValue(entry, 'taskId') === taskId);
  if (!form) throw new Error('Expected rendered fixture task planning form');
  return form;
}
function identifiedForm(html, name, id) {
  const form = forms(html).find((entry) => inputValue(entry, name) === id && !/data-task-plan-form=/.test(entry));
  if (!form) throw new Error('Expected rendered fixture existing-action form');
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
const fieldsFor = (task) => ({ taskId: task.id, title: task.title, priority: task.priority, dueAt: localInput(task.dueAt), expectedUpdatedAt: iso(task.updatedAt) });
async function scopedCustomerIds(actor) {
  // Independent customer ownership oracle. No production scope/query/date helper imports.
  const [profiles, memberships, teams] = await Promise.all([
    prisma.customerProfile.findMany(), prisma.salesTeamMember.findMany(), prisma.salesTeam.findMany(),
  ]);
  const user = users[actor];
  if (['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user.role)) return new Set(profiles.map((customer) => customer.id));
  const managed = new Set(teams.filter((team) => team.managerId === user.id).map((team) => team.id));
  const owners = new Set(memberships.filter((member) => managed.has(member.teamId)).map((member) => member.userId));
  return new Set(profiles.filter((customer) => user.role === 'SALES_MANAGER' ? owners.has(customer.assignedSalesId) : customer.assignedSalesId === user.id).map((customer) => customer.id));
}
async function surface(actor, customer, surfaceName = 'detail') {
  const path = surfaceName === 'detail' ? detailPath(customer) : workbenchPath();
  const before = await snapshot(); const response = await request(sessions[actor], path);
  check(response.status === 200, `${actor}: ${surfaceName} read authorized`);
  check(before === await snapshot(), `${actor}: ${surfaceName} GET is read-only`);
  const visible = await scopedCustomerIds(actor);
  const expected = (await prisma.customerTask.findMany()).filter((task) => visible.has(task.customerId)
    && (surfaceName === 'detail' ? task.customerId === customer.id : Object.values(customers).some((fixture) => fixture.id === task.customerId)));
  const canWrite = ['SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES'].includes(users[actor].role);
  const planning = forms(response.html).filter((form) => /data-task-plan-form=/.test(form));
  const expectedEditable = expected.filter((task) => canWrite && ['TODO', 'IN_PROGRESS'].includes(task.status));
  check(hash(planning.map((form) => inputValue(form, 'taskId')).sort()) === hash(expectedEditable.map((task) => task.id).sort()), `${actor}: ${surfaceName} only current scoped open tasks have planning controls`);
  for (const task of expectedEditable) {
    const form = planningForm(response.html, task.id);
    check(inputValue(form, 'expectedUpdatedAt') === iso(task.updatedAt) && inputValue(form, 'dueAt') === localInput(task.dueAt), `${actor}: ${surfaceName} exact task version and UTC+7 minute input`);
    const names = [...form.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)].map(([tag]) => attribute(tag, 'name')).filter((name) => name && !name.startsWith('$ACTION_')).sort();
    check(hash(names) === hash(['dueAt', 'expectedUpdatedAt', 'priority', 'taskId', 'title']), `${actor}: ${surfaceName} no status/assignee/customer/contact selector in planning form`);
  }
  return { ...response, path };
}
async function health(actor) {
  const response = await request(sessions[actor], '/sales');
  const tags = dataTags(response.html, /data-contact-health=/);
  check(response.status === 200 && tags.length === 4, `${actor}: four existing contact-health counts available`);
  return stableObjects(tags.map(dataAttributes));
}
async function report(actor) {
  const response = await request(sessions[actor], '/sales/reports?period=7d');
  const tags = dataTags(response.html, /data-report-/).map(dataAttributes);
  const metrics = Object.fromEntries(tags.filter((tag) => tag['data-report-metric']).map((tag) => [tag['data-report-metric'], Number(tag['data-count'])]));
  check(response.status === 200 && Object.keys(metrics).length === 7, `${actor}: all existing report metrics available`);
  const rows = tags.filter((tag) => tag['data-report-row']).map((tag) => ({ kind: tag['data-report-row'], id: tag['data-id'], overdue: Number(tag['data-overdue']) }));
  const stable = tags.filter((tag) => !['overdue', 'today'].includes(tag['data-report-metric'])).map((tag) => {
    const copy = { ...tag }; if (copy['data-report-row']) delete copy['data-overdue']; return copy;
  });
  return { metrics, rows, stable: stableObjects(stable), full: stableObjects(tags) };
}
function dueCounts(value, now) {
  const vietnam = new Date(now.getTime() + offset);
  const start = Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()) - offset;
  return { overdue: Number(value !== null && value < now), today: Number(value !== null && value.getTime() >= start && value.getTime() < start + day) };
}
async function assertFilters(actor, task) {
  const visible = await scopedCustomerIds(actor); const now = new Date();
  const fixtureTasks = (await prisma.customerTask.findMany()).filter((row) => visible.has(row.customerId) && Object.values(customers).some((customer) => customer.id === row.customerId));
  const checkWorkbench = async (params, expected, label) => {
    const response = await request(sessions[actor], workbenchPath(params));
    check(response.status === 200 && hash(taskIds(response.html).sort()) === hash(expected.map((row) => row.id).sort()), `${actor}: workbench ${label} reflects stored task planning`);
  };
  for (const due of ['overdue', 'today', 'upcoming', 'none']) {
    await checkWorkbench({ due }, fixtureTasks.filter((row) => due === 'none' ? row.dueAt === null : due === 'upcoming'
      ? row.dueAt !== null && row.dueAt >= now : Boolean(dueCounts(row.dueAt, now)[due])), `${due} filter`);
  }
  for (const priority of Object.values(CustomerTaskPriority)) await checkWorkbench({ priority }, fixtureTasks.filter((row) => row.priority === priority), `${priority} priority filter`);
  const searchToken = `${marker}-renamed-search`;
  if (task.title.includes(searchToken)) await checkWorkbench({ q: searchToken }, [task], 'changed-title search');
  const matchingCustomers = [...new Set(fixtureTasks.filter((row) => ['TODO', 'IN_PROGRESS'].includes(row.status) && row.dueAt !== null && row.dueAt < now).map((row) => row.customerId))].sort();
  for (const pathname of ['/sales/customers', '/sales/pipeline']) {
    const response = await request(sessions[actor], `${pathname}?${new URLSearchParams({ q: marker, task: 'overdue' })}`);
    const ids = [...response.html.matchAll(/href="\/sales\/customers\/([^"?]+)"/g)].map(([, id]) => decodeHtml(id));
    check(response.status === 200 && hash([...new Set(ids)].sort()) === hash(matchingCustomers), `${actor}: ${pathname} existing overdue-task customer filter reflects dueAt`);
  }
}
async function changePlan(actor, taskId, overrides, label, surfaceName = 'detail', verifyReports = false) {
  const current = await prisma.customerTask.findUniqueOrThrow({ where: { id: taskId } });
  const customer = await prisma.customerProfile.findUniqueOrThrow({ where: { id: current.customerId } });
  const page = await surface(actor, customer, surfaceName); const form = planningForm(page.html, taskId);
  const fields = { ...fieldsFor(current), ...overrides };
  const dueAt = fields.dueAt === localInput(current.dueAt) ? current.dueAt : fields.dueAt === '' ? null : new Date(`${fields.dueAt}:00+07:00`);
  const expected = { title: fields.title.trim(), priority: fields.priority, dueAt };
  const changedFields = ['title', 'priority', 'dueAt'].filter((key) => key === 'dueAt' ? iso(current.dueAt) !== iso(dueAt) : current[key] !== expected[key]);
  const reportBefore = {}; const healthBefore = {};
  for (const key of reportActors) {
    healthBefore[key] = await health(key);
    if (verifyReports) reportBefore[key] = await report(key);
  }
  const now = new Date(); const fullBefore = await snapshot();
  const stable = hash(await businessRows(taskId, ['title', 'priority', 'dueAt', 'updatedAt']));
  const oldAudits = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
  const response = await submit(actor, page.path, form, {
    ...fields, actorId: users.salesB.id, customerId: customers.foreign.id, assignedToId: users.salesB.id,
    status: 'DONE', completedAt: '2000-01-01T00:00:00.000Z', createdAt: '1900-01-01T00:00:00.000Z',
    customerAssignedSalesId: users.salesB.id, nextContactAt: '2099-01-01T12:00', lastContactAt: '2099-01-01T12:00',
    teamId: teamIds[1], description: 'Forged private description', role: 'SUPER_ADMIN', updatedAt: '1900-01-01T00:00:00.000Z',
  });
  const after = await prisma.customerTask.findUniqueOrThrow({ where: { id: taskId } });
  check(response.status === 200 && after.title === expected.title && after.priority === expected.priority && iso(after.dueAt) === iso(dueAt), `${label}: exact canonical planning fields persisted via ${surfaceName}`);
  check(stable === hash(await businessRows(taskId, ['title', 'priority', 'dueAt', 'updatedAt'])), `${label}: task identity/assignee/status/completion/description, every customer/contact/activity/team/user and unrelated task preserved`);
  const audits = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }); const oldIds = new Set(oldAudits.map((row) => row.id)); const additions = audits.filter((row) => !oldIds.has(row.id));
  check(additions.length === Number(changedFields.length > 0) && hash(audits.filter((row) => oldIds.has(row.id))) === hash(oldAudits), `${label}: exactly one audit per change and all historical audits immutable`);
  if (changedFields.length) {
    const audit = additions[0]; const metadata = { customerId: customer.id, taskId, changedFields, previousPriority: current.priority,
      priority: expected.priority, previousDueAt: iso(current.dueAt), dueAt: iso(dueAt) };
    check(audit.action === 'CUSTOMER_TASK_PLAN_UPDATE' && audit.entityType === 'CustomerTask' && audit.entityId === taskId && audit.actorId === users[actor].id
      && hash(Object.keys(audit.metadata).sort()) === hash(Object.keys(metadata).sort()) && Object.keys(metadata).every((key) => hash(audit.metadata[key]) === hash(metadata[key])), `${label}: exact privacy-safe actor/IDs/changedFields/old-new date-priority audit without title or secrets`);
    check(after.updatedAt.getTime() > current.updatedAt.getTime() && after.updatedAt.getTime() >= now.getTime() - 1000, `${label}: real change advances Prisma task version`);
  } else check(fullBefore === await snapshot(), `${label}: complete no-op, including updatedAt and zero audit`);
  const refreshed = await surface(actor, customer, surfaceName); const refreshedForm = planningForm(refreshed.html, taskId);
  check(inputValue(refreshedForm, 'title') === after.title && inputValue(refreshedForm, 'expectedUpdatedAt') === iso(after.updatedAt), `${label}: refreshed title/version are the committed values`);
  if (expected.title.includes('<script')) check(refreshed.html.includes('&lt;script') && !refreshed.html.includes('<script data-crm-task-verifier='), `${label}: HTML-looking title is escaped plain text`);
  for (const key of reportActors) {
    check(healthBefore[key] === await health(key), `${label}: ${key} all CRM-012 contact-health counts unchanged`);
    if (verifyReports) {
      const result = await report(key); const visible = (await scopedCustomerIds(key)).has(customer.id);
      const previousDue = dueCounts(current.dueAt, now); const nextDue = dueCounts(dueAt, now);
      for (const metric of ['overdue', 'today']) check(result.metrics[metric] === reportBefore[key].metrics[metric] + (visible ? nextDue[metric] - previousDue[metric] : 0), `${label}: ${key} exact scoped report ${metric} delta`);
      check(result.stable === reportBefore[key].stable, `${label}: ${key} other report metrics/distributions/workload/ownership/pagination unchanged`);
      const membership = await prisma.salesTeamMember.findUnique({ where: { userId: customer.assignedSalesId ?? '' } });
      check(result.rows.length === reportBefore[key].rows.length && result.rows.every((row) => {
        const beforeRow = reportBefore[key].rows.find((entry) => entry.kind === row.kind && entry.id === row.id);
        const group = row.kind === 'sales' ? customer.assignedSalesId ?? 'none' : membership?.teamId ?? 'none';
        const delta = visible && row.id === group ? nextDue.overdue - previousDue.overdue : 0;
        return beforeRow && row.overdue === beforeRow.overdue + delta;
      }), `${label}: ${key} overdue workload delta belongs to current customer owner/team, never task assignee`);
      if (!visible || !changedFields.includes('dueAt')) check(result.full === reportBefore[key].full, `${label}: ${key} complete report unchanged for foreign or title/priority-only edit`);
    }
  }
  return after;
}
async function rejected(actor, path, form, fields, label, kind = 'validation') {
  const before = await snapshot(); const response = await submit(actor, path, form, fields);
  check(kind === 'role' ? response.status === 303 && response.location === '/dashboard'
    : kind === 'inactive' ? response.status === 303 && ['/dang-nhap', '/dashboard'].includes(response.location)
      : kind === 'scope' ? [200, 404].includes(response.status) : response.status === 200, `${label}: safe rejected response`);
  if (!['role', 'inactive', 'scope', 'terminal'].includes(kind)) check(/role="alert"/.test(response.html), `${label}: handled error is shown, not a success/no-op`);
  check(before === await snapshot(), `${label}: zero task/customer/contact/activity/team/user/audit mutation`);
}
async function createUser(key, role = 'CLIENT') {
  const user = await prisma.user.create({ data: { id: `${marker}-${key}`, email: `${marker}-${key.toLowerCase()}@example.test`, name: `${marker} ${key}`, password: passwordHash, role } });
  userIds.push(user.id); users[key] = user; return user;
}
async function createCustomer(key, assignedSalesId) {
  const user = await createUser(`customer-${key}`);
  const customer = await prisma.customerProfile.create({ data: { userId: user.id, customerCode: `${marker}-${key}`, assignedSalesId,
    status: 'LEAD', priority: 'HIGH', note: 'Preserve customer note', source: 'verification', lastContactAt: new Date('2020-01-01T00:00:00Z'), nextContactAt: new Date('2030-01-01T00:00:00Z') } });
  customers[key] = customer; return customer;
}
async function createTask(key, customer, data = {}) {
  const task = await prisma.customerTask.create({ data: { customerId: customer.id, assignedToId: users.salesB.id, createdById: users.admin.id,
    title: `${marker} ${key}`, description: 'Preserve private task description', priority: 'MEDIUM', status: 'TODO',
    updatedAt: new Date('2001-01-01T00:00:00.000Z'), ...data } });
  tasks[key] = task; return task;
}

try {
  baseline = await snapshot(); passwordHash = await bcrypt.hash(password, 10);
  for (const [key, role] of Object.entries({ super: 'SUPER_ADMIN', admin: 'ADMIN', manager: 'MANAGER', managerA: 'SALES_MANAGER', managerB: 'SALES_MANAGER', salesA: 'SALES', salesPeer: 'SALES', salesB: 'SALES', client: 'CLIENT', creator: 'CREATOR', analyst: 'ANALYST', employee: 'EMPLOYEE' })) {
    sessions[key] = await login(await createUser(key, role));
  }
  for (const [key, manager, sales] of [['A', 'managerA', ['salesA', 'salesPeer']], ['B', 'managerB', ['salesB']]]) {
    const team = await prisma.salesTeam.create({ data: { name: `${marker}-${key}`, managerId: users[manager].id } }); teamIds.push(team.id);
    await prisma.salesTeamMember.createMany({ data: sales.map((actor) => ({ teamId: team.id, userId: users[actor].id })) });
  }
  await createCustomer('own', users.salesA.id); await createCustomer('peer', users.salesPeer.id);
  await createCustomer('foreign', users.salesB.id); await createCustomer('unowned', null);
  const future = localInput(new Date(Date.now() + 3 * day)); const past = localInput(new Date(Date.now() - 2 * day));
  const vietnam = new Date(Date.now() + offset); const today = Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()) - offset;
  const todayInput = localInput(new Date(today + 12 * 3_600_000));
  await createTask('own', customers.own, { dueAt: new Date(`${future}:37.456+07:00`) });
  await createTask('peer', customers.peer, { assignedToId: users.salesA.id });
  await createTask('foreign', customers.foreign, { assignedToId: users.salesA.id, dueAt: new Date(`${past}:00+07:00`) });
  await createTask('unowned', customers.unowned, { assignedToId: users.salesA.id });
  await createTask('done', customers.own, { status: 'DONE', completedAt: new Date('2021-01-01T00:00:00Z'), dueAt: new Date(`${past}:00+07:00`) });
  await createTask('cancelled', customers.own, { status: 'CANCELLED', dueAt: null });
  await prisma.customerActivity.create({ data: { customerId: customers.own.id, actorId: users.salesB.id, type: 'NOTE', title: 'Historical activity', content: 'Preserve original activity content' } });
  await prisma.customerActivity.create({ data: { customerId: customers.foreign.id, actorId: users.salesA.id, type: 'CALL', title: 'Foreign activity', content: 'Actor is not customer authorization' } });

  for (const actor of ['super', 'admin', 'manager', 'managerA', 'salesA']) for (const name of ['detail', 'workbench']) await surface(actor, customers.own, name);
  for (const actor of ['super', 'admin', 'manager']) await surface(actor, customers.foreign);
  await surface('managerA', customers.peer);
  for (const actor of ['salesA', 'managerA']) {
    const before = await snapshot(); const denied = await request(sessions[actor], detailPath(customers.foreign));
    check(denied.status === 404 && !denied.html.includes(tasks.foreign.title), `${actor}: foreign customer task remains hidden despite own task assignment/activity actor`);
    const page = await request(sessions[actor], workbenchPath({ salesId: users.salesA.id, teamId: teamIds[1] }));
    check(page.status === 200 && !taskIds(page.html).includes(tasks.foreign.id) && !page.html.includes(tasks.foreign.title), `${actor}: forged assignee/team workbench filters cannot reveal foreign task`);
    check(before === await snapshot(), `${actor}: foreign read checks do not mutate data`);
  }
  const authorized = await surface('admin', customers.own); const form = planningForm(authorized.html, tasks.own.id);
  const choices = [...form.matchAll(/<option\b[^>]*>/g)].map(([tag]) => attribute(tag, 'value')).filter(Boolean);
  check(hash(choices.sort()) === hash(Object.values(CustomerTaskPriority).sort()), 'planning form offers exactly every real CustomerTaskPriority');
  for (const actor of ['client', 'creator', 'analyst', 'employee']) {
    for (const path of [detailPath(customers.own), workbenchPath()]) {
      const before = await snapshot(); const denied = await request(sessions[actor], path);
      check(denied.status === 307 && denied.location === '/dashboard' && before === await snapshot(), `${actor}: task read route denied without mutation`);
    }
  }
  for (const actor of ['manager', 'client', 'creator', 'analyst', 'employee']) await rejected(actor, detailPath(customers.own), form, fieldsFor(tasks.own), `${actor}: stolen planning form`, 'role');

  await changePlan('super', tasks.own.id, { title: `  ${marker}-renamed-search Nguyễn Ánh 🙂 e\u0301  ` }, 'Unicode title-only preserves subminute dueAt', 'detail', true);
  for (const priority of Object.values(CustomerTaskPriority)) await changePlan('admin', tasks.own.id, { priority }, `priority ${priority}`, 'workbench', true);
  await changePlan('managerA', tasks.peer.id, { title: `${marker} team peer task`, priority: 'HIGH', dueAt: past }, 'manager peer combined past-due edit', 'detail', true);
  await changePlan('salesA', tasks.own.id, { dueAt: past }, 'Sales owner edits foreign-assignee task deadline to past', 'workbench', true);
  await assertFilters('salesA', await prisma.customerTask.findUniqueOrThrow({ where: { id: tasks.own.id } }));
  await changePlan('salesA', tasks.own.id, { dueAt: todayInput }, 'due today report delta', 'detail', true);
  await changePlan('salesA', tasks.own.id, { dueAt: future }, 'future due date removes overdue/today report counts', 'workbench', true);
  await changePlan('salesA', tasks.own.id, { title: `${marker} combined clear`, priority: 'LOW', dueAt: '' }, 'combined title/priority/explicit due clear', 'detail', true);
  await changePlan('salesA', tasks.own.id, {}, 'canonical no-op clear-null', 'workbench', true);
  await changePlan('salesA', tasks.own.id, { title: 'Đ'.repeat(160) }, 'exact 160-unit title boundary');
  await changePlan('salesA', tasks.own.id, { title: '🙂'.repeat(80) }, 'exact 160 UTF-16 astral title boundary');
  await changePlan('salesA', tasks.own.id, { title: `${marker} <script data-crm-task-verifier="text">alert(1)</script>` }, 'HTML-looking title safety', 'workbench');
  await assertFilters('salesA', await prisma.customerTask.findUniqueOrThrow({ where: { id: tasks.own.id } }));
  for (const dueAt of ['1900-01-01T00:00', '2100-12-31T23:59', '2024-02-29T00:00']) await changePlan('salesA', tasks.own.id, { dueAt }, `accepted task date boundary ${dueAt}`);
  await changePlan('salesA', tasks.own.id, { dueAt: past }, 'overdue task remains representable');
  await changePlan('salesA', tasks.own.id, {}, 'unchanged overdue date is a valid no-op');

  const current = await prisma.customerTask.findUniqueOrThrow({ where: { id: tasks.own.id } });
  const valid = fieldsFor(current); const validationForm = planningForm((await surface('salesA', customers.own)).html, current.id);
  for (const key of ['taskId', 'title', 'priority', 'dueAt', 'expectedUpdatedAt']) {
    for (const [value, label] of [[null, 'missing'], [[valid[key], valid[key]], 'repeated identical'], [[valid[key], 'forged'], 'repeated different'], [new File(['text'], `${key}.txt`), 'file']]) {
      await rejected('salesA', detailPath(customers.own), validationForm, { ...valid, [key]: value }, `${key}: ${label}`);
    }
  }
  const invalids = {
    taskId: ['', ' ', '../bad', 'x'.repeat(192), 'task\n', `${marker}-missing`],
    title: ['', ' \t\r\n ', 'x'.repeat(161), '🙂'.repeat(81), 'hello\u0000world', 'hello\u0001world', 'hello\u007fworld'],
    priority: ['', 'urgent', ' URGENT', 'HIGH ', 'CRITICAL', 'HIGH\n'],
    dueAt: [' ', 'bad', '2030-02-30T12:00', '2030-13-01T12:00', '2030-01-01T24:00', '2030-01-01T12:60', `${future}Z`, `${future}:00`, `${future}+07:00`, `${future} `, `${future}\n`, '1899-12-31T23:59', '2101-01-01T00:00', '9999-12-31T23:59'],
    expectedUpdatedAt: ['', ' ', 'bad', '2026-02-30T12:00:00.000Z', iso(current.updatedAt).replace(/\.\d{3}Z$/, 'Z'), `${iso(current.updatedAt)} `, '2026-09-15T12:00:00+07:00', '2026-09-15T12:00', '1900-01-01T00:00:00.000Z'],
  };
  for (const [key, values] of Object.entries(invalids)) for (let index = 0; index < values.length; index += 1) await rejected('salesA', detailPath(customers.own), validationForm, { ...valid, [key]: values[index] }, `${key}: invalid or stale case ${index + 1}`);
  for (const actor of ['salesA', 'managerA']) for (const task of [tasks.foreign, tasks.unowned]) await rejected(actor, detailPath(customers.own), validationForm, { ...fieldsFor(task), title: 'Forbidden foreign edit' }, `${actor}: customer scope excludes foreign/unowned task despite own assignee`);
  for (const task of [tasks.done, tasks.cancelled]) await rejected('admin', detailPath(customers.own), validationForm, { ...fieldsFor(task), title: 'Do not reopen terminal task' }, `${task.status}: terminal task planning rejected`);
  for (const status of ['SUSPENDED', 'DISABLED', 'INVITED']) {
    await prisma.user.update({ where: { id: users.salesA.id }, data: { status } });
    await rejected('salesA', detailPath(customers.own), validationForm, valid, `${status}: stale session cannot plan`, 'inactive');
    await prisma.user.update({ where: { id: users.salesA.id }, data: { status: 'ACTIVE' } });
  }
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'CLIENT' } });
  await rejected('salesA', detailPath(customers.own), validationForm, valid, 'demoted Sales cannot use old task plan form', 'role');
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'SALES' } });

  // Sequential stale-version tests use real CRM-009 and CRM-013 actions, not simulated responses.
  for (const status of ['IN_PROGRESS', 'DONE']) {
    const old = await prisma.customerTask.findUniqueOrThrow({ where: { id: tasks.own.id } });
    const page = await surface('salesA', customers.own); const oldForm = planningForm(page.html, old.id);
    const changed = await submit('salesA', page.path, identifiedForm(page.html, 'taskId', old.id), { taskId: old.id, status });
    const after = await prisma.customerTask.findUniqueOrThrow({ where: { id: old.id } });
    check(changed.status === 200 && after.status === status && iso(after.updatedAt) !== iso(old.updatedAt) && (status !== 'DONE' || after.completedAt !== null), `real CRM-009 transition to ${status} produces newer task version`);
    await rejected('salesA', page.path, oldForm, { ...fieldsFor(old), title: 'Stale plan must not revert CRM-009 status' }, `${status}: old plan version cannot overwrite status/completedAt`, status === 'DONE' ? 'terminal' : 'validation');
    if (status === 'DONE') {
      const terminal = await surface('salesA', customers.own);
      check((await submit('salesA', terminal.path, identifiedForm(terminal.html, 'taskId', old.id), { taskId: old.id, status: 'TODO' })).status === 200, 'CRM-009 alone reopens fixture task for remaining checks');
    }
  }
  const versionA = await prisma.customerTask.findUniqueOrThrow({ where: { id: tasks.own.id } });
  const formA = planningForm((await surface('salesA', customers.own)).html, versionA.id);
  const versionB = await changePlan('salesA', versionA.id, { title: `${marker} newer valid planning edit` }, 'another planning submission changes version', 'workbench');
  await rejected('salesA', detailPath(customers.own), formA, { ...fieldsFor(versionA), title: 'Lost older draft' }, 'old planning form rejected after another successful plan');
  await rejected('salesA', detailPath(customers.own), formA, { ...fieldsFor(versionB), expectedUpdatedAt: iso(versionA.updatedAt) }, 'stale version rejected even when all planning fields now equal current values');
  const reassignedTaskForm = planningForm((await surface('salesA', customers.own)).html, versionB.id);
  await prisma.customerTask.update({ where: { id: versionB.id }, data: { assignedToId: users.salesPeer.id } });
  await rejected('salesA', detailPath(customers.own), reassignedTaskForm, { ...fieldsFor(versionB), title: 'Old task-assignment version' }, 'fixture-only task reassignment invalidates old planning version');

  // One bounded real race supplements the ordered stale tests, not an exhaustive interleaving proof.
  const racingTask = await prisma.customerTask.findUniqueOrThrow({ where: { id: tasks.own.id } });
  const racingForm = planningForm((await surface('salesA', customers.own)).html, racingTask.id);
  const racingStable = hash(await businessRows(racingTask.id, ['title', 'updatedAt']));
  const racingAudits = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
  const racingTitles = [`${marker} concurrent plan A`, `${marker} concurrent plan B`];
  const race = await Promise.all(racingTitles.map((title) => submit('salesA', detailPath(customers.own), racingForm, { ...fieldsFor(racingTask), title })));
  const raceWinner = await prisma.customerTask.findUniqueOrThrow({ where: { id: racingTask.id } });
  const raceAuditsAfter = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
  const raceOldIds = new Set(racingAudits.map((audit) => audit.id)); const raceAdditions = raceAuditsAfter.filter((audit) => !raceOldIds.has(audit.id));
  check(race.every((response) => response.status === 200) && race.filter((response) => /role="alert"/.test(response.html)).length === 1,
    'two concurrent requests sharing one version produce one success and one handled stale/conflict response');
  check(racingTitles.includes(raceWinner.title) && raceWinner.updatedAt.getTime() > racingTask.updatedAt.getTime()
    && racingStable === hash(await businessRows(racingTask.id, ['title', 'updatedAt'])), 'concurrent winner changes only title/version, never task status/ownership/contact/activity');
  const raceAudit = raceAdditions[0]; const raceMetadata = { customerId: customers.own.id, taskId: racingTask.id, changedFields: ['title'],
    previousPriority: racingTask.priority, priority: racingTask.priority, previousDueAt: iso(racingTask.dueAt), dueAt: iso(racingTask.dueAt) };
  check(raceAdditions.length === 1 && hash(raceAuditsAfter.filter((audit) => raceOldIds.has(audit.id))) === hash(racingAudits)
    && raceAudit?.actorId === users.salesA.id && raceAudit.action === 'CUSTOMER_TASK_PLAN_UPDATE' && raceAudit.entityType === 'CustomerTask' && raceAudit.entityId === racingTask.id
    && hash(Object.keys(raceAudit.metadata).sort()) === hash(Object.keys(raceMetadata).sort()) && Object.keys(raceMetadata).every((key) => hash(raceAudit.metadata[key]) === hash(raceMetadata[key])),
  'concurrent requests append exactly one privacy-safe planning audit and preserve all historical audits');

  const assignmentPage = await request(sessions.admin, '/sales/assignment');
  const assignmentForm = identifiedForm(assignmentPage.html, 'customerId', customers.own.id);
  const scopeTask = await prisma.customerTask.findUniqueOrThrow({ where: { id: tasks.own.id } });
  const scopeForm = planningForm((await surface('salesA', customers.own)).html, scopeTask.id);
  const assignment = await submit('admin', '/sales/assignment', assignmentForm, { customerId: customers.own.id, salesId: users.salesB.id });
  check(assignment.status === 200 && (await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.own.id } })).assignedSalesId === users.salesB.id, 'existing assignment action reassigns fixture customer');
  for (const actor of ['salesA', 'managerA']) await rejected(actor, detailPath(customers.own), scopeForm, { ...fieldsFor(scopeTask), title: 'Forbidden after customer reassignment' }, `${actor}: completed customer reassignment invalidates stale form`, 'scope');
  await changePlan('salesB', scopeTask.id, { title: `${marker} new owner plans task` }, 'new customer owner edits task assigned to another Sales');
  check((await submit('admin', '/sales/assignment', assignmentForm, { customerId: customers.own.id, salesId: users.salesA.id })).status === 200, 'existing assignment workflow restores fixture customer owner');

  const peerTask = await prisma.customerTask.findUniqueOrThrow({ where: { id: tasks.peer.id } });
  const peerForm = planningForm((await surface('managerA', customers.peer)).html, peerTask.id);
  const membership = await prisma.salesTeamMember.findUniqueOrThrow({ where: { userId: users.salesPeer.id } });
  const teamPath = `/sales/teams/${teamIds[0]}`;
  const removalForm = identifiedForm((await request(sessions.admin, teamPath)).html, 'membershipId', membership.id);
  const beforeWarning = await snapshot(); const warning = await submit('admin', teamPath, removalForm, {});
  check(warning.status === 200 && beforeWarning === await snapshot(), 'CRM-008 membership removal first warns without any mutation');
  const confirmationForm = identifiedForm(warning.html, 'membershipId', membership.id); const token = inputValue(confirmationForm, 'confirmationToken');
  check(Boolean(token), 'CRM-008 warning provides genuine signed confirmation token');
  const peerBefore = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.peer.id } });
  const tasksBeforeRemoval = hash(await prisma.customerTask.findMany({ orderBy: { id: 'asc' } }));
  const removal = await submit('admin', teamPath, confirmationForm, { confirmationToken: token, confirmation: 'REMOVE_MEMBERSHIP_KEEP_ASSIGNMENTS' });
  check(removal.status === 200 && await prisma.salesTeamMember.count({ where: { id: membership.id } }) === 0, 'real explicitly confirmed CRM-008 removal succeeds');
  check(hash(peerBefore) === hash(await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.peer.id } })) && tasksBeforeRemoval === hash(await prisma.customerTask.findMany({ orderBy: { id: 'asc' } })), 'team removal preserves customer ownership/contact plan and all tasks');
  await rejected('managerA', detailPath(customers.peer), peerForm, { ...fieldsFor(peerTask), title: 'Forbidden after membership removal' }, 'completed membership removal revokes manager task planning', 'scope');
  await changePlan('salesPeer', peerTask.id, { title: `${marker} own customer remains editable after team removal` }, 'Sales retains customer task write after membership removal');

  // CRM-012 scheduling remains an independent audited mutation with no task effects.
  for (const operation of ['SET', 'CLEAR']) {
    const response = await request(sessions.salesA, detailPath(customers.own));
    const contactForm = forms(response.html).find((entry) => attribute(entry, 'data-contact-plan-form') === operation);
    check(Boolean(contactForm), `${operation}: existing customer contact-plan form available`);
    const before = hash(await prisma.customerTask.findMany({ orderBy: { id: 'asc' } }));
    const activities = hash(await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } }));
    const last = iso((await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.own.id } })).lastContactAt);
    const changed = await submit('salesA', detailPath(customers.own), contactForm, { customerId: customers.own.id, operation, nextContactAt: operation === 'CLEAR' ? null : future, taskId: tasks.own.id, dueAt: '1900-01-01T00:00' });
    const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.own.id } });
    check(changed.status === 200 && iso(profile.nextContactAt) === (operation === 'CLEAR' ? null : new Date(`${future}:00+07:00`).toISOString()), `${operation}: existing CRM-012 plan mutation persists independently`);
    check(before === hash(await prisma.customerTask.findMany({ orderBy: { id: 'asc' } })) && activities === hash(await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } })) && iso(profile.lastContactAt) === last, `${operation}: contact scheduling cannot create/edit tasks, dueAt, actual contact or activity history`);
  }
  // Creation remains its established owner-derived assignment workflow, separate from editing.
  const creationPage = await request(sessions.salesA, detailPath(customers.own));
  const createForm = forms(creationPage.html).find((entry) => /name="description"/.test(entry) && inputValue(entry, 'customerId') === customers.own.id);
  check(Boolean(createForm), 'existing task creation form retained separately');
  const beforeTaskIds = new Set((await prisma.customerTask.findMany({ select: { id: true } })).map((task) => task.id));
  const create = await submit('salesA', detailPath(customers.own), createForm, { customerId: customers.own.id, title: `${marker} original create flow`, description: 'Original create description', priority: 'URGENT', dueAt: future, assignedToId: users.salesB.id });
  const created = (await prisma.customerTask.findMany()).filter((task) => !beforeTaskIds.has(task.id));
  check(create.status === 200 && created.length === 1 && created[0].assignedToId === users.salesA.id && created[0].createdById === users.salesA.id && created[0].customerId === customers.own.id && created[0].status === 'TODO' && created[0].completedAt === null, 'original create flow retains authorized customer-owner assignment and task status semantics');
  for (const path of ['/sales', '/sales/customers', detailPath(customers.own), '/sales/assignment', '/sales/teams', teamPath, '/sales/pipeline', '/sales/follow-ups', '/sales/reports']) {
    check((await request(sessions.admin, path)).status === 200, `regression route ${path.includes(customers.own.id) ? '/sales/customers/[id]' : path.includes(teamIds[0]) ? '/sales/teams/[id]' : path}`);
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
    if (baseline) check(baseline === await snapshot(), 'cleanup: original task/customer/contact/activity/team/user/audit snapshot exactly restored');
  } finally { await prisma.$disconnect(); }
}
console.log(`TASK PLAN VERIFICATION COMPLETE: ${assertions} assertions passed`);
