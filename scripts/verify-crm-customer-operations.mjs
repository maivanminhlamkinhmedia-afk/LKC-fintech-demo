import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { CustomerPriority, CustomerStatus, PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

// Explicit opt-in and isolated local/test fixtures only. No seed, migration or repair.
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
const marker = `crm014-${randomUUID()}`; const password = randomUUID();
const users = {}; const sessions = {}; const customers = {}; const userIds = []; const teamIds = [];
const day = 86_400_000; const offset = 7 * 3_600_000;
const priorities = Object.values(CustomerPriority);
const columns = ['customerCode', 'name', 'email', 'status', 'priority', 'assignedSalesName', 'lastContactAt', 'nextContactAt', 'createdAt'];
const filterKeys = ['q', 'status', 'priority', 'salesId', 'teamId', 'followUp', 'task'];
const reportActors = ['admin', 'managerA', 'salesA', 'salesB'];
const userSelect = { id: true, email: true, name: true, role: true, status: true, phone: true, lastLoginAt: true, createdAt: true, updatedAt: true };
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = (value) => value?.toISOString() ?? '';
const detailPath = (customer) => `/sales/customers/${customer.id}`;
let baseline; let passwordHash; let assertions = 0;
function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  assertions += 1; console.log(`PASS: ${label}`);
}
async function businessRows(changedIds = []) {
  const changed = new Set(changedIds);
  const profiles = await prisma.customerProfile.findMany({ orderBy: { id: 'asc' } });
  const rows = [profiles.map((profile) => {
    if (!changed.has(profile.id)) return profile;
    const stable = { ...profile }; delete stable.priority; delete stable.updatedAt; return stable;
  })];
  rows.push(...await Promise.all(['customerTask', 'customerActivity', 'salesTeam', 'salesTeamMember'].map((model) => prisma[model].findMany({ orderBy: { id: 'asc' } }))));
  rows.push(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: userSelect }));
  return rows;
}
const auditRows = () => prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
async function snapshot() { return hash([await businessRows(), await auditRows()]); }
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
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Preserve the BOM for independent byte/CSV assertions; fail on malformed UTF-8.
  return { status: response.status, location: response.headers.get('location'), headers: response.headers,
    bytes, html: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
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
function queryPath(path, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const entry of Array.isArray(value) ? value : [value]) query.append(key, entry);
  return `${path}${query.size ? `?${query}` : ''}`;
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
  if (!form) throw new Error('Expected rendered fixture existing-action form');
  return form;
}
function bulkForm(html) {
  const form = forms(html).find((entry) => /data-customer-bulk-form=/.test(entry));
  if (!form) throw new Error('Expected rendered customer bulk-priority form');
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

// Independent fixture oracle, never imports production scope, filters or CSV code.
async function filteredCustomers(actor, filters = {}) {
  const [profiles, memberships, teams, taskRows] = await Promise.all([
    prisma.customerProfile.findMany({ include: { user: { select: { name: true, email: true } }, assignedSales: { select: { name: true } } } }),
    prisma.salesTeamMember.findMany(), prisma.salesTeam.findMany(), prisma.customerTask.findMany(),
  ]);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: users[actor].id }, select: { role: true } });
  const managed = new Set(teams.filter((team) => team.managerId === users[actor].id).map((team) => team.id));
  const teamSales = new Set(memberships.filter((member) => managed.has(member.teamId)).map((member) => member.userId));
  const now = new Date(); const vietnam = new Date(now.getTime() + offset);
  const start = Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()) - offset;
  return profiles.filter((profile) => {
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user.role)
      && !(user.role === 'SALES_MANAGER' ? teamSales.has(profile.assignedSalesId) : user.role === 'SALES' && profile.assignedSalesId === users[actor].id)) return false;
    if (filters.q && ![profile.customerCode, profile.user.name, profile.user.email].some((value) => value.toLowerCase().includes(filters.q.toLowerCase()))) return false;
    if (filters.status && profile.status !== filters.status) return false;
    if (filters.priority && profile.priority !== filters.priority) return false;
    if (filters.salesId && profile.assignedSalesId !== filters.salesId) return false;
    if (filters.teamId && !memberships.some((member) => member.userId === profile.assignedSalesId && member.teamId === filters.teamId)) return false;
    const value = profile.nextContactAt;
    if (filters.followUp === 'none' && value !== null) return false;
    if (filters.followUp === 'overdue' && !(value !== null && value < now)) return false;
    if (filters.followUp === 'upcoming' && !(value !== null && value >= now)) return false;
    if (filters.followUp === 'today' && !(value !== null && value.getTime() >= start && value.getTime() < start + day)) return false;
    if (filters.task && !taskRows.some((task) => task.customerId === profile.id && ['TODO', 'IN_PROGRESS'].includes(task.status)
      && (filters.task === 'open' || task.dueAt !== null && task.dueAt < now))) return false;
    return true;
  });
}
function safeCell(value) {
  const text = value ?? ''; let index = 0; let leadingControl = false;
  while (index < text.length) {
    const code = text.charCodeAt(index); const control = code < 32 || code >= 127 && code <= 159;
    if (!control && !/\s/u.test(text[index]) && !['"', "'"].includes(text[index])) break;
    leadingControl ||= control; index += 1;
  }
  return leadingControl || '=+-@'.includes(text[index] ?? '\uffff') ? `'${text}` : text;
}
function expectedCells(profile) {
  return [profile.customerCode, profile.user.name, profile.user.email, profile.status, profile.priority,
    profile.assignedSales?.name ?? '', iso(profile.lastContactAt), iso(profile.nextContactAt), iso(profile.createdAt)].map(safeCell);
}
function parseCsv(text) {
  if (text[0] !== '\ufeff') throw new Error('Expected UTF-8 CSV BOM');
  let index = 1; let row = []; const rows = [];
  while (index < text.length) {
    if (text[index++] !== '"') throw new Error('Every CSV cell must be quoted');
    let value = ''; let closed = false;
    while (index < text.length) {
      const char = text[index++];
      if (char !== '"') value += char;
      else if (text[index] === '"') { value += '"'; index += 1; }
      else { closed = true; break; }
    }
    if (!closed) throw new Error('Unclosed CSV cell');
    row.push(value);
    if (text[index] === ',') index += 1;
    else if (text.slice(index, index + 2) === '\r\n') { rows.push(row); row = []; index += 2; }
    else throw new Error('CSV records must terminate with CRLF');
  }
  if (row.length) throw new Error('Incomplete CSV record');
  return rows;
}
async function exportCsv(actor, params = {}, expected = params, label = 'export') {
  const stable = hash(await businessRows()); const oldAudits = await auditRows();
  const profiles = (await filteredCustomers(actor, expected)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const response = await request(sessions[actor], queryPath('/sales/customers/export', params));
  check(response.status === 200, `${actor} ${label}: authorized export HTTP 200`);
  check(response.headers.get('content-type')?.toLowerCase() === 'text/csv; charset=utf-8'
    && response.headers.get('content-disposition') === 'attachment; filename="lkc-customers.csv"'
    && response.headers.get('cache-control')?.includes('no-store'), `${label}: fixed safe filename, UTF-8 CSV and no-store headers`);
  check(hash([...response.bytes.slice(0, 3)]) === hash([239, 187, 191]), `${label}: actual UTF-8 BOM bytes`);
  const rows = parseCsv(response.html);
  check(hash(rows[0]) === hash(columns) && rows.every((row) => row.length === 9), `${label}: exactly nine minimal columns and well-formed quoted CRLF records`);
  check(hash(rows.slice(1)) === hash(profiles.map(expectedCells)), `${label}: complete independently scoped/filtered dataset, deterministic order and exact safe cell content`);
  check(stable === hash(await businessRows()), `${label}: no customer/task/contact/activity/team/user writes`);
  const audits = await auditRows(); const ids = new Set(oldAudits.map((row) => row.id)); const additions = audits.filter((row) => !ids.has(row.id));
  check(additions.length === 1 && hash(audits.filter((row) => ids.has(row.id))) === hash(oldAudits), `${label}: exactly one append-only export audit`);
  const audit = additions[0]; const metadata = { rowCount: profiles.length, filtersActive: filterKeys.some((key) => Boolean(expected[key])), format: 'csv' };
  check(audit?.action === 'CUSTOMER_CSV_EXPORT' && audit.actorId === users[actor].id && audit.entityType === 'CustomerProfile' && audit.entityId === null
    && hash(Object.keys(audit.metadata).sort()) === hash(Object.keys(metadata).sort()) && Object.keys(metadata).every((key) => audit.metadata[key] === metadata[key]), `${label}: aggregate audit contains only rowCount/filter-presence/format, no fake entity or private query/content`);
  for (const forbidden of [password, passwordHash, `${marker}-PRIVATE-NOTE`, `${marker}-PRIVATE-ACTIVITY`, `${marker}-PRIVATE-TASK`, `${marker}-PRIVATE-SOURCE`]) {
    check(!response.html.includes(forbidden), `${label}: excluded sensitive fixture field absent`);
  }
  return rows;
}
async function exportRejected(actor, params, label, status = 400) {
  const before = await snapshot(); const response = await request(sessions[actor] ?? '', queryPath('/sales/customers/export', params));
  check(Array.isArray(status) ? status.includes(response.status) : response.status === status, `${label}: safe rejected export response`);
  check(!response.headers.get('content-type')?.includes('text/csv') && !response.headers.get('content-disposition')
    && !response.html.includes(customers.foreign.customerCode), `${label}: no partial CSV, download header or foreign customer value`);
  check(before === await snapshot(), `${label}: no business mutation or export success audit`);
  return response;
}
const dataTags = (html, pattern) => [...html.matchAll(/<[^>]*\bdata-[\w-]+="[^"]*"[^>]*>/g)].map(([tag]) => tag).filter((tag) => pattern.test(tag));
const dataAttributes = (tag) => Object.fromEntries([...tag.matchAll(/\b(data-[\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decodeHtml(value)]));
const stableObjects = (rows) => hash(rows.map((row) => Object.entries(row).sort()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
const customerLinks = (html) => [...new Set([...html.matchAll(/href="\/sales\/customers\/([^"?]+)"/g)].map(([, id]) => decodeHtml(id)).filter((id) => id !== 'export'))];
async function list(actor, params = { q: marker }, verifyControls = true) {
  const before = await snapshot(); const response = await request(sessions[actor], queryPath('/sales/customers', params));
  check(response.status === 200 && before === await snapshot(), `${actor}: customer list GET remains authorized/read-only`);
  const expected = (await filteredCustomers(actor, params)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const page = Math.min(Number(params.page || 1), Math.max(1, Math.ceil(expected.length / 30)));
  const visible = expected.slice((page - 1) * 30, page * 30).map((row) => row.id);
  check(hash(customerLinks(response.html)) === hash(visible), `${actor}: list preserves exact customer order, scope and bounded current page`);
  if (verifyControls) {
    const canWrite = ['SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES'].includes(users[actor].role);
    const bulk = forms(response.html).filter((form) => /data-customer-bulk-form=/.test(form));
    check(bulk.length === Number(canWrite), `${actor}: bulk controls follow existing write permission`);
    if (canWrite) {
      const choices = [...bulk[0].matchAll(/<input\b[^>]*>/g)].map(([tag]) => tag).filter((tag) => attribute(tag, 'name') === 'customerIds');
      check(hash(choices.map((tag) => attribute(tag, 'value'))) === hash(visible)
        && choices.every((tag) => attribute(tag, 'type') === 'checkbox'), `${actor}: only visible authorized customers have selection checkboxes`);
      const select = [...bulk[0].matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map(([tag]) => tag).find((tag) => attribute(tag, 'name') === 'priority');
      check(select && hash([...select.matchAll(/<option\b[^>]*>/g)].map(([tag]) => attribute(tag, 'value')).filter(Boolean).sort()) === hash([...priorities].sort()), `${actor}: bulk selector uses CustomerPriority, never task URGENT`);
    }
    const link = dataTags(response.html, /data-customer-export=/)[0];
    const url = new URL(attribute(link ?? '', 'href'), base);
    const expectedQuery = new URLSearchParams(); for (const key of filterKeys) if (params[key]) expectedQuery.set(key, params[key]);
    check(Boolean(link) && url.pathname === '/sales/customers/export' && hash([...url.searchParams].sort()) === hash([...expectedQuery].sort()), `${actor}: export link keeps only supported dataset filters, never pagination or unknown fields`);
  }
  return response;
}
async function report(actor, priority) {
  const response = await request(sessions[actor], queryPath('/sales/reports', { period: '7d', ...(priority ? { priority } : {}) }));
  const tags = dataTags(response.html, /data-report-/).map(dataAttributes);
  check(response.status === 200 && tags.filter((tag) => tag['data-report-metric']).length === 7, `${actor}: complete existing report available`);
  const distribution = Object.fromEntries(tags.filter((tag) => tag['data-report-distribution'] === 'priority').map((tag) => [tag['data-value'], Number(tag['data-count'])]));
  return { distribution, stable: stableObjects(tags.filter((tag) => tag['data-report-distribution'] !== 'priority')), full: stableObjects(tags),
    total: Number(tags.find((tag) => tag['data-report-metric'] === 'customers')?.['data-count']) };
}
async function health(actor) {
  const response = await request(sessions[actor], '/sales'); const tags = dataTags(response.html, /data-contact-health=/);
  check(response.status === 200 && tags.length === 4, `${actor}: contact-health snapshot available`);
  const high = decodeHtml(response.html).match(/<p\b[^>]*>\s*Ưu tiên cao\s*<\/p>\s*<p\b[^>]*>\s*(\d+)\s*<\/p>/u);
  const expected = (await filteredCustomers(actor, { priority: 'HIGH' })).filter((customer) => customer.status !== 'CLOSED').length;
  check(Boolean(high) && Number(high[1]) === expected, `${actor}: dashboard HIGH count exactly reflects scoped non-CLOSED customers`);
  return stableObjects(tags.map(dataAttributes));
}
async function assignment() {
  const before = await snapshot(); const response = await request(sessions.admin, '/sales/assignment');
  const profiles = await prisma.customerProfile.findMany(); const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const rendered = [...response.html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([row]) => row).filter((row) => /name="customerId"/.test(row));
  const ordered = rendered.map((row) => byId.get(inputValue(row, 'customerId')));
  check(response.status === 200 && before === await snapshot() && ordered.length === Math.min(profiles.length, 300), 'assignment remains bounded/read-only with unchanged customer membership');
  check(ordered.every((profile, index) => profile && (index === 0 || priorities.indexOf(ordered[index - 1].priority) > priorities.indexOf(profile.priority)
    || ordered[index - 1].priority === profile.priority && ordered[index - 1].updatedAt >= profile.updatedAt)), 'assignment ordering reflects current customer priority then updatedAt without reassignment');
  check(rendered.every((row, index) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell);
    return cells[2]?.trim() === ordered[index].priority;
  }), 'assignment priority column displays the updated CustomerProfile value');
}
async function workbench(actor, customerPriority) {
  const response = await request(sessions[actor], queryPath('/sales/follow-ups', { q: marker, ...(customerPriority ? { customerPriority } : {}) }));
  const visible = new Set((await filteredCustomers(actor, { q: marker, ...(customerPriority ? { priority: customerPriority } : {}) })).map((customer) => customer.id));
  const expected = (await prisma.customerTask.findMany()).filter((task) => visible.has(task.customerId));
  const ids = dataTags(response.html, /data-task-id=/).map((tag) => attribute(tag, 'data-task-id'));
  check(response.status === 200 && hash(ids.sort()) === hash(expected.map((task) => task.id).sort()), `${actor}: follow-up customerPriority filter reflects customer changes without changing task priority`);
  const metrics = dataTags(response.html, /data-metric=/).map(dataAttributes);
  return stableObjects(metrics);
}
async function changePriorities(actor, selected, priority, label, verifyReports = false) {
  const page = await list(actor); const form = bulkForm(page.html);
  const unique = [...new Set(selected)];
  const current = await prisma.customerProfile.findMany({ where: { id: { in: unique } }, orderBy: { id: 'asc' } });
  const changed = current.filter((customer) => customer.priority !== priority); const changedIds = changed.map((customer) => customer.id);
  const reports = {}; const healthBefore = {}; const scopes = {};
  if (verifyReports) for (const key of reportActors) {
    reports[key] = await report(key); healthBefore[key] = await health(key);
    scopes[key] = new Set((await filteredCustomers(key)).map((customer) => customer.id));
  }
  const workbenchBefore = verifyReports ? await workbench('admin') : null;
  const stable = hash(await businessRows(changedIds)); const fullBefore = await snapshot(); const oldAudits = await auditRows(); const started = Date.now();
  const response = await submit(actor, queryPath('/sales/customers', { q: marker }), form, {
    customerIds: selected, priority, actorId: users.salesB.id, role: 'SUPER_ADMIN', assignedSalesId: users.salesB.id,
    status: 'CLOSED', nextContactAt: '2099-01-01T12:00', lastContactAt: '1900-01-01', source: 'forged', note: 'forged',
    taskId: 'forged-task', taskPriority: 'URGENT', assignedToId: users.salesB.id, teamId: teamIds[1], updatedAt: '1900-01-01',
  });
  check(response.status === 200 && !/role="alert"/.test(response.html), `${label}: bulk action reports success`);
  check(stable === hash(await businessRows(changedIds)), `${label}: only intended customer priority/updatedAt may change; all no-op customers/tasks/activities/contacts/ownership/teams/users preserved`);
  const after = await prisma.customerProfile.findMany({ where: { id: { in: unique } }, orderBy: { id: 'asc' } });
  check(after.length === unique.length && after.every((customer) => customer.priority === priority), `${label}: every unique selected customer reaches requested priority`);
  check(after.filter((customer) => changedIds.includes(customer.id)).every((customer) => customer.updatedAt.getTime() >= started - 1000), `${label}: changed timestamps are server/Prisma managed`);
  const audits = await auditRows(); const ids = new Set(oldAudits.map((audit) => audit.id)); const added = audits.filter((audit) => !ids.has(audit.id));
  check(added.length === changed.length && hash(audits.filter((audit) => ids.has(audit.id))) === hash(oldAudits), `${label}: exactly one audit per changed customer; no duplicate/no-op audit`);
  check(hash(added.map((audit) => audit.entityId).sort()) === hash([...changedIds].sort()) && added.every((audit) => {
    const previous = changed.find((customer) => customer.id === audit.entityId);
    const metadata = { customerId: previous.id, previousPriority: previous.priority, priority, bulk: true };
    return audit.actorId === users[actor].id && audit.action === 'CUSTOMER_BULK_PRIORITY_UPDATE' && audit.entityType === 'CustomerProfile'
      && hash(Object.keys(audit.metadata).sort()) === hash(Object.keys(metadata).sort()) && Object.keys(metadata).every((key) => audit.metadata[key] === metadata[key]);
  }), `${label}: exact per-customer actor/entity/old-new priority audit, with no sensitive free text`);
  if (!changed.length) check(fullBefore === await snapshot(), `${label}: full no-op preserves updatedAt and every audit row`);
  if (verifyReports) for (const key of reportActors) {
    const result = await report(key);
    for (const value of priorities) {
      const delta = changed.filter((customer) => scopes[key].has(customer.id)).reduce((sum, customer) => sum + Number(priority === value) - Number(customer.priority === value), 0);
      check(result.distribution[value] === reports[key].distribution[value] + delta, `${label}: ${key} exact scoped ${value} customer-priority distribution delta`);
    }
    check(result.stable === reports[key].stable, `${label}: ${key} customer/task/activity totals, status, ownership/workload and other report data unchanged`);
    check(healthBefore[key] === await health(key), `${label}: ${key} all contact-health counts unchanged`);
    for (const value of priorities) {
      const expectedCount = (await filteredCustomers(key, { priority: value })).length;
      check((await report(key, value)).total === expectedCount, `${label}: ${key} priority-filtered report uses current customer priority`);
    }
  }
  if (verifyReports) {
    await assignment();
    check(workbenchBefore === await workbench('admin'), `${label}: unfiltered workbench task metrics unchanged`);
    for (const value of priorities) {
      await workbench('admin', value);
      await list(actor, { q: marker, priority: value });
      const expected = await filteredCustomers(actor, { q: marker, priority: value });
      const pipeline = await request(sessions[actor], queryPath('/sales/pipeline', { q: marker, priority: value }));
      const bounded = Object.values(CustomerStatus).flatMap((status) => expected.filter((row) => row.status === status).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, 30));
      check(pipeline.status === 200 && hash(customerLinks(pipeline.html).sort()) === hash(bounded.map((row) => row.id).sort()), `${label}: existing priority-filtered pipeline updates without status mutation`);
    }
  }
}
async function bulkRejected(actor, form, fields, label, kind = 'validation') {
  const before = await snapshot(); const response = await submit(actor, queryPath('/sales/customers', { q: marker }), form, fields);
  check(kind === 'role' ? response.status === 303 && response.location === '/dashboard'
    : kind === 'inactive' ? response.status === 303 && ['/dang-nhap', '/dashboard'].includes(response.location)
      : response.status === 200, `${label}: safe rejected bulk response`);
  if (!['role', 'inactive'].includes(kind)) check(/role="alert"/.test(response.html), `${label}: handled error, not false success`);
  check(before === await snapshot(), `${label}: entire batch rejected with zero customer/task/activity/team/user/audit writes`);
  return response;
}
async function createUser(key, role = 'CLIENT', overrides = {}) {
  const user = await prisma.user.create({ data: { id: `${marker}-${key}`, email: `${marker}-${key.toLowerCase()}@example.test`, name: `${marker} ${key}`, password: passwordHash, role, ...overrides } });
  userIds.push(user.id); users[key] = user; return user;
}
async function createCustomer(key, assignedSalesId, overrides = {}, userOverrides = {}) {
  const user = await createUser(`customer-${key}`, 'CLIENT', userOverrides);
  const customer = await prisma.customerProfile.create({ data: { id: `${marker}-profile-${key}`, userId: user.id, customerCode: `${marker}-${key}`, assignedSalesId,
    status: 'LEAD', priority: 'MEDIUM', note: `${marker}-PRIVATE-NOTE`, source: `${marker}-PRIVATE-SOURCE`,
    lastContactAt: new Date('2020-01-01T00:00:00Z'), nextContactAt: null, createdAt: new Date('2020-01-01T00:00:00Z'), updatedAt: new Date('2021-01-01T00:00:00Z'), ...overrides } });
  customers[key] = customer; return customer;
}
async function createGroup(prefix, count, assignedSalesId) {
  const ids = [];
  for (let start = 0; start < count; start += 250) {
    const indexes = Array.from({ length: Math.min(250, count - start) }, (_, index) => `${prefix}-${String(start + index).padStart(5, '0')}`);
    const groupUsers = indexes.map((key) => ({ id: `${marker}-user-${key}`, email: `${marker}-${key}@example.test`, name: `${marker} ${key}`, password: passwordHash, role: 'CLIENT' }));
    // Record the exact random IDs before writes so even an uncertain response is cleanable.
    userIds.push(...groupUsers.map((user) => user.id));
    await prisma.user.createMany({ data: groupUsers });
    const profiles = indexes.map((key, index) => ({ id: `${marker}-profile-${key}`, userId: groupUsers[index].id, customerCode: `${marker}-${key}`, assignedSalesId,
      status: 'LEAD', priority: 'LOW', createdAt: new Date('2020-01-01T00:00:00Z'), updatedAt: new Date('2021-01-01T00:00:00Z') }));
    await prisma.customerProfile.createMany({ data: profiles }); ids.push(...profiles.map((profile) => profile.id));
  }
  return ids;
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
  const now = new Date(); const vietnam = new Date(now.getTime() + offset);
  const today = Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()) - offset;
  await createCustomer('own', users.salesA.id, { priority: 'LOW', nextContactAt: new Date(now.getTime() - day) });
  await createCustomer('ownHigh', users.salesA.id, { priority: 'HIGH', status: 'ACTIVE', nextContactAt: new Date(now.getTime() + 2 * day) });
  await createCustomer('peer', users.salesPeer.id, { priority: 'LOW', status: 'PROSPECT', nextContactAt: new Date(today + 12 * 3_600_000) });
  await createCustomer('foreign', users.salesB.id, { priority: 'LOW', status: 'CLOSED' });
  await createCustomer('unowned', null, { status: 'DORMANT', lastContactAt: null });
  await prisma.customerTask.createMany({ data: [
    { customerId: customers.own.id, assignedToId: users.salesB.id, createdById: users.admin.id, title: `${marker}-PRIVATE-TASK`, description: `${marker}-PRIVATE-TASK-DESCRIPTION`, priority: 'URGENT', status: 'TODO', dueAt: new Date(now.getTime() - day) },
    { customerId: customers.ownHigh.id, assignedToId: users.salesA.id, createdById: users.admin.id, title: `${marker} open future`, priority: 'LOW', status: 'IN_PROGRESS', dueAt: new Date(now.getTime() + day) },
    { customerId: customers.foreign.id, assignedToId: users.salesA.id, createdById: users.admin.id, title: `${marker} foreign assigned`, priority: 'HIGH', status: 'TODO', dueAt: new Date(now.getTime() - day) },
    { customerId: customers.peer.id, assignedToId: users.salesA.id, createdById: users.admin.id, title: `${marker} terminal`, priority: 'MEDIUM', status: 'DONE', completedAt: now, dueAt: new Date(now.getTime() - day) },
  ] });
  await prisma.customerActivity.createMany({ data: [
    { customerId: customers.own.id, actorId: users.admin.id, type: 'NOTE', title: `${marker}-PRIVATE-ACTIVITY`, content: `${marker}-PRIVATE-ACTIVITY-BODY` },
    { customerId: customers.foreign.id, actorId: users.salesA.id, type: 'CALL', title: `${marker}-PRIVATE-ACTIVITY`, content: `${marker}-PRIVATE-ACTIVITY-BODY` },
  ] });
  const batchIds = await createGroup('batch', 100, users.salesA.id);
  const dangerous = ['=1+1', '+SUM(A1:A2)', '-1+2', '@SUM(1,1)', '=HYPERLINK("https://example.invalid","x")', '"=cmd..."', '\t=1+1', '\r\n+1', '\u0085@SUM(1,1)', '\tordinary'];
  for (let index = 0; index < dangerous.length; index += 1) {
    const value = dangerous[index];
    await createCustomer(`csv${index}`, users.salesA.id, { customerCode: `${value} ${marker}-${index}`, lastContactAt: null },
      { name: `${value} ${marker}`, email: `${value}${index}-${marker}@example.test` });
  }
  await createCustomer('unicode', users.salesA.id, { customerCode: `${marker} comma,"quote"\r\nnext`, nextContactAt: new Date('2030-01-01T00:00:00.123Z') },
    { name: 'Nguyễn Ánh 🙂, "quoted"\r\nline two\nline three\rend; normal=value; e\u0301' });
  await createCustomer('literal', users.salesA.id, {}, { name: `${marker} literal_%\\search normal=value` });
  await prisma.user.update({ where: { id: users.salesA.id }, data: { name: '\t"=SUM(1,1)" Sales fixture' } });

  for (const actor of ['super', 'admin', 'manager', 'managerA', 'salesA']) {
    await list(actor); await exportCsv(actor, { q: marker }, { q: marker }, 'all fixture customers');
  }
  await exportCsv('admin', {}, {}, 'unfiltered authorized export audit');
  await exportCsv('salesA', { q: marker, page: '2' }, { q: marker }, 'page two exports the full dataset');
  for (const page of ['-1', ['2', '999999999999']]) await exportCsv('salesA', { q: marker, page }, { q: marker }, 'invalid/repeated page is not an export filter');
  await list('salesA', { q: marker, page: '2', arbitrary: 'must-not-export' });
  const full = await exportCsv('salesA', { q: marker }, { q: marker }, 'dataset larger than visible page');
  check(full.length - 1 > 30, 'export contains more than the 30-row current customer page');
  for (const status of Object.values(CustomerStatus)) await exportCsv('admin', { q: marker, status }, { q: marker, status }, `real customer status ${status}`);
  for (const priority of priorities) await exportCsv('admin', { q: marker, priority }, { q: marker, priority }, `real customer priority ${priority}`);
  for (const followUp of ['overdue', 'today', 'upcoming', 'none']) await exportCsv('admin', { q: marker, followUp }, { q: marker, followUp }, `canonical contact filter ${followUp}`);
  for (const task of ['open', 'overdue']) await exportCsv('admin', { q: marker, task }, { q: marker, task }, `canonical task filter ${task}`);
  await exportCsv('managerA', { q: marker, salesId: users.salesPeer.id, teamId: teamIds[0], status: 'PROSPECT', priority: 'LOW', followUp: 'today' }, undefined, 'combined independent customer filters');
  await exportCsv('salesA', { q: ' literal_%\\search ' }, { q: 'literal_%\\search' }, 'trimmed literal wildcard search');
  await exportCsv('salesA', { q: ` ${marker} `, priority: ' LOW ', unrelated: 'x', actorId: users.admin.id }, { q: marker, priority: 'LOW' }, 'safe normalized filters and ignored extra identities');
  for (const actor of ['salesA', 'managerA']) {
    for (const foreign of [{ salesId: users.salesB.id }, { teamId: teamIds[1] }]) {
      const rows = await exportCsv(actor, { q: marker, ...foreign }, { q: marker, ...foreign }, 'foreign URL filter cannot broaden scope');
      check(rows.length === 1, `${actor}: foreign filter yields only header, no foreign count/rows`);
    }
  }
  for (const [key, values] of Object.entries({
    q: ['x'.repeat(121), 'private\nquery', [marker, marker]], status: ['NOT_REAL', ['LEAD', 'CLOSED']], priority: ['URGENT', ['LOW', 'HIGH']],
    salesId: ['../foreign', [users.salesA.id, users.salesB.id]], teamId: ['bad/id', [teamIds[0], teamIds[1]]], followUp: ['invalid', ['none', 'today']], task: ['DONE', ['open', 'overdue']],
  })) for (let index = 0; index < values.length; index += 1) await exportRejected('admin', { q: marker, [key]: values[index] }, `invalid/repeated export ${key} case ${index + 1}`);
  const invalidListBefore = await snapshot(); const invalidPage = await request(sessions.admin, queryPath('/sales/customers', { q: marker, priority: 'INVALID' }));
  check(invalidPage.status === 200 && !/data-customer-export=/.test(invalidPage.html) && invalidListBefore === await snapshot(), 'list safely normalizes malformed filter but disables broadened export link');
  const headBefore = await snapshot(); const head = await request(sessions.admin, '/sales/customers/export', { method: 'HEAD' });
  check(head.status === 405 && headBefore === await snapshot(), 'HEAD cannot accidentally create a CSV export audit');

  const form = bulkForm((await list('admin')).html);
  const valid = { customerIds: [customers.own.id], priority: 'HIGH' };
  await exportRejected('anonymous', { q: marker }, 'anonymous export is blocked before data/audit', [307, 401, 403]);
  for (const actor of ['client', 'creator', 'analyst', 'employee']) {
    const before = await snapshot(); const page = await request(sessions[actor], '/sales/customers');
    check(page.status === 307 && page.location === '/dashboard' && before === await snapshot(), `${actor}: customer list read blocked`);
    await exportRejected(actor, { q: marker }, `${actor}: export denied`, [307, 403]);
  }
  for (const actor of ['manager', 'client', 'creator', 'analyst', 'employee']) await bulkRejected(actor, form, valid, `${actor}: stolen bulk form denied`, 'role');
  await changePriorities('super', [customers.unowned.id], 'HIGH', 'SUPER_ADMIN one unowned customer', true);
  await changePriorities('admin', [customers.foreign.id, customers.own.id, customers.ownHigh.id], 'HIGH', 'ADMIN mixed changed and no-op selection', true);
  await changePriorities('managerA', [customers.peer.id, customers.own.id], 'MEDIUM', 'SALES_MANAGER own team multiple customers', true);
  await changePriorities('salesA', [customers.own.id, customers.own.id, customers.ownHigh.id], 'LOW', 'SALES duplicates deduplicated and own customer with foreign task assignee', true);
  await changePriorities('salesA', [customers.own.id, customers.ownHigh.id], 'LOW', 'all authorized no-op selection', true);
  await changePriorities('salesA', batchIds, 'MEDIUM', 'exact maximum 100 distinct selected customers');
  await changePriorities('salesA', Array(100).fill(customers.own.id), 'HIGH', 'exact 100 occurrences deduplicate to one intended update');
  for (const [value, label] of [[null, 'missing'], [[], 'empty'], ['', 'blank'], [' bad', 'leading whitespace'], ['../bad', 'path'], ['x'.repeat(192), 'overlong'],
    [new File(['id'], 'id.txt'), 'File'], [[customers.own.id, new File(['id'], 'id.txt')], 'mixed string and File'],
    [[...batchIds, customers.own.id], '101 unique'], [Array(101).fill(customers.own.id), '101 repeated occurrences']]) {
    await bulkRejected('salesA', form, { ...valid, customerIds: value }, `selection ${label}`);
  }
  for (const priority of [null, '', 'high', ' HIGH', 'LOW ', 'URGENT', 'HIGH\n', ['LOW', 'HIGH'], ['HIGH', 'HIGH'], new File(['HIGH'], 'priority.txt')]) {
    await bulkRejected('salesA', form, { ...valid, priority }, 'invalid singleton customer priority');
  }
  for (const actor of ['salesA', 'managerA']) {
    for (const id of [customers.foreign.id, customers.unowned.id, `${marker}-missing`]) {
      const response = await bulkRejected(actor, form, { customerIds: [customers.own.id, id], priority: 'LOW' }, `${actor}: one foreign/unowned/missing ID rejects the entire mixed batch`);
      const alerts = [...response.html.matchAll(/<p\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/p>/g)].map(([, text]) => decodeHtml(text));
      check(alerts.length > 0 && alerts.every((text) => !text.includes(id) && !/Prisma|MySQL|P20\d\d/.test(text)), `${actor}: batch error does not identify foreign/missing customer or leak database diagnostics`);
      await bulkRejected(actor, form, { customerIds: [id], priority: 'HIGH' }, `${actor}: foreign ID cannot bypass scope as an apparent no-op`);
    }
  }
  for (const status of ['SUSPENDED', 'DISABLED', 'INVITED']) {
    await prisma.user.update({ where: { id: users.salesA.id }, data: { status } });
    await exportRejected('salesA', { q: marker }, `${status}: stale export session denied`, [307, 403]);
    await bulkRejected('salesA', form, valid, `${status}: stale bulk session denied`, 'inactive');
    await prisma.user.update({ where: { id: users.salesA.id }, data: { status: 'ACTIVE' } });
  }
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'CLIENT' } });
  await exportRejected('salesA', { q: marker }, 'demotion revokes stale export session', [307, 403]);
  await bulkRejected('salesA', form, valid, 'demotion revokes stale bulk session', 'role');
  await prisma.user.update({ where: { id: users.salesA.id }, data: { role: 'SALES' } });

  const assignmentPage = await request(sessions.admin, '/sales/assignment');
  const assignmentForm = identifiedForm(assignmentPage.html, 'customerId', customers.own.id);
  const assignment = await submit('admin', '/sales/assignment', assignmentForm, { customerId: customers.own.id, salesId: users.salesB.id });
  check(assignment.status === 200 && (await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.own.id } })).assignedSalesId === users.salesB.id, 'real existing assignment moves fixture customer');
  for (const actor of ['salesA', 'managerA']) {
    const rows = await exportCsv(actor, { q: customers.own.customerCode, salesId: users.salesB.id }, undefined, 'completed reassignment revokes export scope');
    check(rows.length === 1, `${actor}: reassigned customer has no exported row/count`);
    await bulkRejected(actor, form, { customerIds: [customers.ownHigh.id, customers.own.id], priority: 'MEDIUM' }, `${actor}: old form after reassignment rejects entire batch`);
  }
  await changePriorities('salesB', [customers.own.id], 'MEDIUM', 'new customer owner can update priority');
  check((await submit('admin', '/sales/assignment', assignmentForm, { customerId: customers.own.id, salesId: users.salesA.id })).status === 200, 'existing assignment restores fixture owner');

  const peerForm = bulkForm((await list('managerA')).html);
  const membership = await prisma.salesTeamMember.findUniqueOrThrow({ where: { userId: users.salesPeer.id } });
  const teamPath = `/sales/teams/${teamIds[0]}`;
  const removalForm = identifiedForm((await request(sessions.admin, teamPath)).html, 'membershipId', membership.id);
  const beforeWarning = await snapshot(); const warning = await submit('admin', teamPath, removalForm, {});
  check(warning.status === 200 && beforeWarning === await snapshot(), 'CRM-008 membership removal warns with zero mutations');
  const confirmationForm = identifiedForm(warning.html, 'membershipId', membership.id); const token = inputValue(confirmationForm, 'confirmationToken');
  check(Boolean(token), 'genuine signed membership-removal confirmation received');
  const peerBefore = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.peer.id } });
  const taskBefore = hash(await prisma.customerTask.findMany({ orderBy: { id: 'asc' } }));
  const removal = await submit('admin', teamPath, confirmationForm, { confirmationToken: token, confirmation: 'REMOVE_MEMBERSHIP_KEEP_ASSIGNMENTS' });
  check(removal.status === 200 && await prisma.salesTeamMember.count({ where: { id: membership.id } }) === 0, 'real explicitly confirmed membership removal succeeds');
  check(hash(peerBefore) === hash(await prisma.customerProfile.findUniqueOrThrow({ where: { id: customers.peer.id } }))
    && taskBefore === hash(await prisma.customerTask.findMany({ orderBy: { id: 'asc' } })), 'team removal preserves complete customer and all tasks');
  const removed = await exportCsv('managerA', { q: customers.peer.customerCode }, undefined, 'removed team membership revokes export scope');
  check(removed.length === 1, 'manager export contains no removed-member customer row/count');
  await bulkRejected('managerA', peerForm, { customerIds: [customers.own.id, customers.peer.id], priority: 'HIGH' }, 'old manager form after membership removal rejects whole batch');
  await exportCsv('salesPeer', { q: customers.peer.customerCode }, undefined, 'Sales keeps own export after team removal');
  await changePriorities('salesPeer', [customers.peer.id], 'HIGH', 'Sales keeps own bulk write after team removal');
  const memberships = await prisma.salesTeamMember.findMany({ select: { userId: true } });
  check(new Set(memberships.map((member) => member.userId)).size === memberships.length, 'customer operations preserve unique team membership invariant');

  // Dedicated capped group: real exact-limit export and max+1 rejection, no truncation.
  console.log('Preparing isolated 5000-row export-cap fixtures in bounded batches.');
  await createGroup('cap', 5000, users.salesB.id);
  const atCap = await exportCsv('admin', { q: `${marker}-cap-` }, undefined, 'exact 5000-row cap');
  check(atCap.length === 5001, 'exact export maximum returns every data row plus header');
  await createCustomer('cap-extra', users.salesB.id);
  const overflow = await exportRejected('admin', { q: `${marker}-cap-` }, '5001 matching customers reject without partial CSV', 413);
  check(overflow.html.includes('5000') && !overflow.html.includes('5001'), 'cap message states fixed limit, not actual scoped count');
  await exportRejected('admin', { q: `${marker}-cap-`, priority: 'INVALID' }, 'invalid filter remains 400 even for oversized dataset', 400);
  const foreignCap = await exportCsv('salesA', { q: `${marker}-cap-` }, undefined, 'foreign oversized dataset cannot leak cap/count');
  check(foreignCap.length === 1, 'foreign 5001-row dataset remains a successful empty authorized export');
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
    }, { timeout: 30_000 });
    if (baseline) check(baseline === await snapshot(), 'cleanup: original customer/task/contact/activity/team/user/audit snapshot exactly restored');
  } finally { await prisma.$disconnect(); }
}
console.log(`CUSTOMER OPERATIONS VERIFICATION COMPLETE: ${assertions} assertions passed`);
