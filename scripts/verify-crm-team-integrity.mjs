import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

// Explicitly opt into isolated fixtures on a local development/test database.
// This verifier does not apply migrations, seed, or repair existing business data.
const base = new URL(process.env.CRM_VERIFY_BASE_URL || 'http://127.0.0.1:3107');
const databaseUrl = new URL(process.env.DATABASE_URL);
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
const loopback = ['localhost', '127.0.0.1', '[::1]'];
if (process.env.CRM_VERIFY_FIXTURES !== '1'
  || !loopback.includes(base.hostname) || !loopback.includes(databaseUrl.hostname)
  || !['http:', 'https:'].includes(base.protocol) || databaseUrl.protocol !== 'mysql:'
  || !/(?:^|_)(?:dev|test)(?:_|$)/i.test(databaseName)
  || /(?:^|_)(?:prod|production)(?:_|$)/i.test(databaseName)) {
  throw new Error('Set CRM_VERIFY_FIXTURES=1 and use a loopback app/MySQL development or test database.');
}
const prisma = new PrismaClient({ adapter: new PrismaMariaDb({
  host: databaseUrl.hostname, port: Number(databaseUrl.port || 3306),
  user: decodeURIComponent(databaseUrl.username), password: decodeURIComponent(databaseUrl.password),
  database: databaseName, connectionLimit: 5, allowPublicKeyRetrieval: true,
}) });
const marker = `crm008-${randomUUID()}`;
const password = randomUUID();
const users = {};
const sessions = {};
const userIds = [];
const teamIds = [];
const confirmationValue = 'REMOVE_MEMBERSHIP_KEEP_ASSIGNMENTS';
let passwordHash;
let baseline;
let assertions = 0;

function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  assertions += 1;
  console.log(`PASS: ${label}`);
}
const hashValue = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicUserSelect = {
  id: true, email: true, name: true, role: true, status: true, phone: true,
  lastLoginAt: true, createdAt: true, updatedAt: true,
};
async function snapshot() {
  const models = ['customerProfile', 'customerTask', 'customerActivity', 'salesTeam', 'salesTeamMember', 'auditLog'];
  const rows = await Promise.all(models.map((model) => prisma[model].findMany({ orderBy: { id: 'asc' } })));
  rows.push(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: publicUserSelect }));
  return hashValue(rows);
}
async function ownershipSnapshot() {
  // Only membership/audit changes are allowed; all these rows must remain exact.
  const rows = await Promise.all(['customerProfile', 'customerTask', 'customerActivity', 'salesTeam']
    .map((model) => prisma[model].findMany({ orderBy: { id: 'asc' } })));
  rows.push(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: publicUserSelect }));
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
  const csrfResponse = await fetch(new URL('/api/auth/csrf', base), { signal: AbortSignal.timeout(30000) });
  let cookie = readCookies(csrfResponse);
  const { csrfToken } = await csrfResponse.json();
  const response = await fetch(new URL('/api/auth/callback/credentials', base), {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { cookie, origin: base.origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email: user.email, password, json: 'true', callbackUrl: `${base.origin}/sales/teams` }),
  });
  cookie = readCookies(response, cookie);
  await response.text();
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
function attribute(tag, name) { return decodeHtml(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ''); }
function forms(html) { return [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(([form]) => form); }
function inputValue(form, name) {
  const input = [...form.matchAll(/<input\b[^>]*>/g)].map(([tag]) => tag).find((tag) => attribute(tag, 'name') === name);
  return input ? attribute(input, 'value') : undefined;
}
function memberForm(html, membershipId) {
  const form = forms(html).find((entry) => inputValue(entry, 'membershipId') === membershipId);
  if (!form) throw new Error('Expected fixture membership removal form in rendered HTML');
  return form;
}
function addForm(html) {
  const form = forms(html).find((entry) => /<select\b[^>]*name="userId"/.test(entry));
  if (!form) throw new Error('Expected Sales member add form in rendered HTML');
  return form;
}
function visibleText(html) { return decodeHtml(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' '); }
function hasFriendlyError(html) { return /role="alert"/.test(html) && !/PrismaClientKnownRequestError|Unique constraint failed/.test(html); }
async function submit(actorKey, path, form, fields = {}) {
  const body = new FormData();
  // Preserve the actual rendered React action references and bound state metadata.
  // Checkboxes are intentionally not copied: every confirmation is explicit.
  for (const [tag] of form.matchAll(/<input\b[^>]*>/g)) {
    if (attribute(tag, 'type') === 'hidden') body.append(attribute(tag, 'name'), attribute(tag, 'value'));
  }
  if (![...body.keys()].some((key) => key.startsWith('$ACTION_'))) throw new Error('Missing rendered Server Action metadata');
  for (const [key, value] of Object.entries(fields)) {
    body.delete(key);
    if (value !== null && value !== undefined) {
      for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
    }
  }
  return request(sessions[actorKey], path, { method: 'POST', body });
}
const teamPath = (id) => `/sales/teams/${id}`;
async function freshMemberForm(actorKey, membership) {
  const page = await request(sessions[actorKey], teamPath(membership.teamId));
  check(page.status === 200, `${users[actorKey].role}: team detail renders`);
  return memberForm(page.html, membership.id);
}
async function createUser(key, role = 'SALES', status = 'ACTIVE') {
  const user = await prisma.user.create({ data: {
    id: `${marker}-${key}`, email: `${marker}-${key.toLowerCase()}@example.test`,
    name: `${marker} ${key}`, password: passwordHash, role, status,
  } });
  userIds.push(user.id); users[key] = user;
  return user;
}
async function createMember(key, teamId) {
  const user = await createUser(key);
  return prisma.salesTeamMember.create({ data: { teamId, userId: user.id } });
}
async function createCustomer(key, salesId, status) {
  const client = await createUser(`customer-${key}`, 'CLIENT');
  const customer = await prisma.customerProfile.create({ data: {
    userId: client.id, customerCode: `${marker}-${key}`, assignedSalesId: salesId, status,
    note: 'Do not change customer ownership or profile fields during membership removal.',
  } });
  await prisma.customerTask.createMany({ data: ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'].map((taskStatus) => ({
    customerId: customer.id, assignedToId: salesId, createdById: users.admin.id,
    title: `${key} ${taskStatus}`, status: taskStatus,
  })) });
  return customer;
}
async function rejected(actorKey, path, form, fields, label, { deniedRole = false, friendly = false } = {}) {
  const before = await snapshot();
  const response = await submit(actorKey, path, form, fields);
  check(deniedRole ? response.status === 303 && response.location === '/dashboard' : response.status === 200,
    `${label}: safe HTTP response`);
  check(before === await snapshot(), `${label}: no membership, customer, task, user or audit mutation`);
  if (friendly) check(hasFriendlyError(response.html), `${label}: friendly error, no raw Prisma failure`);
  return response;
}
async function removalLogs(membershipId) {
  return prisma.auditLog.findMany({ where: { entityId: membershipId, action: 'SALES_TEAM_MEMBER_REMOVE' } });
}
async function verifyRemoval(actorKey, membership, form, fields, customerCount, label) {
  const beforeOwnership = await ownershipSnapshot();
  const beforeMemberships = await prisma.salesTeamMember.findMany({ orderBy: { id: 'asc' } });
  const auditBefore = await prisma.auditLog.count();
  const nonClosedCount = await prisma.customerProfile.count({ where: { assignedSalesId: membership.userId, status: { not: 'CLOSED' } } });
  const response = await submit(actorKey, teamPath(membership.teamId), form, fields);
  check(response.status === 200, `${label}: successful HTTP response`);
  check(await prisma.salesTeamMember.findUnique({ where: { id: membership.id } }) === null, `${label}: target membership removed`);
  check(beforeOwnership === await ownershipSnapshot(), `${label}: customers, task assignments, users/roles, activities and teams unchanged`);
  const afterMemberships = await prisma.salesTeamMember.findMany({ orderBy: { id: 'asc' } });
  check(hashValue(afterMemberships) === hashValue(beforeMemberships.filter((row) => row.id !== membership.id)), `${label}: only target membership deleted`);
  const logs = await removalLogs(membership.id);
  check(logs.length === 1 && await prisma.auditLog.count() === auditBefore + 1, `${label}: exactly one removal audit`);
  const log = logs[0];
  check(log.actorId === users[actorKey].id && log.entityType === 'SalesTeamMember'
    && log.metadata.teamId === membership.teamId && log.metadata.userId === membership.userId
    && log.metadata.assignedCustomerCount === customerCount, `${label}: audit actor, team, user and latest customer count`);
  check(log.metadata.nonClosedCustomerCount === nonClosedCount
    && log.metadata.confirmationUsed === (fields.confirmation === confirmationValue), `${label}: exact non-closed count and confirmation flag`);
  check(!JSON.stringify(log.metadata).includes(password) && !Object.keys(log.metadata).some((key) => /token|secret|password/i.test(key)),
    `${label}: audit contains no credential or confirmation token`);
}

try {
  const duplicates = await prisma.salesTeamMember.groupBy({ by: ['userId'], _count: { userId: true }, having: { userId: { _count: { gt: 1 } } } });
  check(duplicates.length === 0, 'existing membership duplicate preflight is clean (no auto-repair)');
  baseline = await snapshot();
  passwordHash = await bcrypt.hash(password, 10);
  const actorRoles = {
    super: 'SUPER_ADMIN', admin: 'ADMIN', adminOther: 'ADMIN', managerA: 'SALES_MANAGER', managerB: 'SALES_MANAGER',
    sales: 'SALES', client: 'CLIENT', manager: 'MANAGER', creator: 'CREATOR', analyst: 'ANALYST', employee: 'EMPLOYEE',
  };
  for (const [key, role] of Object.entries(actorRoles)) {
    sessions[key] = await login(await createUser(key, role));
  }
  const teamA = await prisma.salesTeam.create({ data: { name: `${marker} team A`, managerId: users.managerA.id } }); teamIds.push(teamA.id);
  const teamB = await prisma.salesTeam.create({ data: { name: `${marker} team B`, managerId: users.managerB.id } }); teamIds.push(teamB.id);
  const guardMember = await createMember('guard-sales', teamA.id);
  const stolenForm = await freshMemberForm('admin', guardMember);
  // Managers keep scoped read-only pages; all other unauthorized roles are blocked.
  const managerPage = await request(sessions.managerA, teamPath(teamA.id));
  const managerList = await request(sessions.managerA, '/sales/teams');
  check(managerPage.status === 200 && !forms(managerPage.html).some((form) => inputValue(form, 'membershipId') !== undefined || /name="userId"/.test(form)),
    'SALES_MANAGER own team is read-only without add/remove controls');
  check(managerList.status === 200 && managerList.html.includes(teamA.name) && !managerList.html.includes(teamB.name),
    'SALES_MANAGER list shows only managed teams');
  check((await request(sessions.managerA, teamPath(teamB.id))).status === 404, 'SALES_MANAGER foreign team remains non-leaking 404');
  for (const key of ['sales', 'client', 'manager', 'creator', 'analyst', 'employee']) {
    for (const path of ['/sales/teams', teamPath(teamA.id)]) {
      const page = await request(sessions[key], path);
      check(page.status === 307 && page.location === '/dashboard', `${users[key].role}: team route blocked`);
    }
  }
  for (const key of ['managerA', 'managerB', 'sales', 'client', 'manager', 'creator', 'analyst', 'employee']) {
    await rejected(key, teamPath(teamA.id), stolenForm, {}, `${users[key].role}: stolen removal form`, { deniedRole: true });
  }

  // Zero-customer removal works immediately for both authorized roles.
  for (const actorKey of ['super', 'admin']) {
    const membership = await createMember(`${actorKey}-zero`, teamA.id);
    const form = await freshMemberForm(actorKey, membership);
    await verifyRemoval(actorKey, membership, form, {}, 0, `${users[actorKey].role}: zero-customer removal`);
  }

  // Include CLOSED customers in the warning and in the final audit's latest count.
  for (const actorKey of ['super', 'admin']) {
    const membership = await createMember(`${actorKey}-assigned`, teamA.id);
    await createCustomer(`${actorKey}-open`, membership.userId, 'ACTIVE');
    await createCustomer(`${actorKey}-closed`, membership.userId, 'CLOSED');
    const form = await freshMemberForm(actorKey, membership);
    const first = await rejected(actorKey, teamPath(teamA.id), form, {}, `${users[actorKey].role}: first request with assigned customers warns only`);
    const warningForm = memberForm(first.html, membership.id);
    const token = inputValue(warningForm, 'confirmationToken');
    const warningText = visibleText(warningForm);
    check(typeof token === 'string' && token.length > 20 && inputValue(warningForm, 'confirmation') === confirmationValue,
      `${users[actorKey].role}: warning issues token and explicit confirmation checkbox`);
    check(warningText.includes(users[`${actorKey}-assigned`].name) && warningText.includes(users[`${actorKey}-assigned`].email)
      && /\b2\b/.test(warningText), `${users[actorKey].role}: warning identifies Sales and includes both assigned customers`);
    check(/không/i.test(warningText) && /khách hàng/i.test(warningText) && /quản lý/i.test(warningText),
      `${users[actorKey].role}: warning explains customer and manager-visibility consequences`);
    if (actorKey === 'admin') {
      const path = teamPath(teamA.id);
      const baseFields = { confirmationToken: token, confirmation: confirmationValue };
      for (const [fields, label] of [
        [{ confirmationToken: null, confirmation: confirmationValue }, 'checkbox without server token'],
        [{ confirmationToken: 'forged', confirmation: confirmationValue }, 'forged token'],
        [{ confirmationToken: `${token[0] === 'A' ? 'B' : 'A'}${token.slice(1)}`, confirmation: confirmationValue }, 'tampered signed token'],
        [{ confirmationToken: token, confirmation: null }, 'token without checkbox'],
        [{ confirmationToken: token, confirmation: 'yes' }, 'invalid checkbox value'],
        [{ confirmationToken: [token, token], confirmation: confirmationValue }, 'repeated token'],
        [{ confirmationToken: token, confirmation: [confirmationValue, confirmationValue] }, 'repeated checkbox'],
        [{ ...baseFields, membershipId: [membership.id, guardMember.id] }, 'repeated membershipId'],
        [{ ...baseFields, teamId: [teamA.id, teamB.id] }, 'repeated teamId'],
        [{ ...baseFields, membershipId: '../bad' }, 'malformed membershipId'],
        [{ ...baseFields, membershipId: `${marker}-missing` }, 'nonexistent membership'],
        [{ ...baseFields, teamId: teamB.id }, 'wrong membership team'],
        [{ ...baseFields, membershipId: guardMember.id }, 'token bound to another membership'],
      ]) await rejected(actorKey, path, warningForm, fields, `confirmation rejection: ${label}`);
      await rejected('adminOther', path, warningForm, baseFields, 'confirmation token cannot be used by another ADMIN');
      for (const key of ['managerA', 'sales', 'client']) {
        await rejected(key, path, warningForm, baseFields, `${users[key].role}: stolen signed confirmation`, { deniedRole: true });
      }
      // A previously valid actor session must not survive a server-side role change.
      await prisma.user.update({ where: { id: users.admin.id }, data: { role: 'SALES' } });
      await rejected('admin', path, warningForm, baseFields, 'role-demoted ADMIN cannot confirm', { deniedRole: true });
      await prisma.user.update({ where: { id: users.admin.id }, data: { role: 'ADMIN' } });
    }
    // Deliberate fixture change between warning and confirmation. No business rows touched.
    await createCustomer(`${actorKey}-new-closed`, membership.userId, 'CLOSED');
    await verifyRemoval(actorKey, membership, warningForm, {
      confirmationToken: token, confirmation: confirmationValue,
      // Ownership/role fields are not accepted by this membership-only action.
      assignedSalesId: users.sales.id, assignedToId: users.sales.id, userId: users.sales.id, role: 'CLIENT',
    }, 3, `${users[actorKey].role}: explicit removal uses latest count including CLOSED customers`);
    await rejected(actorKey, teamPath(teamA.id), warningForm, { confirmationToken: token, confirmation: confirmationValue },
      `${users[actorKey].role}: replay after membership deletion cannot mutate`);
  }

  // Two independently submitted confirmations for one membership must be atomic.
  const removeRaceMember = await createMember('remove-race', teamA.id);
  await createCustomer('remove-race-closed', removeRaceMember.userId, 'CLOSED');
  const removeRaceInitialForm = await freshMemberForm('admin', removeRaceMember);
  const removeRaceWarning = await rejected('admin', teamPath(teamA.id), removeRaceInitialForm, {}, 'concurrent removal fixture: first request warns');
  const removeRaceForm = memberForm(removeRaceWarning.html, removeRaceMember.id);
  const removeRaceFields = { confirmationToken: inputValue(removeRaceForm, 'confirmationToken'), confirmation: confirmationValue };
  check(Boolean(removeRaceFields.confirmationToken), 'concurrent removal has a genuine warning-issued token');
  const beforeRemoveRaceOwnership = await ownershipSnapshot();
  const beforeRemoveRaceMembers = await prisma.salesTeamMember.findMany({ orderBy: { id: 'asc' } });
  const beforeRemoveRaceAudits = await prisma.auditLog.count();
  const removeRace = await Promise.all([
    submit('admin', teamPath(teamA.id), removeRaceForm, removeRaceFields),
    submit('admin', teamPath(teamA.id), removeRaceForm, removeRaceFields),
  ]);
  check(removeRace.every((response) => response.status === 200), 'concurrent confirmed removals return handled HTTP responses');
  // On deletion the row/form may unmount; React still serializes the action state.
  const removeRaceErrors = removeRace.filter((response) => /Không tìm thấy thành viên|Dữ liệu vừa thay đổi/.test(decodeHtml(response.html)));
  check(removeRaceErrors.length === 1 && removeRace.every((response) => !/PrismaClientKnownRequestError|Unique constraint failed/.test(response.html)),
    'concurrent removal loser returns one friendly not-found/conflict result');
  check(hashValue(await prisma.salesTeamMember.findMany({ orderBy: { id: 'asc' } }))
    === hashValue(beforeRemoveRaceMembers.filter((row) => row.id !== removeRaceMember.id)),
  'concurrent removal deletes exactly the intended membership once');
  check(beforeRemoveRaceOwnership === await ownershipSnapshot(), 'concurrent removal preserves customers, tasks, roles, activities and teams');
  const removeRaceLogs = await removalLogs(removeRaceMember.id);
  check(removeRaceLogs.length === 1 && await prisma.auditLog.count() === beforeRemoveRaceAudits + 1,
    'concurrent removal creates exactly one audit');
  check(removeRaceLogs[0].actorId === users.admin.id && removeRaceLogs[0].metadata.userId === removeRaceMember.userId
    && removeRaceLogs[0].metadata.teamId === teamA.id && removeRaceLogs[0].metadata.assignedCustomerCount === 1
    && removeRaceLogs[0].metadata.nonClosedCustomerCount === 0 && removeRaceLogs[0].metadata.confirmationUsed === true,
  'concurrent removal audit records exact CLOSED-inclusive count and explicit confirmation');

  // Friendly application validation remains, with the DB constraint authoritative.
  await createUser('app-add');
  await createUser('app-race');
  await createUser('db-race');
  await createUser('suspended-sales', 'SALES', 'SUSPENDED');
  const formA = addForm((await request(sessions.admin, teamPath(teamA.id))).html);
  const formB = addForm((await request(sessions.adminOther, teamPath(teamB.id))).html);
  const ownershipBeforeAdd = await ownershipSnapshot();
  const added = await submit('admin', teamPath(teamA.id), formA, { teamId: teamA.id, userId: users['app-add'].id });
  const addedMember = await prisma.salesTeamMember.findFirst({ where: { userId: users['app-add'].id } });
  check(added.status === 200 && addedMember?.teamId === teamA.id, 'ADMIN can add an active unassigned Sales member');
  check(ownershipBeforeAdd === await ownershipSnapshot(), 'member add preserves customers, tasks, user roles and teams');
  const addLog = await prisma.auditLog.findMany({ where: { action: 'SALES_TEAM_MEMBER_ADD', entityId: addedMember.id } });
  check(addLog.length === 1 && addLog[0].actorId === users.admin.id && addLog[0].metadata.userId === users['app-add'].id
    && addLog[0].metadata.teamId === teamA.id, 'member add has exact actor/team/user audit');
  for (const [actorKey, path, form, fields, label] of [
    ['admin', teamPath(teamA.id), formA, { teamId: teamA.id, userId: users['app-add'].id }, 'same-team duplicate'],
    ['adminOther', teamPath(teamB.id), formB, { teamId: teamB.id, userId: users['app-add'].id }, 'cross-team duplicate'],
    ['admin', teamPath(teamA.id), formA, { teamId: teamA.id, userId: users.client.id }, 'invalid member role'],
    ['admin', teamPath(teamA.id), formA, { teamId: teamA.id, userId: users['suspended-sales'].id }, 'invalid member status'],
    ['admin', teamPath(teamA.id), formA, { teamId: teamA.id, userId: `${marker}-missing` }, 'missing Sales user'],
    ['admin', teamPath(teamA.id), formA, { teamId: `${marker}-missing`, userId: users.sales.id }, 'missing team'],
    ['admin', teamPath(teamA.id), formA, { teamId: [teamA.id, teamB.id], userId: users.sales.id }, 'repeated add teamId'],
    ['admin', teamPath(teamA.id), formA, { teamId: teamA.id, userId: [users.sales.id, users.client.id] }, 'repeated add userId'],
  ]) await rejected(actorKey, path, form, fields, `friendly add rejection: ${label}`, { friendly: true });
  for (const key of ['managerA', 'sales', 'client', 'manager', 'creator', 'analyst', 'employee']) {
    await rejected(key, teamPath(teamA.id), formA, { teamId: teamA.id, userId: users.sales.id },
      `${users[key].role}: stolen add form`, { deniedRole: true });
  }

  const beforeRaceOwnership = await ownershipSnapshot();
  const beforeRaceAudits = await prisma.auditLog.count();
  const race = await Promise.all([
    submit('admin', teamPath(teamA.id), formA, { teamId: teamA.id, userId: users['app-race'].id }),
    submit('adminOther', teamPath(teamB.id), formB, { teamId: teamB.id, userId: users['app-race'].id }),
  ]);
  const raceMembers = await prisma.salesTeamMember.findMany({ where: { userId: users['app-race'].id } });
  check(race.every((response) => response.status === 200) && raceMembers.length === 1,
    'two simultaneous ADMIN adds to different teams leave exactly one membership');
  check(race.filter((response) => hasFriendlyError(response.html)).length === 1,
    'concurrent losing add returns exactly one friendly error, not a raw DB failure');
  const raceLogs = await prisma.auditLog.findMany({ where: { entityId: raceMembers[0].id, action: 'SALES_TEAM_MEMBER_ADD' } });
  const expectedActor = raceMembers[0].teamId === teamA.id ? users.admin.id : users.adminOther.id;
  check(raceLogs.length === 1 && raceLogs[0].actorId === expectedActor && await prisma.auditLog.count() === beforeRaceAudits + 1,
    'concurrent app adds create one successful membership audit only');
  check(beforeRaceOwnership === await ownershipSnapshot(), 'concurrent app adds do not alter ownership or user/team data');

  // Bypass the application on purpose, using only this run's dedicated fixture user.
  const beforeDbAudits = await prisma.auditLog.count();
  const directRace = await Promise.allSettled([
    prisma.salesTeamMember.create({ data: { teamId: teamA.id, userId: users['db-race'].id } }),
    prisma.salesTeamMember.create({ data: { teamId: teamB.id, userId: users['db-race'].id } }),
  ]);
  check(directRace.filter((result) => result.status === 'fulfilled').length === 1
    && directRace.filter((result) => result.status === 'rejected' && result.reason?.code === 'P2002').length === 1,
  'direct concurrent Prisma creates: one success and one DB unique-constraint P2002');
  check(await prisma.salesTeamMember.count({ where: { userId: users['db-race'].id } }) === 1,
    'DB independently enforces a single team per Sales user');
  check(await prisma.auditLog.count() === beforeDbAudits, 'direct DB probe does not masquerade as an audited application action');
  const remainingDuplicates = await prisma.salesTeamMember.groupBy({ by: ['userId'], _count: { userId: true }, having: { userId: { _count: { gt: 1 } } } });
  check(remainingDuplicates.length === 0, 'post-verification membership invariant remains clean');
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
    if (baseline) check(baseline === await snapshot(), 'cleanup: original customer/task/team/user/activity/audit snapshot restored exactly');
  } finally {
    await prisma.$disconnect();
  }
}
console.log(`TEAM INTEGRITY VERIFICATION COMPLETE: ${assertions} assertions passed`);
