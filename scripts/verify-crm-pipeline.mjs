import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { CustomerStatus, PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

// Run only against a local app and local test database; see tests/README.crm.md.
// All mutations target this run's random fixture IDs. Cleanup never repairs data.
const base = new URL(process.env.CRM_VERIFY_BASE_URL || 'http://127.0.0.1:3107');
const url = new URL(process.env.DATABASE_URL);
const loopback = ['localhost', '127.0.0.1', '[::1]'];
if (process.env.CRM_VERIFY_FIXTURES !== '1' || !loopback.includes(base.hostname) || !loopback.includes(url.hostname)) {
  throw new Error('Set CRM_VERIFY_FIXTURES=1 and use a local app/local test database for fixture verification.');
}
const prisma = new PrismaClient({ adapter: new PrismaMariaDb({
  host: url.hostname, port: Number(url.port || 3306),
  user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''), connectionLimit: 5, allowPublicKeyRetrieval: true,
}) });
const marker = `crm007-${randomUUID()}`;
const password = randomUUID();
const users = {};
const sessions = {};
const customers = {};
const userIds = [];
const teamIds = [];
let baseline;
let assertions = 0;

function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  assertions += 1;
  console.log(`PASS: ${label}`);
}
const hashValue = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function databaseSnapshot() {
  const models = ['customerProfile', 'customerTask', 'customerActivity', 'salesTeam', 'salesTeamMember', 'auditLog'];
  const rows = await Promise.all(models.map((model) => prisma[model].findMany({ orderBy: { id: 'asc' } })));
  rows.push(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: {
    id: true, email: true, name: true, role: true, status: true, phone: true,
    lastLoginAt: true, createdAt: true, updatedAt: true,
  } }));
  return hashValue(rows);
}
function readCookies(response, previous = '') {
  const jar = new Map(previous.split('; ').filter(Boolean).map((entry) => {
    const index = entry.indexOf('='); return [entry.slice(0, index), entry.slice(index + 1)];
  }));
  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';')[0]; const index = pair.indexOf('=');
    jar.set(pair.slice(0, index), pair.slice(index + 1));
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
  const csrfResponse = await fetch(new URL('/api/auth/csrf', base));
  let cookie = readCookies(csrfResponse);
  const { csrfToken } = await csrfResponse.json();
  const response = await fetch(new URL('/api/auth/callback/credentials', base), {
    method: 'POST', redirect: 'manual',
    headers: { cookie, origin: base.origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email: user.email, password, json: 'true', callbackUrl: `${base.origin}/sales` }),
  });
  cookie = readCookies(response, cookie);
  await response.text();
  const session = JSON.parse((await request(cookie, '/api/auth/session')).html).user;
  check(session?.id === user.id && session.role === user.role, `credential login ${user.role}`);
  return cookie;
}
function decodeHtml(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#x[\da-f]+|#\d+);/gi, (entity) => {
    if (/^&#x/i.test(entity)) return String.fromCodePoint(parseInt(entity.slice(3, -1), 16));
    if (entity.startsWith('&#')) return String.fromCodePoint(Number(entity.slice(2, -1)));
    return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity];
  });
}
function attribute(tag, name) { return decodeHtml(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ''); }
function forms(html) { return [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(([form]) => form); }
function customerForm(html, customerId) {
  const form = forms(html).find((entry) => entry.includes('name="customerId"') && entry.includes(`value="${customerId}"`));
  if (!form) throw new Error('Expected fixture customer form in rendered HTML');
  return form;
}
async function submit(cookie, path, form, fields) {
  const body = new FormData();
  // Include React's observed action references and bound action-state fields.
  for (const [tag] of form.matchAll(/<input\b[^>]*>/g)) {
    if (attribute(tag, 'type') === 'hidden') body.append(attribute(tag, 'name'), attribute(tag, 'value'));
  }
  if (![...body.keys()].some((key) => key.startsWith('$ACTION_'))) throw new Error('Missing rendered Server Action metadata');
  for (const [key, value] of Object.entries(fields)) {
    body.delete(key);
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  }
  return request(cookie, path, { method: 'POST', body });
}
function visibleIds(html) {
  return new Set([...html.matchAll(/href="\/sales\/customers\/([^"?]+)"/g)].map(([, id]) => decodeHtml(id)));
}
const sameSet = (actual, expected) => actual.size === expected.length && expected.every((id) => actual.has(id));
function route(path, filters = {}) {
  return `${path}?${new URLSearchParams({ q: marker, ...filters })}`;
}
async function expectCustomers(cookie, path, filters, expectedKeys, label) {
  const response = await request(cookie, route(path, filters));
  check(response.status === 200 && sameSet(visibleIds(response.html), expectedKeys.map((key) => customers[key].id)), label);
  return response;
}
async function customerInvariant(customerId) {
  const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customerId } });
  const stableProfile = { ...profile }; delete stableProfile.status; delete stableProfile.updatedAt;
  return hashValue({ profile: stableProfile,
    tasks: await prisma.customerTask.findMany({ where: { customerId }, orderBy: { id: 'asc' } }),
    teams: await prisma.salesTeam.findMany({ orderBy: { id: 'asc' } }),
    memberships: await prisma.salesTeamMember.findMany({ orderBy: { id: 'asc' } }),
  });
}
async function changeStatus(actorKey, key, status) {
  const customer = customers[key];
  const cookie = sessions[actorKey];
  const before = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customer.id } });
  const preserved = await customerInvariant(customer.id);
  const auditBefore = await prisma.auditLog.count({ where: { entityId: customer.id, action: 'CUSTOMER_PIPELINE_STATUS_CHANGE' } });
  const activitiesBefore = await prisma.customerActivity.count({ where: { customerId: customer.id, type: 'STATUS_CHANGE' } });
  const page = await request(cookie, route('/sales/pipeline'));
  const result = await submit(cookie, route('/sales/pipeline'), customerForm(page.html, customer.id), {
    customerId: customer.id, status,
    // Submitted ownership/task fields must be ignored by the status-only action.
    assignedSalesId: users.salesB.id, priority: 'LOW', teamId: teamIds[1], assignedToId: users.salesB.id,
  });
  const after = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customer.id } });
  check(result.status === 200 && after.status === status, `${users[actorKey].role}: status ${before.status} -> ${status} persisted`);
  check(preserved === await customerInvariant(customer.id), `${users[actorKey].role}: ownership, tasks, team data and other profile fields unchanged`);
  const logs = await prisma.auditLog.findMany({ where: { entityId: customer.id, action: 'CUSTOMER_PIPELINE_STATUS_CHANGE' }, orderBy: { createdAt: 'desc' } });
  const activityCount = await prisma.customerActivity.count({ where: { customerId: customer.id, type: 'STATUS_CHANGE' } });
  const changed = before.status !== status;
  check(logs.length === auditBefore + Number(changed) && activityCount === activitiesBefore + Number(changed), `${users[actorKey].role}: exact activity/audit count, including no-op`);
  if (changed) {
    check(logs[0].actorId === users[actorKey].id && logs[0].metadata.previousStatus === before.status && logs[0].metadata.newStatus === status,
      `${users[actorKey].role}: audit actor and previous/new status`);
    check(await prisma.customerActivity.count({ where: { customerId: customer.id, actorId: users[actorKey].id, type: 'STATUS_CHANGE', content: `${before.status} → ${status}` } }) === 1,
      `${users[actorKey].role}: matching CRM activity`);
  }
  const refreshed = await request(cookie, route('/sales/pipeline', { status }));
  check(visibleIds(refreshed.html).has(customer.id), `${users[actorKey].role}: moved card visible in new filtered status`);
  return customerForm((await request(cookie, route('/sales/pipeline'))).html, customer.id);
}
async function rejectedStatus(actorKey, form, fields, label, deniedRole = false) {
  const before = await databaseSnapshot();
  const response = await submit(sessions[actorKey], route('/sales/pipeline'), form, fields);
  check(deniedRole ? response.status === 303 && response.location === '/dashboard' : response.status === 200, `${label}: safe response`);
  check(before === await databaseSnapshot(), `${label}: no data, activity or audit mutation`);
}

try {
  baseline = await databaseSnapshot();
  const passwordHash = await bcrypt.hash(password, 10);
  const roles = { super: 'SUPER_ADMIN', admin: 'ADMIN', manager: 'MANAGER', managerA: 'SALES_MANAGER', managerB: 'SALES_MANAGER', salesA: 'SALES', salesPeer: 'SALES', salesB: 'SALES', client: 'CLIENT', creator: 'CREATOR', analyst: 'ANALYST', employee: 'EMPLOYEE' };
  for (const [key, role] of Object.entries(roles)) {
    users[key] = await prisma.user.create({ data: { id: `${marker}-${key}`, name: `${marker}-${key}`, email: `${marker}-${key.toLowerCase()}@example.test`, password: passwordHash, role } });
    userIds.push(users[key].id);
    sessions[key] = await login(users[key]);
  }
  const teamA = await prisma.salesTeam.create({ data: { name: `${marker}-teamA`, managerId: users.managerA.id } }); teamIds.push(teamA.id);
  const teamB = await prisma.salesTeam.create({ data: { name: `${marker}-teamB`, managerId: users.managerB.id } }); teamIds.push(teamB.id);
  await prisma.salesTeamMember.createMany({ data: [
    { teamId: teamA.id, userId: users.salesA.id }, { teamId: teamA.id, userId: users.salesPeer.id }, { teamId: teamB.id, userId: users.salesB.id },
  ] });
  const now = new Date(); const day = 86400000;
  const local = new Date(now.getTime() + 7 * 3600000);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 7 * 3600000;
  const definitions = {
    lead: ['salesA', 'LEAD', 'HIGH', new Date(now.getTime() - 3600000)],
    prospect: ['salesA', 'PROSPECT', 'MEDIUM', new Date(today + 12 * 3600000)],
    active: ['salesA', 'ACTIVE', 'LOW', new Date(today + day + 3600000)],
    dormant: ['salesA', 'DORMANT', 'HIGH', null],
    closed: ['salesA', 'CLOSED', 'LOW', new Date(today - day + 12 * 3600000)],
    peer: ['salesPeer', 'LEAD', 'LOW', null],
    foreign: ['salesB', 'LEAD', 'HIGH', new Date(now.getTime() - day)],
    unassigned: [null, 'PROSPECT', 'MEDIUM', null],
    literal: ['salesA', 'LEAD', 'HIGH', null],
  };
  for (const [key, [sales, status, priority, nextContactAt]] of Object.entries(definitions)) {
    const client = await prisma.user.create({ data: {
      id: `${marker}-customer-${key}`, email: `${marker}-customer-${key}@example.test`,
      name: `${marker} ${key === 'literal' ? 'Literal 50%_\\value' : `Customer ${key}`}`,
      password: passwordHash, role: 'CLIENT',
    } }); userIds.push(client.id);
    customers[key] = await prisma.customerProfile.create({ data: {
      userId: client.id, customerCode: `${marker}-${key}-code`, status, priority, nextContactAt,
      assignedSalesId: sales ? users[sales].id : null, source: 'verification', note: 'Preserve this fixture note',
    } });
  }
  await prisma.customerTask.createMany({ data: [
    { customerId: customers.lead.id, createdById: users.admin.id, assignedToId: users.salesA.id, title: 'Open overdue', status: 'TODO', dueAt: new Date(now.getTime() - day) },
    { customerId: customers.active.id, createdById: users.admin.id, assignedToId: users.salesA.id, title: 'Open upcoming', status: 'IN_PROGRESS', dueAt: new Date(now.getTime() + day) },
    { customerId: customers.prospect.id, createdById: users.admin.id, assignedToId: users.salesA.id, title: 'Completed past due', status: 'DONE', dueAt: new Date(now.getTime() - day) },
    { customerId: customers.closed.id, createdById: users.admin.id, assignedToId: users.salesA.id, title: 'Cancelled past due', status: 'CANCELLED', dueAt: new Date(now.getTime() - day) },
    { customerId: customers.foreign.id, createdById: users.admin.id, assignedToId: users.salesB.id, title: 'Foreign overdue', status: 'TODO', dueAt: new Date(now.getTime() - day) },
  ] });
  const allKeys = Object.keys(customers);
  const ownKeys = ['lead', 'prospect', 'active', 'dormant', 'closed', 'literal'];
  for (const path of ['/sales/customers', '/sales/pipeline']) {
    for (const key of ['super', 'admin', 'manager']) await expectCustomers(sessions[key], path, {}, allKeys, `${users[key].role} global ${path}`);
    await expectCustomers(sessions.managerA, path, {}, [...ownKeys, 'peer'], `SALES_MANAGER scoped ${path}`);
    await expectCustomers(sessions.salesA, path, {}, ownKeys, `SALES assigned scope ${path}`);
    for (const key of ['managerA', 'salesA']) {
      await expectCustomers(sessions[key], path, { salesId: users.salesB.id }, [], `${key}: foreign salesId cannot broaden ${path}`);
      await expectCustomers(sessions[key], path, { teamId: teamB.id }, [], `${key}: foreign teamId cannot broaden ${path}`);
      const visible = await request(sessions[key], route(path));
      check(!visible.html.includes(users.salesB.email) && !visible.html.includes(teamB.name), `${key}: foreign Sales/team option details hidden`);
    }
    for (const key of ['client', 'creator', 'analyst', 'employee']) {
      const response = await request(sessions[key], route(path));
      check(response.status === 307 && response.location === '/dashboard', `${users[key].role} blocked ${path}`);
    }
    const combinations = [
      [{ status: 'LEAD', priority: 'HIGH', salesId: users.salesA.id, teamId: teamA.id, followUp: 'overdue', task: 'overdue' }, ['lead'], 'all filter combination'],
      [{ status: 'DORMANT', priority: 'HIGH', followUp: 'none' }, ['dormant'], 'status/priority/no-followup'],
      [{ task: 'open', salesId: users.salesA.id }, ['lead', 'active'], 'open tasks exclude DONE and CANCELLED'],
      [{ task: 'overdue', salesId: users.salesA.id }, ['lead'], 'overdue tasks exclude closed and future tasks'],
      [{ teamId: teamA.id }, [...ownKeys, 'peer'], 'team membership filter'],
      [{ salesId: users.salesA.id }, ownKeys, 'assignee filter'],
      [{ salesId: `${marker}-missing` }, [], 'nonexistent assignee safely empty'],
      [{ teamId: `${marker}-missing` }, [], 'nonexistent team safely empty'],
      [{ q: `${marker}-customer-prospect@example.test` }, ['prospect'], 'email search'],
      [{ q: `${marker}-active-code` }, ['active'], 'customer code search'],
      [{ q: `${marker} Customer dormant` }, ['dormant'], 'name search'],
      [{ q: `${marker} Literal 50%_\\value` }, ['literal'], 'literal SQL wildcard characters'],
    ];
    for (const [filters, expected, label] of combinations) await expectCustomers(sessions.admin, path, filters, expected, `${path}: ${label}`);
    const todayKeys = allKeys.filter((key) => {
      const date = customers[key].nextContactAt; return date && date.getTime() >= today && date.getTime() < today + day;
    });
    const upcomingKeys = allKeys.filter((key) => customers[key].nextContactAt?.getTime() >= Date.now());
    const overdueKeys = allKeys.filter((key) => customers[key].nextContactAt && customers[key].nextContactAt.getTime() < Date.now());
    await expectCustomers(sessions.admin, path, { followUp: 'today' }, todayKeys, `${path}: UTC+7 today`);
    await expectCustomers(sessions.admin, path, { followUp: 'upcoming' }, upcomingKeys, `${path}: upcoming followup`);
    await expectCustomers(sessions.admin, path, { followUp: 'overdue' }, overdueKeys, `${path}: overdue followup`);
    const invalid = await expectCustomers(sessions.salesA, path, {
      status: 'NOT_A_STATUS', priority: 'BAD', salesId: '../../x', teamId: 'x'.repeat(200), followUp: 'bad', task: 'bad', page: '-5',
    }, ownKeys, `${path}: invalid filters ignored without widening scope`);
    check(invalid.html.includes('Đã bỏ qua bộ lọc không hợp lệ'), `${path}: invalid-filter notice`);
    const repeated = await request(sessions.salesA, `${route(path)}&status=LEAD&status=CLOSED&salesId=${users.salesB.id}&salesId=${users.salesA.id}`);
    check(repeated.status === 200 && sameSet(visibleIds(repeated.html), ownKeys.map((key) => customers[key].id)), `${path}: repeated params do not crash or widen scope`);
    const empty = await request(sessions.admin, route(path, { q: `${marker}-no-match` }));
    check(empty.status === 200 && empty.html.includes('Không có khách hàng phù hợp'), `${path}: clear empty state`);
    const resetLink = [...empty.html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(([a]) => a).find((a) => a.includes('Xóa bộ lọc'));
    check(resetLink && attribute(resetLink, 'href') === path, `${path}: reset clears query parameters`);
    const reset = await request(sessions.salesA, path);
    check(reset.status === 200 && ownKeys.every((key) => visibleIds(reset.html).has(customers[key].id)), `${path}: reset restores authorized results`);
  }

  const board = await request(sessions.admin, route('/sales/pipeline'));
  for (const status of Object.values(CustomerStatus)) check(board.html.includes(`id="pipeline-${status}"`), `pipeline column uses Prisma status ${status}`);
  const managerBoard = await request(sessions.manager, route('/sales/pipeline'));
  check(!forms(managerBoard.html).some((form) => form.includes('name="customerId"')), 'MANAGER retains global read-only CRM permission');
  for (const [actorKey, key, status] of [['super', 'lead', 'PROSPECT'], ['admin', 'lead', 'ACTIVE'], ['managerA', 'peer', 'PROSPECT'], ['salesA', 'lead', 'DORMANT']]) {
    await changeStatus(actorKey, key, status);
  }
  const actionForm = await changeStatus('salesA', 'lead', 'DORMANT');
  for (const [fields, label] of [
    [{ customerId: customers.lead.id, status: 'NOT_A_STATUS' }, 'invalid status'],
    [{ customerId: customers.lead.id, status: ['LEAD', 'CLOSED'] }, 'duplicate status'],
    [{ customerId: [customers.lead.id, customers.foreign.id], status: 'LEAD' }, 'duplicate customerId'],
    [{ customerId: '../bad', status: 'LEAD' }, 'malformed customerId'],
    [{ customerId: `${marker}-notfound`, status: 'LEAD' }, 'missing customer'],
    [{ customerId: customers.foreign.id, status: 'CLOSED' }, 'foreign customer'],
  ]) {
    await rejectedStatus('salesA', actionForm, fields, `SALES ${label}`);
  }
  await rejectedStatus('managerA', actionForm, { customerId: customers.foreign.id, status: 'CLOSED' }, 'SALES_MANAGER foreign status');
  await rejectedStatus('managerA', actionForm, { customerId: customers.unassigned.id, status: 'CLOSED' }, 'SALES_MANAGER unassigned customer denied');
  for (const key of ['client', 'manager', 'creator']) await rejectedStatus(key, actionForm, { customerId: customers.lead.id, status: 'CLOSED' }, `${users[key].role} forged status`, true);
  // Revalidate the session role at action time, including a previously valid form.
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'CLIENT' } });
  await rejectedStatus('salesA', actionForm, { customerId: customers.lead.id, status: 'CLOSED' }, 'demoted Sales session cannot mutate', true);
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'SALES' } });

  // Verify existing assignment itself and stale-form scoping after reassignment.
  const assignment = await request(sessions.admin, '/sales/assignment');
  const assignmentForm = customerForm(assignment.html, customers.lead.id);
  const assigned = await submit(sessions.admin, '/sales/assignment', assignmentForm, { customerId: customers.lead.id, salesId: users.salesB.id });
  check(assigned.status === 200 && (await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.lead.id } })).assignedSalesId === users.salesB.id, 'existing ADMIN assignment action persists');
  check(await prisma.customerTask.count({ where: { customerId: customers.lead.id, assignedToId: users.salesB.id, status: 'TODO' } }) === 1, 'existing assignment still moves open tasks');
  await rejectedStatus('salesA', actionForm, { customerId: customers.lead.id, status: 'CLOSED' }, 'stale Sales form after reassignment denied');
  const assignmentBack = await submit(sessions.admin, '/sales/assignment', assignmentForm, { customerId: customers.lead.id, salesId: users.salesA.id });
  check(assignmentBack.status === 200, 'restore fixture assignment through existing action');
  const managerAssignment = await request(sessions.managerA, '/sales/assignment');
  const managerAssigned = await submit(sessions.managerA, '/sales/assignment', customerForm(managerAssignment.html, customers.lead.id), { customerId: customers.lead.id, salesId: users.salesPeer.id });
  check(managerAssigned.status === 200 && (await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.lead.id } })).assignedSalesId === users.salesPeer.id, 'existing SALES_MANAGER assignment within team persists');

  for (const path of ['/sales', '/sales/customers', `/sales/customers/${customers.lead.id}`, '/sales/assignment', '/sales/teams', `/sales/teams/${teamA.id}`]) {
    check((await request(sessions.admin, path)).status === 200, `regression route ${path.includes(customers.lead.id) ? '/sales/customers/[id]' : path.includes(teamA.id) ? '/sales/teams/[id]' : path}`);
  }
  check((await request(sessions.managerA, `/sales/teams/${teamA.id}`)).status === 200 && (await request(sessions.managerA, `/sales/teams/${teamB.id}`)).status === 404, 'Sales Team Management manager scoping unchanged');
  for (const key of ['admin', 'managerA', 'salesA', 'manager']) {
    const dashboard = await request(sessions[key], '/sales');
    check(dashboard.html.includes('href="/sales/customers"') && dashboard.html.includes('href="/sales/pipeline"'), `${key}: Customers/Pipeline dashboard links`);
    const canAssign = ['admin', 'managerA'].includes(key);
    check(dashboard.html.includes('href="/sales/assignment"') === canAssign && dashboard.html.includes('href="/sales/teams"') === canAssign, `${key}: Assignment/Teams links retain role gates`);
  }

  // Exercise result bounds with more customers than a single list page/column.
  const pageMarker = `${marker}-paging`;
  for (let index = 0; index < 32; index += 1) {
    const id = `${pageMarker}-${String(index).padStart(2, '0')}`;
    await prisma.user.create({ data: { id, email: `${id}@example.test`, name: id, password: passwordHash, role: 'CLIENT' } }); userIds.push(id);
    await prisma.customerProfile.create({ data: { userId: id, customerCode: id, assignedSalesId: users.salesA.id, status: 'LEAD' } });
  }
  const pageOne = await request(sessions.salesA, route('/sales/customers', { q: pageMarker, status: 'LEAD' }));
  const pageTwo = await request(sessions.salesA, route('/sales/customers', { q: pageMarker, status: 'LEAD', page: '2' }));
  const firstIds = visibleIds(pageOne.html); const secondIds = visibleIds(pageTwo.html);
  check(pageOne.status === 200 && pageTwo.status === 200 && firstIds.size === 30 && secondIds.size === 2 && [...firstIds].every((id) => !secondIds.has(id)), 'list paginates 30 + 2 with no duplicate cards');
  check(decodeHtml(pageOne.html).includes(`q=${pageMarker}&status=LEAD&page=2`), 'pagination preserves filter combination');
  const extremePage = await request(sessions.salesA, route('/sales/customers', { q: pageMarker, page: '1000000' }));
  check(extremePage.status === 200 && visibleIds(extremePage.html).size === 2, 'oversized valid page clamps to final results');
  const cappedBoard = await request(sessions.salesA, route('/sales/pipeline', { q: pageMarker }));
  check(cappedBoard.status === 200 && visibleIds(cappedBoard.html).size === 30 && cappedBoard.html.includes('Xem tất cả'), 'pipeline caps each status at 30 and provides full-list link');
  check(decodeHtml(cappedBoard.html).includes(`/sales/customers?q=${pageMarker}&status=LEAD`), 'pipeline overflow link preserves search and real status');
} finally {
  try {
    if (userIds.length) {
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
        await tx.customerProfile.deleteMany({ where: { userId: { in: userIds } } });
        await tx.salesTeamMember.deleteMany({ where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: userIds } }] } });
        await tx.salesTeam.deleteMany({ where: { id: { in: teamIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
      });
    }
    if (baseline) check(baseline === await databaseSnapshot(), 'cleanup: original customer/task/team/user/audit data matches pre-run snapshot');
  } finally {
    await prisma.$disconnect();
  }
}
console.log(`VERIFICATION COMPLETE: ${assertions} assertions passed`);
