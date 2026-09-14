import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

// Opt-in, loopback development/test fixtures only. No seeds, migrations or repairs.
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
const marker = `crm012-${randomUUID()}`; const password = randomUUID();
const users = {}; const sessions = {}; const customers = {}; const userIds = []; const teamIds = [];
const day = 86_400_000; const offset = 7 * 3_600_000;
const states = ['overdue', 'today', 'upcoming', 'none'];
const userSelect = { id: true, email: true, name: true, role: true, status: true, phone: true, lastLoginAt: true, createdAt: true, updatedAt: true };
let baseline; let passwordHash; let assertions = 0;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = (value) => value?.toISOString() ?? null;
const localInput = (value) => new Date(value.getTime() + offset).toISOString().slice(0, 16);
const futureInput = (days = 3) => localInput(new Date(Date.now() + days * day));
function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  assertions += 1; console.log(`PASS: ${label}`);
}
async function businessRows(customerId, allowedFields = []) {
  const profiles = await prisma.customerProfile.findMany({ orderBy: { id: 'asc' } });
  const rows = [profiles.map((profile) => {
    if (profile.id !== customerId) return profile;
    const stable = { ...profile }; for (const field of allowedFields) delete stable[field]; return stable;
  })];
  rows.push(...await Promise.all(['customerTask', 'salesTeam', 'salesTeamMember'].map((model) => prisma[model].findMany({ orderBy: { id: 'asc' } }))));
  rows.push(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: userSelect }));
  return rows;
}
async function snapshot() {
  return hash([await businessRows(), await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } }), await prisma.auditLog.findMany({ orderBy: { id: 'asc' } })]);
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
function inputValue(form, name) {
  const input = [...form.matchAll(/<input\b[^>]*>/g)].map(([tag]) => tag).find((tag) => attribute(tag, 'name') === name);
  return input ? attribute(input, 'value') : undefined;
}
function identifiedForm(html, name, id) {
  const form = forms(html).find((entry) => inputValue(entry, name) === id);
  if (!form) throw new Error('Expected rendered fixture action form');
  return form;
}
function planForm(html, operation) {
  const form = forms(html).find((entry) => attribute(entry, 'data-contact-plan-form') === operation);
  if (!form) throw new Error(`Expected rendered ${operation} contact plan form`);
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
const detailPath = (customer) => `/sales/customers/${customer.id}`;
function categories(value, now) {
  if (value === null) return ['none'];
  const vietnam = new Date(now.getTime() + offset);
  const start = Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()) - offset;
  return states.filter((state) => state === 'overdue' ? value < now : state === 'today'
    ? value.getTime() >= start && value.getTime() < start + day : state === 'upcoming' && value >= now);
}
async function scopedProfiles(actor) {
  // Independent JS oracle: never imports production scope/query/date helpers.
  const [profiles, memberships, teams] = await Promise.all([
    prisma.customerProfile.findMany({ orderBy: { id: 'asc' } }), prisma.salesTeamMember.findMany(), prisma.salesTeam.findMany(),
  ]);
  const user = users[actor];
  if (['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user.role)) return profiles;
  const managed = new Set(teams.filter((team) => team.managerId === user.id).map((team) => team.id));
  const allowedSales = new Set(memberships.filter((member) => managed.has(member.teamId)).map((member) => member.userId));
  return profiles.filter((profile) => user.role === 'SALES_MANAGER' ? allowedSales.has(profile.assignedSalesId) : profile.assignedSalesId === user.id);
}
async function health(actor, path = '/sales') {
  const before = await snapshot(); const now = new Date(); const response = await request(sessions[actor], path);
  check(response.status === 200, `${actor}: dashboard contact health available`);
  const expected = Object.fromEntries(states.map((state) => [state, 0]));
  for (const customer of await scopedProfiles(actor)) for (const state of categories(customer.nextContactAt, now)) expected[state] += 1;
  const tags = [...response.html.matchAll(/<[^>]*\bdata-contact-health="[^"]*"[^>]*>/g)].map(([tag]) => tag);
  const actual = Object.fromEntries(tags.map((tag) => [attribute(tag, 'data-contact-health'), Number(attribute(tag, 'data-count'))]));
  check(tags.length === 4 && states.every((state) => actual[state] === expected[state]), `${actor}: all four counts equal independently scoped all-status snapshot`);
  for (const state of states) {
    const card = tags.find((tag) => attribute(tag, 'data-contact-health') === state);
    const link = new URL(attribute(card ?? '', 'href'), base);
    check(link.pathname === '/sales/customers' && link.searchParams.get('followUp') === state, `${actor}: ${state} card's own drill-down uses the matching existing CRM filter`);
  }
  check(before === await snapshot(), `${actor}: contact health GET is read-only`);
  return actual;
}
async function detail(actor, customer) {
  const before = await snapshot();
  const response = await request(sessions[actor], detailPath(customer));
  check(response.status === 200, `${actor}: authorized contact planning detail`);
  const stored = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customer.id } });
  const wrapper = [...response.html.matchAll(/<[^>]*\bdata-contact-planning="[^"]*"[^>]*>/g)].map(([tag]) => tag)[0];
  check(wrapper && attribute(wrapper, 'data-last-contact') === (iso(stored.lastContactAt) ?? '')
    && attribute(wrapper, 'data-next-contact') === (iso(stored.nextContactAt) ?? ''), `${actor}: separate actual-contact and planned-contact values`);
  const badgeStates = [...response.html.matchAll(/\bdata-contact-state="([^"]*)"/g)].map(([, value]) => value);
  check(hash(badgeStates) === hash(categories(stored.nextContactAt, new Date())), `${actor}: canonical overlapping contact-state badges`);
  const canWrite = ['SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES'].includes(users[actor].role);
  check(forms(response.html).filter((form) => /data-contact-plan-form=/.test(form)).length === (canWrite ? 2 : 0), `${actor}: SET/CLEAR controls follow write permission`);
  if (canWrite) {
    const set = planForm(response.html, 'SET'); const clear = planForm(response.html, 'CLEAR');
    check(inputValue(set, 'customerId') === customer.id && inputValue(set, 'operation') === 'SET'
      && inputValue(clear, 'customerId') === customer.id && inputValue(clear, 'operation') === 'CLEAR', `${actor}: explicit target and operation in both forms`);
    check(inputValue(set, 'nextContactAt') === (stored.nextContactAt ? localInput(stored.nextContactAt) : '')
      && !/name="nextContactAt"/.test(clear), `${actor}: UTC+7 minute input and date-free CLEAR form`);
  }
  check(before === await snapshot(), `${actor}: planning detail GET is read-only`);
  return response;
}
async function list(actor, state) {
  const response = await request(sessions[actor], `/sales/customers?${new URLSearchParams({ q: marker, followUp: state })}`);
  const ids = [...response.html.matchAll(/href="\/sales\/customers\/([^"?]+)"/g)].map(([, id]) => decodeHtml(id));
  const expected = (await scopedProfiles(actor)).filter((customer) => customer.customerCode.startsWith(marker) && categories(customer.nextContactAt, new Date()).includes(state)).map((customer) => customer.id);
  check(response.status === 200 && hash([...new Set(ids)].sort()) === hash(expected.sort()), `${actor}: existing customer ${state} filter has exact fixture set`);
}
async function reportFingerprint(actor) {
  const response = await request(sessions[actor], '/sales/reports?period=7d');
  const tags = [...response.html.matchAll(/<[^>]*\bdata-report-[\w-]+="[^"]*"[^>]*>/g)].map(([tag]) => tag);
  check(response.status === 200 && tags.some((tag) => attribute(tag, 'data-report-metric') === 'activities'), `${actor}: existing reports available`);
  return hash(tags.map((tag) => [...tag.matchAll(/\bdata-[\w-]+="[^"]*"/g)].map(([value]) => value).sort()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
async function workbenchFingerprint() {
  const response = await request(sessions.admin, `/sales/follow-ups?${new URLSearchParams({ q: marker })}`);
  const tags = [...response.html.matchAll(/<[^>]*\bdata-(?:task-id|metric)="[^"]*"[^>]*>/g)].map(([tag]) => tag);
  check(response.status === 200 && tags.some((tag) => attribute(tag, 'data-metric') === 'open'), 'existing follow-up workbench and task metrics available');
  return hash(tags.map((tag) => [...tag.matchAll(/\bdata-[\w-]+="[^"]*"/g)].map(([value]) => value).sort()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
async function changePlan(actor, customer, operation, value, verifyReports = false) {
  const reportActors = ['admin', 'managerA', 'salesA', 'salesB']; const reports = {};
  if (verifyReports) for (const key of reportActors) reports[key] = await reportFingerprint(key);
  const workbenchBefore = verifyReports ? await workbenchFingerprint() : null;
  const current = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customer.id } });
  const next = operation === 'CLEAR' ? null : new Date(`${value}:00+07:00`);
  const changed = iso(current.nextContactAt) !== iso(next);
  const page = await detail(actor, customer); const fullBefore = await snapshot();
  const stable = hash(await businessRows(customer.id, ['nextContactAt', 'updatedAt']));
  const activities = hash(await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } }));
  const oldAudits = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
  const response = await submit(actor, detailPath(customer), planForm(page.html, operation), {
    customerId: customer.id, operation, nextContactAt: operation === 'CLEAR' ? null : value,
    actorId: users.salesB.id, assignedSalesId: users.salesB.id, lastContactAt: '1900-01-01T00:00:00.000Z',
    status: 'CLOSED', priority: 'LOW', assignedToId: users.salesB.id, teamId: teamIds[1], taskId: `${marker}-fake-task`,
  });
  const after = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customer.id } });
  check(response.status === 200 && iso(after.nextContactAt) === iso(next), `${actor} ${operation}: exact UTC+7 plan persisted`);
  check(stable === hash(await businessRows(customer.id, ['nextContactAt', 'updatedAt'])), `${actor} ${operation}: last contact, ownership, roles, all tasks/teams and unrelated customer fields preserved`);
  check(activities === hash(await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } })), `${actor} ${operation}: no real or synthetic activity created/modified`);
  const audits = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }); const oldIds = new Set(oldAudits.map((row) => row.id));
  const additions = audits.filter((row) => !oldIds.has(row.id));
  check(additions.length === Number(changed) && hash(audits.filter((row) => oldIds.has(row.id))) === hash(oldAudits), `${actor} ${operation}: exact audit delta; historical audits immutable`);
  if (changed) {
    const audit = additions[0]; const metadata = { customerId: customer.id, previousNextContactAt: iso(current.nextContactAt), nextContactAt: iso(next), operation };
    check(audit.actorId === users[actor].id && audit.action === 'CUSTOMER_NEXT_CONTACT_UPDATE' && audit.entityType === 'CustomerProfile' && audit.entityId === customer.id
      && hash(Object.keys(audit.metadata).sort()) === hash(Object.keys(metadata).sort()) && Object.keys(metadata).every((key) => audit.metadata[key] === metadata[key]), `${actor} ${operation}: exact actor, old/new UTC identifiers and operation-only audit metadata`);
  } else check(fullBefore === await snapshot(), `${actor} ${operation}: complete no-op, including updatedAt and all audit rows`);
  await detail(actor, customer);
  for (const state of states) await list(actor, state);
  if (verifyReports) for (const key of reportActors) check(reports[key] === await reportFingerprint(key), `${actor} ${operation}: ${key} all report metrics/distributions/workload/pagination unchanged`);
  if (verifyReports) check(workbenchBefore === await workbenchFingerprint(), `${actor} ${operation}: existing task workbench rows and all task metrics unchanged`);
}
async function rejected(actor, customer, form, fields, label, kind = 'validation') {
  const before = await snapshot(); const response = await submit(actor, detailPath(customer), form, fields);
  check(kind === 'role' ? response.status === 303 && response.location === '/dashboard'
    : kind === 'inactive' ? response.status === 303 && ['/dang-nhap', '/dashboard'].includes(response.location)
      : kind === 'stale' ? [200, 404].includes(response.status) : response.status === 200, `${label}: safe response`);
  check(before === await snapshot(), `${label}: zero customer/task/activity/team/user/audit mutation`);
}
async function createUser(key, role = 'CLIENT') {
  const user = await prisma.user.create({ data: { id: `${marker}-${key}`, email: `${marker}-${key.toLowerCase()}@example.test`, name: `${marker} ${key}`, password: passwordHash, role } });
  userIds.push(user.id); users[key] = user; return user;
}
async function createCustomer(key, assignedSalesId, nextContactAt = null, status = 'LEAD') {
  const user = await createUser(`customer-${key}`);
  const customer = await prisma.customerProfile.create({ data: { userId: user.id, customerCode: `${marker}-${key}`, assignedSalesId,
    status, priority: 'HIGH', note: 'Preserve note', source: 'verification', lastContactAt: new Date('2020-01-01T00:00:00Z'), nextContactAt } });
  customers[key] = customer; return customer;
}

try {
  baseline = await snapshot(); passwordHash = await bcrypt.hash(password, 10);
  const roles = { super: 'SUPER_ADMIN', admin: 'ADMIN', manager: 'MANAGER', managerA: 'SALES_MANAGER', managerB: 'SALES_MANAGER', salesA: 'SALES', salesPeer: 'SALES', salesB: 'SALES', client: 'CLIENT', creator: 'CREATOR', analyst: 'ANALYST', employee: 'EMPLOYEE' };
  for (const [key, role] of Object.entries(roles)) { await createUser(key, role); sessions[key] = await login(users[key]); }
  for (const [key, manager, sales] of [['A', 'managerA', ['salesA', 'salesPeer']], ['B', 'managerB', ['salesB']]]) {
    const team = await prisma.salesTeam.create({ data: { name: `${marker}-${key}`, managerId: users[manager].id } }); teamIds.push(team.id);
    await prisma.salesTeamMember.createMany({ data: sales.map((actor) => ({ teamId: team.id, userId: users[actor].id })) });
  }
  const now = new Date(); const vietnam = new Date(now.getTime() + offset);
  const today = Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()) - offset;
  for (const [prefix, sales] of [['own', 'salesA'], ['foreign', 'salesB']]) {
    await createCustomer(`${prefix}Overdue`, users[sales].id, new Date(now.getTime() - day), 'CLOSED');
    await createCustomer(`${prefix}Today`, users[sales].id, new Date(today + 12 * 3_600_000), 'PROSPECT');
    await createCustomer(`${prefix}Upcoming`, users[sales].id, new Date(today + day + 3_600_000), 'ACTIVE');
    await createCustomer(`${prefix}None`, users[sales].id, null, 'DORMANT');
  }
  await createCustomer('dayStart', users.salesA.id, new Date(today));
  await createCustomer('dayEnd', users.salesA.id, new Date(today + day));
  await createCustomer('todayFuture', users.salesA.id, new Date(Math.floor((now.getTime() + today + day) / 2)));
  await createCustomer('target', users.salesA.id); await createCustomer('peer', users.salesPeer.id);
  await createCustomer('unowned', null);
  await prisma.customerTask.createMany({ data: [
    { customerId: customers.target.id, assignedToId: users.salesB.id, createdById: users.admin.id, title: `${marker} Own customer foreign assignee`, status: 'TODO', dueAt: new Date(now.getTime() - day) },
    { customerId: customers.foreignNone.id, assignedToId: users.salesA.id, createdById: users.salesA.id, title: `${marker} Foreign customer own assignee`, status: 'IN_PROGRESS', dueAt: new Date(now.getTime() + day) },
    { customerId: customers.target.id, assignedToId: users.salesA.id, createdById: users.admin.id, title: `${marker} Completed task`, status: 'DONE', completedAt: now, dueAt: now },
  ] });
  await prisma.customerActivity.create({ data: { customerId: customers.foreignNone.id, actorId: users.salesA.id, type: 'CALL', title: 'Historical foreign contact', content: 'Activity actor must not grant ownership.' } });

  for (const actor of ['super', 'admin', 'manager', 'managerA', 'salesA']) {
    await health(actor); await detail(actor, customers.target); for (const state of states) await list(actor, state);
  }
  for (const key of ['dayStart', 'dayEnd', 'todayFuture', 'ownOverdue', 'ownToday', 'ownUpcoming', 'ownNone']) await detail('salesA', customers[key]);
  for (const actor of ['managerA', 'salesA']) {
    const normal = await health(actor);
    check(hash(normal) === hash(await health(actor, `/sales?${new URLSearchParams({ salesId: users.salesB.id, teamId: teamIds[1], followUp: 'none' })}`)), `${actor}: forged dashboard filters cannot widen authorization`);
    const denied = await request(sessions[actor], detailPath(customers.foreignNone));
    check(denied.status === 404, `${actor}: foreign task assignee/activity actor does not grant contact access`);
  }
  const foreignBefore = {}; for (const actor of ['managerA', 'salesA']) foreignBefore[actor] = await health(actor);
  // Fixture-only change: exercise foreign movement between every dashboard category.
  for (const value of [new Date(now.getTime() - day), new Date(today + 12 * 3_600_000), new Date(today + day + 3_600_000), null]) {
    await prisma.customerProfile.update({ where: { id: customers.foreignNone.id }, data: { nextContactAt: value } });
    for (const actor of ['managerA', 'salesA']) check(hash(foreignBefore[actor]) === hash(await health(actor)), `${actor}: foreign plan category change leaves every count unchanged`);
  }

  for (const actor of ['super', 'admin', 'managerA', 'salesA']) {
    const value = futureInput(3);
    await changePlan(actor, customers.target, 'SET', value, actor === 'super');
    await changePlan(actor, customers.target, 'SET', value);
    await changePlan(actor, customers.target, 'CLEAR', null, actor === 'super');
    await changePlan(actor, customers.target, 'CLEAR', null);
  }
  await changePlan('salesA', customers.target, 'SET', futureInput(4));
  const staleForm = planForm((await detail('salesA', customers.target)).html, 'SET');
  const valid = { customerId: customers.target.id, operation: 'SET', nextContactAt: futureInput(5) };
  for (const actor of ['manager', 'client', 'creator', 'analyst', 'employee']) {
    if (actor !== 'manager') for (const path of ['/sales', detailPath(customers.target)]) {
      const denied = await request(sessions[actor], path);
      check(denied.status === 307 && denied.location === '/dashboard', `${actor}: contact dashboard/detail blocked`);
    }
    await rejected(actor, customers.target, staleForm, valid, `${actor}: stolen SET form`, 'role');
    await rejected(actor, customers.target, staleForm, { ...valid, operation: 'CLEAR', nextContactAt: null }, `${actor}: stolen CLEAR operation`, 'role');
  }
  const invalidDates = [null, '', ' ', 'not-a-date', '2030-02-30T12:00', '2030-13-01T12:00', '2030-01-01T24:00', '2030-01-01T12:60',
    `${futureInput()}Z`, `${futureInput()}:00`, `${futureInput()}+07:00`, `${futureInput()} `, `${futureInput()}\n`,
    localInput(new Date(Date.now() - day)), futureInput(1096), '9999-12-31T23:59', [futureInput(), futureInput()], new File(['date'], 'date.txt')];
  for (let index = 0; index < invalidDates.length; index += 1) await rejected('salesA', customers.target, staleForm, { ...valid, nextContactAt: invalidDates[index] }, `invalid datetime case ${index + 1}`);
  for (const [field, values] of Object.entries({
    customerId: [null, '', '../bad', 'x'.repeat(192), [customers.target.id, customers.target.id], new File(['id'], 'id.txt')],
    operation: [null, '', 'set', 'DELETE', ['SET', 'CLEAR'], new File(['SET'], 'operation.txt')],
  })) for (let index = 0; index < values.length; index += 1) await rejected('salesA', customers.target, staleForm, { ...valid, [field]: values[index] }, `${field}: invalid/repeated/file case ${index + 1}`);
  for (const value of ['', futureInput(), [futureInput(), futureInput()], new File(['date'], 'date.txt')]) {
    await rejected('salesA', customers.target, staleForm, { ...valid, operation: 'CLEAR', nextContactAt: value }, 'CLEAR must contain no date field, even blank');
  }
  for (const actor of ['salesA', 'managerA']) for (const customerId of [customers.foreignNone.id, customers.unowned.id, `${marker}-missing`]) {
    await rejected(actor, customers.target, staleForm, { ...valid, customerId }, `${actor}: foreign/unowned/missing customer rejected`);
  }
  for (const status of ['SUSPENDED', 'DISABLED', 'INVITED']) {
    await prisma.user.update({ where: { id: users.salesA.id }, data: { status } });
    await rejected('salesA', customers.target, staleForm, valid, `${status}: stale session cannot schedule`, 'inactive');
    await prisma.user.update({ where: { id: users.salesA.id }, data: { status: 'ACTIVE' } });
  }
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'CLIENT' } });
  await rejected('salesA', customers.target, staleForm, valid, 'demoted Sales cannot use old form', 'role');
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'SALES' } });

  const assignmentPage = await request(sessions.admin, '/sales/assignment');
  const assignmentForm = identifiedForm(assignmentPage.html, 'customerId', customers.target.id);
  const scheduledBeforeAssignment = (await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.target.id } })).nextContactAt;
  const assignment = await submit('admin', '/sales/assignment', assignmentForm, { customerId: customers.target.id, salesId: users.salesB.id });
  check(assignment.status === 200 && (await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.target.id } })).assignedSalesId === users.salesB.id, 'existing assignment action changes fixture owner');
  await rejected('salesA', customers.target, staleForm, valid, 'completed reassignment invalidates stale Sales contact form', 'stale');
  await rejected('managerA', customers.target, staleForm, valid, 'completed reassignment invalidates stale manager contact form', 'stale');
  for (const actor of ['salesA', 'managerA']) check((await request(sessions[actor], detailPath(customers.target))).status === 404, `${actor}: completed reassignment removes detail read access`);
  check(iso((await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.target.id } })).nextContactAt) === iso(scheduledBeforeAssignment), 'assignment and rejected stale submissions preserve existing plan');
  await changePlan('salesB', customers.target, 'SET', futureInput(6));
  check((await submit('admin', '/sales/assignment', assignmentForm, { customerId: customers.target.id, salesId: users.salesA.id })).status === 200, 'fixture reassignment restored through existing action');

  const peerForm = planForm((await detail('managerA', customers.peer)).html, 'SET');
  const membership = await prisma.salesTeamMember.findUniqueOrThrow({ where: { userId: users.salesPeer.id } });
  const teamPath = `/sales/teams/${teamIds[0]}`;
  const removalForm = identifiedForm((await request(sessions.admin, teamPath)).html, 'membershipId', membership.id);
  const removalBefore = await snapshot();
  const warning = await submit('admin', teamPath, removalForm, { teamId: teamIds[0], membershipId: membership.id });
  check(warning.status === 200 && removalBefore === await snapshot(), 'existing team removal warns without changing customer plan or membership');
  const confirmationForm = identifiedForm(warning.html, 'membershipId', membership.id);
  const token = inputValue(confirmationForm, 'confirmationToken'); check(Boolean(token), 'existing removal exposes signed confirmation');
  const peerBefore = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.peer.id } });
  const removal = await submit('admin', teamPath, confirmationForm, { teamId: teamIds[0], membershipId: membership.id, confirmationToken: token, confirmation: 'REMOVE_MEMBERSHIP_KEEP_ASSIGNMENTS' });
  check(removal.status === 200 && await prisma.salesTeamMember.count({ where: { id: membership.id } }) === 0, 'existing explicitly confirmed team removal succeeds');
  check(hash(peerBefore) === hash(await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.peer.id } })), 'team removal preserves complete customer, ownership and plan');
  await rejected('managerA', customers.peer, peerForm, { ...valid, customerId: customers.peer.id }, 'completed membership removal invalidates manager contact form', 'stale');
  check((await request(sessions.managerA, detailPath(customers.peer))).status === 404, 'completed membership removal removes manager detail read access');
  await detail('salesPeer', customers.peer);

  for (const type of ['NOTE', 'CALL', 'EMAIL', 'MEETING', 'MESSAGE']) {
    const page = await request(sessions.salesA, detailPath(customers.target));
    const form = forms(page.html).find((entry) => /data-interaction-form=/.test(entry));
    check(Boolean(form), `${type}: existing interaction form available`);
    const profileBefore = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.target.id } });
    const stable = hash(await businessRows(type === 'NOTE' ? undefined : customers.target.id, type === 'NOTE' ? [] : ['lastContactAt', 'updatedAt']));
    const beforeIds = new Set((await prisma.customerActivity.findMany({ select: { id: true } })).map((row) => row.id));
    const response = await submit('salesA', detailPath(customers.target), form, { customerId: customers.target.id, type, content: `${marker} ${type} preserves explicit plan`, nextContactAt: futureInput(8) });
    const additions = (await prisma.customerActivity.findMany()).filter((row) => !beforeIds.has(row.id));
    const profileAfter = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.target.id } });
    check(response.status === 200 && additions.length === 1 && additions[0].type === type, `${type}: real interaction action still creates the requested activity`);
    check(iso(profileAfter.nextContactAt) === iso(profileBefore.nextContactAt) && stable === hash(await businessRows(type === 'NOTE' ? undefined : customers.target.id, type === 'NOTE' ? [] : ['lastContactAt', 'updatedAt'])), `${type}: planned contact, ownership, tasks and unrelated data preserved`);
    check(type === 'NOTE' ? iso(profileAfter.lastContactAt) === iso(profileBefore.lastContactAt) : iso(profileAfter.lastContactAt) === iso(additions[0].createdAt), `${type}: actual-contact timestamp retains established interaction semantics`);
  }
  for (const forgedDate of [null, futureInput(9)]) {
    const page = await request(sessions.admin, detailPath(customers.target));
    const form = forms(page.html).find((entry) => /name="note"/.test(entry) && /name="source"/.test(entry));
    check(form && !/name="nextContactAt"/.test(form), 'general profile form no longer owns the plan input');
    const current = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.target.id } });
    const stable = hash(await businessRows(customers.target.id, ['updatedAt']));
    const activityBefore = hash(await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } }));
    const response = await submit('admin', detailPath(customers.target), form, { customerId: customers.target.id, status: current.status, priority: current.priority, source: current.source ?? '', note: current.note ?? '', nextContactAt: forgedDate });
    check(response.status === 200 && stable === hash(await businessRows(customers.target.id, ['updatedAt'])), `general profile save ${forgedDate === null ? 'without date' : 'with forged date'} preserves planned/actual contact and every existing field`);
    check(activityBefore === hash(await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } })), 'unchanged profile status does not create synthetic contact activity');
  }
  for (const actor of ['super', 'admin', 'manager', 'managerA', 'salesA']) await health(actor);
  for (const path of ['/sales', '/sales/customers', detailPath(customers.target), '/sales/assignment', '/sales/teams', teamPath, '/sales/pipeline', '/sales/follow-ups', '/sales/reports']) {
    check((await request(sessions.admin, path)).status === 200, `regression route ${path.includes(customers.target.id) ? '/sales/customers/[id]' : path.includes(teamIds[0]) ? '/sales/teams/[id]' : path}`);
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
    if (baseline) check(baseline === await snapshot(), 'cleanup: original customer/task/activity/team/user/audit data exactly matches pre-run snapshot');
  } finally { await prisma.$disconnect(); }
}
console.log(`VERIFICATION COMPLETE: ${assertions} assertions passed`);
