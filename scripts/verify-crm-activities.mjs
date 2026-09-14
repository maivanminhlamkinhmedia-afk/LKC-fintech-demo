import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { CustomerActivityType, PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

// Explicit fixture opt-in on local development/test data only. No migration or repair.
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
const marker = `crm011-${randomUUID()}`; const password = randomUUID();
const users = {}; const sessions = {}; const customers = {}; const userIds = []; const teamIds = [];
const manualTypes = ['NOTE', 'CALL', 'EMAIL', 'MEETING', 'MESSAGE'];
const titles = { NOTE: 'Ghi chú', CALL: 'Cuộc gọi', EMAIL: 'Email', MEETING: 'Cuộc họp', MESSAGE: 'Tin nhắn' };
const userSelect = { id: true, email: true, name: true, role: true, status: true, phone: true, lastLoginAt: true, createdAt: true, updatedAt: true };
let baseline; let passwordHash; let assertions = 0;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  assertions += 1; console.log(`PASS: ${label}`);
}
async function businessRows(contactCustomerId) {
  const profiles = await prisma.customerProfile.findMany({ orderBy: { id: 'asc' } });
  const rows = [profiles.map((profile) => {
    if (profile.id !== contactCustomerId) return profile;
    const stable = { ...profile }; delete stable.lastContactAt; delete stable.updatedAt; return stable;
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
    body: new URLSearchParams({ csrfToken, email: user.email, password, json: 'true', callbackUrl: `${base.origin}/sales/customers` }),
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
const articles = (html) => [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].map(([article]) => article).filter((article) => /data-activity-id=/.test(article));
function inputValue(form, name) {
  const input = [...form.matchAll(/<input\b[^>]*>/g)].map(([tag]) => tag).find((tag) => attribute(tag, 'name') === name);
  return input ? attribute(input, 'value') : undefined;
}
function interactionForm(html) {
  const form = forms(html).find((entry) => /data-interaction-form=/.test(entry));
  if (!form) throw new Error('Expected rendered manual interaction form');
  return form;
}
function identifiedForm(html, name, id) {
  const form = forms(html).find((entry) => inputValue(entry, name) === id);
  if (!form) throw new Error('Expected fixture system-action form');
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
function route(customer, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const entry of Array.isArray(value) ? value : [value]) query.append(key, entry);
  return `/sales/customers/${customer.id}${query.size ? `?${query}` : ''}`;
}
async function timeline(actor, customer, params = {}, expected = params, label = 'timeline') {
  const before = await snapshot(); const response = await request(sessions[actor], route(customer, params));
  check(response.status === 200, `${label}: authorized HTTP 200`);
  check(before === await snapshot(), `${label}: read-only GET`);
  const where = { customerId: customer.id, ...(expected.activityType ? { type: expected.activityType } : {}) };
  const total = await prisma.customerActivity.count({ where }); const pageCount = Math.max(1, Math.ceil(total / 20));
  const page = Math.min(Number(expected.activityPage || 1), pageCount);
  const expectedRows = await prisma.customerActivity.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, skip: (page - 1) * 20 });
  const wrapper = [...response.html.matchAll(/<[^>]*id="activity-timeline"[^>]*>/g)].map(([tag]) => tag)[0];
  check(wrapper && attribute(wrapper, 'data-activity-total') === String(total) && attribute(wrapper, 'data-activity-page') === String(page)
    && attribute(wrapper, 'data-activity-page-count') === String(pageCount), `${label}: scoped total and bounded/clamped page`);
  const rows = articles(response.html);
  check(hash(rows.map((row) => attribute(row, 'data-activity-id'))) === hash(expectedRows.map((row) => row.id))
    && rows.every((row, index) => attribute(row, 'data-activity-type') === expectedRows[index].type), `${label}: exact rows in createdAt DESC/id DESC order`);
  check(rows.every((row) => !/<form\b|<button\b/.test(row)), `${label}: activity rows have no edit/delete controls`);
  return response;
}
async function rejected(actor, customer, form, fields, label, kind = 'validation') {
  const before = await snapshot(); const response = await submit(actor, route(customer), form, fields);
  check(kind === 'role' ? response.status === 303 && response.location === '/dashboard'
    : kind === 'stale' ? [200, 404].includes(response.status) : response.status === 200, `${label}: safe response`);
  check(before === await snapshot(), `${label}: no activity, audit or other data mutation`);
}
function reportData(html) {
  const tags = [...html.matchAll(/<[^>]*\bdata-report-(?:metric|distribution|row|table)="[^"]*"[^>]*>/g)].map(([tag]) => tag);
  const activityMetric = tags.find((tag) => attribute(tag, 'data-report-metric') === 'activities');
  const types = Object.fromEntries(tags.filter((tag) => attribute(tag, 'data-report-distribution') === 'activity')
    .map((tag) => [attribute(tag, 'data-value'), Number(attribute(tag, 'data-count'))]));
  const stable = tags.filter((tag) => attribute(tag, 'data-report-metric') !== 'activities' && attribute(tag, 'data-report-distribution') !== 'activity');
  return { count: Number(attribute(activityMetric ?? '', 'data-count')), types,
    stable: hash(stable.map((tag) => [...tag.matchAll(/\bdata-[\w-]+="[^"]*"/g)].map(([value]) => value).sort())) };
}
async function report(actor) {
  const response = await request(sessions[actor], '/sales/reports?period=7d');
  check(response.status === 200 && /data-report-metric="activities"/.test(response.html), `${actor}: activity report available`);
  return reportData(response.html);
}
async function createInteraction(actor, customer, type, content, label, verifyReports = false) {
  const reportActors = ['admin', 'managerA', 'salesA', 'salesB']; const reportBefore = {};
  if (verifyReports) for (const key of reportActors) reportBefore[key] = await report(key);
  const form = interactionForm((await request(sessions[actor], route(customer))).html);
  const preserved = hash(await businessRows(type === 'NOTE' ? undefined : customer.id));
  const oldActivities = await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } });
  const oldAudits = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
  const started = Date.now(); const response = await submit(actor, route(customer), form, {
    customerId: customer.id, type, content, actorId: users.salesB.id, assignedSalesId: users.salesB.id,
    teamId: teamIds[1], title: 'Forged system event title', createdAt: '1900-01-01T00:00:00.000Z',
    status: 'CLOSED', priority: 'LOW', nextContactAt: '1900-01-01T00:00:00.000Z',
  });
  check(response.status === 200, `${label}: successful action response`);
  const afterActivities = await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } });
  const afterAudits = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
  const oldActivityIds = new Set(oldActivities.map((row) => row.id)); const oldAuditIds = new Set(oldAudits.map((row) => row.id));
  const additions = afterActivities.filter((row) => !oldActivityIds.has(row.id)); const newAudits = afterAudits.filter((row) => !oldAuditIds.has(row.id));
  check(additions.length === 1 && hash(afterActivities.filter((row) => oldActivityIds.has(row.id))) === hash(oldActivities), `${label}: one append-only activity; all historical rows preserved`);
  check(newAudits.length === 1 && hash(afterAudits.filter((row) => oldAuditIds.has(row.id))) === hash(oldAudits), `${label}: one append-only audit; all old audits preserved`);
  const activity = additions[0]; const audit = newAudits[0];
  check(activity.customerId === customer.id && activity.actorId === users[actor].id && activity.type === type
    && activity.content === content.trim() && activity.title === titles[type]
    && activity.createdAt.getTime() >= started - 1000 && activity.createdAt.getTime() <= Date.now() + 1000,
  `${label}: actual actor/customer/type, exact trimmed Unicode body and server-generated title/time`);
  check(audit.actorId === users[actor].id && audit.action === 'CUSTOMER_ACTIVITY_CREATE' && audit.entityType === 'CustomerProfile' && audit.entityId === customer.id
    && hash(Object.keys(audit.metadata).sort()) === hash(['activityId', 'activityType', 'customerId'])
    && audit.metadata.activityId === activity.id && audit.metadata.activityType === type && audit.metadata.customerId === customer.id,
  `${label}: exact linked audit IDs/type without interaction text or secrets`);
  check(preserved === hash(await businessRows(type === 'NOTE' ? undefined : customer.id)), `${label}: profile ownership/status/priority, tasks, teams, roles and unrelated fields unchanged`);
  if (type !== 'NOTE') {
    const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customer.id } });
    check(profile.lastContactAt?.getTime() === activity.createdAt.getTime()
      && profile.lastContactAt.getTime() >= started - 1000 && profile.lastContactAt.getTime() <= Date.now() + 1000,
    `${type}: existing contact invariant sets lastContactAt to the created activity timestamp`);
  }
  const refreshed = await timeline(actor, customer, { activityType: type }, { activityType: type }, `${label}: refreshed timeline`);
  const rendered = articles(refreshed.html).find((row) => attribute(row, 'data-activity-id') === activity.id);
  check(rendered && decodeHtml(rendered).includes(content.trim()) && rendered.includes(users[actor].name), `${label}: body and stored actor visible after refresh`);
  if (verifyReports) for (const key of reportActors) {
    const after = await report(key); const increment = key === 'salesB' || (key === 'salesA' && customer.assignedSalesId !== users.salesA.id) ? 0 : 1;
    check(after.count === reportBefore[key].count + increment && after.types[type] === reportBefore[key].types[type] + increment
      && Object.keys(after.types).every((activityType) => activityType === type || after.types[activityType] === reportBefore[key].types[activityType]),
    `${label}: ${key} report has exact scoped activity increment`);
    check(after.stable === reportBefore[key].stable, `${label}: ${key} customer/task/workload/distribution report data unchanged`);
  }
  return { activity, rendered };
}
async function createUser(key, role = 'CLIENT') {
  const user = await prisma.user.create({ data: { id: `${marker}-${key}`, email: `${marker}-${key.toLowerCase()}@example.test`, name: `${marker} ${key}`, password: passwordHash, role } });
  userIds.push(user.id); users[key] = user; return user;
}
async function createCustomer(key, salesId) {
  const user = await createUser(`customer-${key}`);
  const customer = await prisma.customerProfile.create({ data: { userId: user.id, customerCode: `${marker}-${key}`, assignedSalesId: salesId,
    status: 'LEAD', priority: 'HIGH', note: 'Preserve customer note', source: 'verification', lastContactAt: new Date('2020-01-01T00:00:00Z'), nextContactAt: new Date('2030-01-01T00:00:00Z') } });
  customers[key] = customer; return customer;
}

try {
  baseline = await snapshot(); passwordHash = await bcrypt.hash(password, 10);
  for (const [key, role] of Object.entries({ super: 'SUPER_ADMIN', admin: 'ADMIN', manager: 'MANAGER', managerA: 'SALES_MANAGER', managerB: 'SALES_MANAGER', salesA: 'SALES', salesPeer: 'SALES', salesB: 'SALES', client: 'CLIENT', creator: 'CREATOR', analyst: 'ANALYST', employee: 'EMPLOYEE' })) {
    sessions[key] = await login(await createUser(key, role));
  }
  const teamA = await prisma.salesTeam.create({ data: { name: `${marker} team A`, managerId: users.managerA.id } }); teamIds.push(teamA.id);
  const teamB = await prisma.salesTeam.create({ data: { name: `${marker} team B`, managerId: users.managerB.id } }); teamIds.push(teamB.id);
  await prisma.salesTeamMember.createMany({ data: [{ teamId: teamA.id, userId: users.salesA.id }, { teamId: teamA.id, userId: users.salesPeer.id }, { teamId: teamB.id, userId: users.salesB.id }] });
  const own = await createCustomer('own', users.salesA.id); const peer = await createCustomer('peer', users.salesPeer.id);
  const foreign = await createCustomer('foreign', users.salesB.id); const history = await createCustomer('history', users.salesA.id);
  const empty = await createCustomer('empty', users.salesA.id);
  const ownTask = await prisma.customerTask.create({ data: { customerId: own.id, assignedToId: users.salesB.id, createdById: users.admin.id, title: `${marker} own mismatched task`, status: 'TODO' } });
  await prisma.customerTask.create({ data: { customerId: foreign.id, assignedToId: users.salesA.id, createdById: users.admin.id, title: `${marker} foreign assigned task`, status: 'TODO' } });
  const foreignSecret = `${marker} foreign private activity`;
  await prisma.customerActivity.create({ data: { customerId: foreign.id, actorId: users.salesA.id, type: 'NOTE', title: 'Foreign activity', content: foreignSecret } });
  const nullSystem = await prisma.customerActivity.create({ data: { customerId: history.id, actorId: null, type: 'STATUS_CHANGE', title: 'Historical status', content: 'Nhật ký cũ <b>không HTML</b>', createdAt: new Date('2021-01-01T00:00:00Z') } });
  await prisma.customerActivity.create({ data: { customerId: history.id, actorId: null, type: 'ASSIGNMENT', title: 'Historical assignment', content: null, createdAt: new Date('2021-01-01T00:00:01Z') } });
  const storedActor = await prisma.customerActivity.create({ data: { customerId: history.id, actorId: users.salesB.id, type: 'CALL', title: 'Historical call', content: 'Stored actor, not current owner', createdAt: new Date('2021-01-01T00:00:02Z') } });
  const historicalIds = Array.from({ length: 42 }, (_, index) => `${marker}-history-${String(index).padStart(3, '0')}`);
  await prisma.customerActivity.createMany({ data: historicalIds.map((id) => ({ id, customerId: history.id, actorId: users.admin.id, type: 'NOTE', title: 'Same-time history', content: id, createdAt: new Date('2020-01-01T00:00:00Z') })) });

  for (const actor of ['super', 'admin', 'manager', 'managerA', 'salesA']) {
    const page = await timeline(actor, own, {}, {}, `${users[actor].role}: allowed customer timeline`);
    check(/data-interaction-form=/.test(page.html) === (actor !== 'manager'), `${users[actor].role}: interaction controls follow write permission`);
  }
  for (const actor of ['super', 'admin', 'manager']) await timeline(actor, foreign, {}, {}, `${users[actor].role}: global foreign customer timeline`);
  await timeline('managerA', peer, {}, {}, 'SALES_MANAGER: peer customer within team scope');
  for (const actor of ['managerA', 'salesA']) {
    const page = await request(sessions[actor], route(foreign, { activityType: 'NOTE', activityPage: '1000000', actorId: users[actor].id }));
    check(page.status === 404 && !page.html.includes(foreignSecret), `${actor}: foreign actor/task-assignee does not authorize customer history`);
  }
  for (const actor of ['client', 'creator', 'analyst', 'employee']) {
    const page = await request(sessions[actor], route(own));
    check(page.status === 307 && page.location === '/dashboard', `${users[actor].role}: timeline route blocked`);
  }
  const form = interactionForm((await request(sessions.admin, route(own))).html);
  const typeSelect = [...form.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map(([tag]) => tag).find((tag) => attribute(tag, 'name') === 'type');
  const choices = [...typeSelect.matchAll(/<option\b[^>]*>/g)].map(([tag]) => attribute(tag, 'value')).filter(Boolean);
  check(hash([...choices].sort()) === hash([...manualTypes].sort()), 'manual form offers exactly the five genuine manual enum types');
  for (const actor of ['manager', 'client', 'creator', 'analyst', 'employee']) {
    await rejected(actor, own, form, { customerId: own.id, type: 'NOTE', content: 'Unauthorized' }, `${users[actor].role}: stolen interaction form`, 'role');
  }
  const first = await timeline('salesA', history, { activityType: 'NOTE' }, { activityType: 'NOTE' }, 'NOTE history page 1');
  const second = await timeline('salesA', history, { activityType: 'NOTE', activityPage: '2' }, { activityType: 'NOTE', activityPage: 2 }, 'NOTE history page 2');
  check(hash(articles(first.html).map((row) => attribute(row, 'data-activity-id'))) === hash([...historicalIds].reverse().slice(0, 20)), 'identical timestamps have explicit id DESC tie-breaking');
  check(!articles(first.html).some((row) => articles(second.html).some((next) => attribute(next, 'data-activity-id') === attribute(row, 'data-activity-id'))), 'timeline pages do not duplicate entries');
  const pageLinks = [...first.html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => attribute(tag, 'href'));
  check(pageLinks.some((href) => { const url = new URL(href, base); return url.pathname === route(history) && url.searchParams.get('activityType') === 'NOTE' && url.searchParams.get('activityPage') === '2'; }), 'timeline pagination preserves activity type and customer');
  await timeline('salesA', history, { activityType: 'NOTE', activityPage: '1000000' }, { activityType: 'NOTE', activityPage: 1000000 }, 'huge valid page clamps to final entries');
  for (const type of Object.values(CustomerActivityType)) await timeline('salesA', history, { activityType: type }, { activityType: type }, `real enum timeline filter ${type}`);
  for (const [params, label] of [[{ activityType: 'FAKE' }, 'invalid type'], [{ activityType: ['NOTE', 'ASSIGNMENT'] }, 'repeated type'], [{ activityPage: '-1' }, 'negative page'], [{ activityPage: ['1', '2'] }, 'repeated page'], [{ activityPage: '999999999999' }, 'overlong page']]) {
    await timeline('salesA', history, params, {}, `safe timeline input: ${label}`);
  }
  await timeline('salesA', history, { customerId: foreign.id, actorId: users.salesB.id, salesId: users.salesB.id }, {}, 'foreign extra URL fields cannot change customer boundary');
  await timeline('salesA', empty, {}, {}, 'empty customer history');
  const historicalPage = await timeline('salesA', history, {}, {}, 'manual and system historical rows');
  const systemArticle = articles(historicalPage.html).find((row) => attribute(row, 'data-activity-id') === nullSystem.id);
  const actorArticle = articles(historicalPage.html).find((row) => attribute(row, 'data-activity-id') === storedActor.id);
  check(systemArticle && /Hệ thống|Không rõ|Không xác định|Chưa ghi nhận|Không có/.test(decodeHtml(systemArticle))
    && !systemArticle.includes(users.salesA.name) && !systemArticle.includes(users.admin.name), 'null historical actor is neutral, never fabricated from owner/session');
  check(systemArticle.includes('&lt;b&gt;') && !systemArticle.includes('<b>không HTML</b>'), 'historical system content renders escaped text');
  check(actorArticle?.includes(users.salesB.name) && !actorArticle.includes(users.salesA.name), 'historical actor uses stored relation even when different from current owner');

  for (const [actor, customer, type] of [['super', own, 'NOTE'], ['admin', own, 'CALL'], ['managerA', peer, 'EMAIL'], ['salesA', own, 'MEETING'], ['salesA', own, 'MESSAGE']]) {
    await createInteraction(actor, customer, type, ` \n ${marker} Nguyễn Thị Ánh — ${type}: ghi nhận thật. \n `, `${users[actor].role} ${type}`, true);
  }
  await createInteraction('salesA', own, 'NOTE', 'Đ'.repeat(5000), 'exact 5000-unit Unicode limit');
  await createInteraction('salesA', own, 'NOTE', '😀'.repeat(2500), 'exact UTF-16 limit with astral Unicode');
  const htmlText = `${marker} <script data-crm-verifier="text">alert("text")</script><img src=x onerror="alert(1)"> & nội dung`;
  const htmlResult = await createInteraction('salesA', own, 'NOTE', htmlText, 'HTML-looking interaction stays text');
  check(htmlResult.rendered.includes('&lt;script') && htmlResult.rendered.includes('&lt;img')
    && !htmlResult.rendered.includes('<script data-crm-verifier=') && !htmlResult.rendered.includes('<img src=x'), 'script/image-looking content is escaped, not executable markup');
  const valid = { customerId: own.id, type: 'NOTE', content: `${marker} rejected input` };
  for (const [fields, label] of [
    [{ ...valid, content: '' }, 'empty body'], [{ ...valid, content: ' \n\t ' }, 'whitespace body'], [{ ...valid, content: null }, 'missing body'],
    [{ ...valid, content: 'x'.repeat(5001) }, 'overlong body'], [{ ...valid, content: '😀'.repeat(2501) }, 'overlong UTF-16 body'],
    [{ ...valid, type: 'INVALID' }, 'invalid enum'], [{ ...valid, type: 'STATUS_CHANGE' }, 'reserved status event'], [{ ...valid, type: 'ASSIGNMENT' }, 'reserved assignment event'],
    [{ ...valid, type: null }, 'missing type'], [{ ...valid, customerId: '../bad' }, 'malformed customer ID'], [{ ...valid, customerId: `${marker}-missing` }, 'nonexistent customer'],
    [{ ...valid, customerId: [own.id, foreign.id] }, 'repeated customer ID'], [{ ...valid, type: ['NOTE', 'CALL'] }, 'repeated type'], [{ ...valid, content: ['one', 'two'] }, 'repeated body'],
    [{ ...valid, content: new File(['plain text'], 'content.txt', { type: 'text/plain' }) }, 'file instead of body'],
    [{ ...valid, customerId: new File([own.id], 'id.txt') }, 'file instead of customer ID'], [{ ...valid, type: new File(['NOTE'], 'type.txt') }, 'file instead of type'],
  ]) await rejected('salesA', own, form, fields, `validation: ${label}`);
  for (const actor of ['salesA', 'managerA']) await rejected(actor, own, form, { ...valid, customerId: foreign.id, actorId: users[actor].id }, `${actor}: foreign customer despite forged actor`);
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'CLIENT' } });
  await rejected('salesA', own, form, valid, 'demoted Sales session cannot log interaction', 'role');
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'SALES' } });

  // Real existing system actions create events; CRM-011 does not fabricate them.
  const pipelinePath = `/sales/pipeline?q=${encodeURIComponent(own.customerCode)}`;
  const pipeline = await request(sessions.admin, pipelinePath);
  const pipelineResult = await submit('admin', pipelinePath, identifiedForm(pipeline.html, 'customerId', own.id), { customerId: own.id, status: 'PROSPECT' });
  check(pipelineResult.status === 200 && await prisma.customerActivity.count({ where: { customerId: own.id, type: 'STATUS_CHANGE', actorId: users.admin.id } }) === 1, 'real CRM-007 pipeline action still creates status activity');
  await timeline('salesA', own, { activityType: 'STATUS_CHANGE' }, { activityType: 'STATUS_CHANGE' }, 'generated pipeline event remains filterable/readable');
  const assignment = await request(sessions.admin, '/sales/assignment');
  const assignmentForm = identifiedForm(assignment.html, 'customerId', own.id);
  const changed = await submit('admin', '/sales/assignment', assignmentForm, { customerId: own.id, salesId: users.salesB.id });
  check(changed.status === 200 && (await prisma.customerProfile.findUniqueOrThrow({ where: { id: own.id } })).assignedSalesId === users.salesB.id, 'real assignment workflow reassigns fixture customer');
  for (const actor of ['salesA', 'managerA']) await rejected(actor, own, form, valid, `${actor}: stale interaction form after reassignment`, 'stale');
  await timeline('salesB', own, { activityType: 'ASSIGNMENT' }, { activityType: 'ASSIGNMENT' }, 'new customer owner sees generated assignment event');
  const restored = await submit('admin', '/sales/assignment', assignmentForm, { customerId: own.id, salesId: users.salesA.id });
  check(restored.status === 200 && await prisma.customerActivity.count({ where: { customerId: own.id, type: 'ASSIGNMENT' } }) === 2, 'existing assignment restoration appends second event');

  const peerForm = interactionForm((await request(sessions.managerA, route(peer))).html);
  const membership = await prisma.salesTeamMember.findUniqueOrThrow({ where: { userId: users.salesPeer.id } });
  const teamPath = `/sales/teams/${teamA.id}`;
  const teamPage = await request(sessions.admin, teamPath);
  const removalForm = identifiedForm(teamPage.html, 'membershipId', membership.id); const warningBefore = await snapshot();
  const warning = await submit('admin', teamPath, removalForm, {});
  check(warning.status === 200 && warningBefore === await snapshot(), 'CRM-008 removal with assigned customer first warns without mutation');
  const confirmationForm = identifiedForm(warning.html, 'membershipId', membership.id); const token = inputValue(confirmationForm, 'confirmationToken');
  check(Boolean(token), 'CRM-008 warning supplies genuine server confirmation token');
  const peerBefore = await prisma.customerProfile.findUniqueOrThrow({ where: { id: peer.id } });
  const historyBeforeRemoval = await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } });
  const removed = await submit('admin', teamPath, confirmationForm, { confirmationToken: token, confirmation: 'REMOVE_MEMBERSHIP_KEEP_ASSIGNMENTS' });
  check(removed.status === 200 && await prisma.salesTeamMember.findUnique({ where: { id: membership.id } }) === null, 'real CRM-008 explicit confirmation removes membership');
  check(hash(peerBefore) === hash(await prisma.customerProfile.findUniqueOrThrow({ where: { id: peer.id } }))
    && hash(historyBeforeRemoval) === hash(await prisma.customerActivity.findMany({ orderBy: { id: 'asc' } })), 'safe removal preserves customer ownership and all activity history');
  await rejected('managerA', peer, peerForm, { customerId: peer.id, type: 'NOTE', content: 'Stale manager form' }, 'removed team membership revokes manager interaction scope', 'stale');
  check((await request(sessions.managerA, route(peer))).status === 404, 'removed team membership revokes manager timeline read');
  await timeline('salesPeer', peer, {}, {}, 'Sales still reads own customer after removal from team');
  const detail = await request(sessions.salesA, route(own)); const activitiesBeforeTask = await prisma.customerActivity.count();
  const taskResult = await submit('salesA', route(own), identifiedForm(detail.html, 'taskId', ownTask.id), { taskId: ownTask.id, status: 'DONE' });
  check(taskResult.status === 200 && (await prisma.customerTask.findUniqueOrThrow({ where: { id: ownTask.id } })).status === 'DONE'
    && await prisma.customerActivity.count() === activitiesBeforeTask, 'CRM-009 shared task update works without inventing activity events');
  for (const path of ['/sales', '/sales/customers', route(own), '/sales/pipeline', '/sales/follow-ups', '/sales/reports', '/sales/assignment', '/sales/teams', teamPath]) {
    check((await request(sessions.admin, path)).status === 200, `regression route ${path.replace(own.id, '[id]').replace(teamA.id, '[id]')}`);
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
console.log(`ACTIVITY VERIFICATION COMPLETE: ${assertions} assertions passed`);
