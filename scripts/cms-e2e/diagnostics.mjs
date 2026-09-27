import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const draftFile = 'tests/e2e/cms-draft.spec.ts'
const safetyFile = 'tests/e2e/cms-editor-safety.spec.ts'
const autosaveFile = 'tests/e2e/cms-autosave.spec.ts'
const formatSteps = [
  'FMT_LOGIN', 'FMT_INPUT', 'FMT_BOLD', 'FMT_LIST', 'FMT_CODE_BLOCK',
  'FMT_NO_WRITE', 'FMT_SAVE_NAVIGATE', 'FMT_DB', 'FMT_RELOAD',
  'FMT_DOM_TEXT', 'FMT_DOM_BOLD', 'FMT_DOM_LIST', 'FMT_DOM_CODE', 'FMT_LIST_LINK', 'FMT_DASHBOARD',
]
const clipboardSteps = [
  'CLIP_LOGIN', 'CLIP_PERMISSION', 'CLIP_INPUT', 'CLIP_WRITE', 'CLIP_NATIVE_PASTE',
  'CLIP_SAVE_NAVIGATE', 'CLIP_DB_CANONICAL', 'CLIP_DB_LINKS', 'CLIP_RELOAD',
  'CLIP_DOM_TEXT', 'CLIP_LINK_COUNT', 'CLIP_LINK_HREF', 'CLIP_LINK_TARGET',
  'CLIP_LINK_REL', 'CLIP_LINK_CLASS', 'CLIP_LINK_TITLE', 'CLIP_DANGEROUS_ELEMENTS',
  'CLIP_EVENT_ATTRIBUTES', 'CLIP_SCRIPT_EXECUTION',
  'CLIP_RELOAD_DOM_TEXT', 'CLIP_RELOAD_LINK_COUNT', 'CLIP_RELOAD_LINK_HREF', 'CLIP_RELOAD_LINK_TARGET',
  'CLIP_RELOAD_LINK_REL', 'CLIP_RELOAD_LINK_CLASS', 'CLIP_RELOAD_LINK_TITLE', 'CLIP_RELOAD_DANGEROUS_ELEMENTS',
  'CLIP_RELOAD_EVENT_ATTRIBUTES', 'CLIP_RELOAD_SCRIPT_EXECUTION',
]

// Full static titles are lookup keys only, never output. Prefix matching could
// otherwise leak user input appended to a test title.
const definitions = [
  ['EDIT-01', 'EDIT-01 anonymous new/edit redirects to login without article metadata'],
  ['EDIT-02-CLIENT', 'EDIT-02 client direct routes deny access'],
  ['EDIT-02-ANALYST', 'EDIT-02 analyst direct routes deny access'],
  ['EDIT-04/05/06/21', 'EDIT-04/05/06/21 create and refresh Vietnamese formatting with no writes from GET or typing', draftFile, formatSteps],
  ['EDIT-07', 'EDIT-07 creator foreign ID behaves like missing ID without revealing metadata'],
  ['EDIT-08', 'EDIT-08 creator saves own DRAFT and CHANGES_REQUESTED without changing status'],
  ['EDIT-09-ADMIN', 'EDIT-09 admin edits foreign drafts without reassigning the author'],
  ['EDIT-09-SUPER', 'EDIT-09 super edits foreign drafts without reassigning the author'],
  ['EDIT-10-CREATOR', 'EDIT-10 creator cannot edit articles outside DRAFT/CHANGES_REQUESTED'],
  ['EDIT-10-ADMIN', 'EDIT-10 admin cannot edit articles outside DRAFT/CHANGES_REQUESTED'],
  ['EDIT-10-SUPER', 'EDIT-10 super cannot edit articles outside DRAFT/CHANGES_REQUESTED'],
  ['EDIT-11', 'EDIT-11 suspended or demoted actor cannot save an already-open editor'],
  ['EDIT-12', 'EDIT-12 status and owner changes after opening cannot bypass the write guard'],
  ['EDIT-13', 'EDIT-13 simultaneous saves from two tabs have one winner and preserve the losing draft'],
  ['EDIT-14', 'EDIT-14 real DATETIME(3) tokens advance by one millisecond when stored time is ahead of the clock'],
  ['EDIT-15', 'EDIT-15 canonical slug collision is a form error with no duplicate article or metadata leak'],
  ['EDIT-16', 'EDIT-16 blank body saves without an author profile'],
  ['EDIT-22', 'EDIT-22 editor works at 390/768/desktop and exposes keyboard-operable controls'],
  ['EDIT-18', 'EDIT-18 real HTML clipboard paste removes unsafe content and persists canonical safe links', safetyFile, clipboardSteps],
  ['EDIT-20', 'EDIT-20 offline save retains the draft, dirty app-link dismissal stays in editor, and explicit retry succeeds', safetyFile],
  ['AUTO-01/02', 'AUTO-01/02 new stays manual and persisted edit stays idle until data changes', autosaveFile, ['AUTO_CREATE_IDLE']],
  ['AUTO-03/04/18', 'AUTO-03/04/18 latest metadata and native rich clipboard autosave round trip', autosaveFile, ['AUTO_RICH_ROUNDTRIP']],
  ['AUTO-05/06/07/23', 'AUTO-05/06/07/23 slow real ACK preserves typing and coalesces one latest tokened followup', autosaveFile, ['AUTO_SINGLE_FLIGHT']],
  ['AUTO-07', 'AUTO-07 manual flush before deadline and repeated clean clicks make one update', autosaveFile, ['AUTO_MANUAL_FLUSH']],
  ['AUTO-10', 'AUTO-10 slug conflict pauses the same slug until an edited slug becomes valid', autosaveFile, ['AUTO_SLUG_BARRIER']],
  ['AUTO-11', 'AUTO-11 known offline makes no request and online rearms one latest save', autosaveFile, ['AUTO_OFFLINE_REARM']],
  ['AUTO-12', 'AUTO-12 lost real committed ACK stops retries and explicit stale retry conflicts', autosaveFile, ['AUTO_UNKNOWN_ACK']],
  ['AUTO-13', 'AUTO-13 two autosaving tabs keep the loser draft and require confirmed reload', autosaveFile, ['AUTO_TWO_TABS']],
  ['AUTO-14-ADMIN', 'AUTO-14 admin autosaves an allowed foreign draft without changing owner', autosaveFile, ['AUTO_ADMIN_SCOPE']],
  ['AUTO-14-SUPER', 'AUTO-14 super autosaves an allowed foreign draft without changing owner', autosaveFile, ['AUTO_ADMIN_SCOPE']],
  ['AUTO-14-REVOKED', 'AUTO-14 revocation stops an open editor and non-CMS roles cannot open it', autosaveFile, ['AUTO_REVOKED_ACTOR']],
  ['AUTO-15', 'AUTO-15 owner or status changing after load blocks autosave and its queued edits', autosaveFile, ['AUTO_CHANGED_POLICY']],
  ['AUTO-16', 'AUTO-16 expired browser session pauses autosave without redirecting the draft', autosaveFile, ['AUTO_EXPIRED_SESSION']],
  ['AUTO-19', 'AUTO-19 composition blocks intermediate title and editor snapshots beyond debounce', autosaveFile, ['AUTO_COMPOSITION']],
  ['AUTO-21', 'AUTO-21 navigation cancel preserves debounce and accepting during save prevents followup', autosaveFile, ['AUTO_NAVIGATION']],
  ['AUTO-23', 'AUTO-23 persisted future millisecond tokens advance across consecutive autosaves', autosaveFile, ['AUTO_TOKEN_PRECISION']],
].map(([caseId, title, file = draftFile, steps = []]) => Object.freeze({ caseId, title, file, steps: Object.freeze(steps) }))
const byTitle = new Map(definitions.map(definition => [definition.title, definition]))
const byId = new Map(definitions.map(definition => [definition.caseId, definition]))
const unknownCase = Object.freeze({ caseId: 'UNKNOWN_CASE', file: null, steps: Object.freeze([]) })
const caseStatuses = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted', 'unknown']
const resultStatuses = ['passed', 'failed', 'timedout', 'interrupted', 'unknown', 'infrastructure-error-details-redacted']
export const MAX_DIAGNOSTIC_LINE_LENGTH = 4096

function sourceFile(file) {
  if (typeof file !== 'string' || file.length > 4096) return null
  const candidate = (isAbsolute(file) ? relative(repositoryRoot, file) : file).replaceAll('\\', '/')
  return [draftFile, safetyFile, autosaveFile].includes(candidate) ? candidate : null
}

export function diagnosticCase(test) {
  const definition = byTitle.get(test.title)
  return definition && sourceFile(test.location?.file) === definition.file ? definition : unknownCase
}

function coordinate(value) { return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000 }

export function diagnosticLocation(location, file) {
  if (!file || !location || sourceFile(location.file) !== file
    || !coordinate(location.line) || !coordinate(location.column)) return null
  return { file, line: location.line, column: location.column }
}

function exactKeys(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key))
}

function wireLocation(location, file) {
  return location === null || !!file && exactKeys(location, ['file', 'line', 'column'])
    && location.file === file && coordinate(location.line) && coordinate(location.column)
}

// Both reporter and runner use this schema. No free text, absolute paths or
// extra fields can survive the runner's second validation boundary.
export function formatDiagnosticRecord(kind, record) {
  let canonical
  if (kind === 'DISCOVERY') {
    if (!exactKeys(record, ['count']) || !Number.isSafeInteger(record.count) || record.count < 0 || record.count > 10000) return null
    canonical = { count: record.count }
  } else if (kind === 'RESULT') {
    if (!exactKeys(record, ['status']) || !resultStatuses.includes(record.status)) return null
    canonical = { status: record.status }
  } else if (kind === 'CASE') {
    if (!exactKeys(record, ['caseId', 'status', 'testLocation'])) return null
    const definition = byId.get(record.caseId) ?? (record.caseId === unknownCase.caseId ? unknownCase : null)
    if (!definition || !caseStatuses.includes(record.status) || !wireLocation(record.testLocation, definition.file)) return null
    canonical = { caseId: definition.caseId, status: record.status, testLocation: record.testLocation }
  } else if (kind === 'DIAGNOSTIC') {
    if (!exactKeys(record, ['caseId', 'stepCode', 'status', 'testLocation', 'stepLocation', 'assertionLocation', 'assertionSource'])) return null
    const definition = byId.get(record.caseId)
    if (!definition?.steps.includes(record.stepCode) || !['passed', 'failed'].includes(record.status)
      || ![record.testLocation, record.stepLocation, record.assertionLocation].every(location => wireLocation(location, definition.file))) return null
    if (record.assertionLocation === null ? record.assertionSource !== null
      : record.status !== 'failed' || !['error.location', 'step.location'].includes(record.assertionSource)) return null
    canonical = { caseId: definition.caseId, stepCode: record.stepCode, status: record.status,
      testLocation: record.testLocation, stepLocation: record.stepLocation,
      assertionLocation: record.assertionLocation, assertionSource: record.assertionSource }
  } else return null
  return `CMS_E2E ${kind} ${JSON.stringify(canonical)}`
}

function filterLine(line) {
  if (line.length > MAX_DIAGNOSTIC_LINE_LENGTH) return null
  const match = /^CMS_E2E (DISCOVERY|CASE|DIAGNOSTIC|RESULT) (\{[^\r\n]*\})$/.exec(line)
  if (!match) return null
  try { return formatDiagnosticRecord(match[1], JSON.parse(match[2])) } catch { return null }
}

export function createDiagnosticOutputFilter(writeLine) {
  const decoder = new StringDecoder('utf8')
  let pending = '', dropping = false, ended = false
  function consume(text) {
    let offset = 0
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset)
      const end = newline === -1 ? text.length : newline
      if (!dropping) {
        if (pending.length + end - offset > MAX_DIAGNOSTIC_LINE_LENGTH) { pending = ''; dropping = true }
        else pending += text.slice(offset, end)
      }
      if (newline === -1) break
      if (!dropping) {
        const safe = filterLine(pending.endsWith('\r') ? pending.slice(0, -1) : pending)
        if (safe) writeLine(`${safe}\n`)
      }
      pending = ''; dropping = false; offset = newline + 1
    }
  }
  return {
    push(chunk) {
      if (!ended) consume(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? decoder.write(chunk) : '')
    },
    end() {
      if (ended) return
      consume(decoder.end())
      // A truncated last record is not a complete protocol line. Never flush it.
      pending = ''; dropping = false; ended = true
    },
  }
}
