import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'
import { TAXONOMY_CASES, TAX_ROUNDTRIP_STEPS, TAX_TEARDOWN_STEPS, TAX_GRAPH_STEPS, TAX_TIMING_BODIES, TAX_TIMING_HOOKS } from './taxonomy-diagnostics.mjs'
import { MEDIA_SEARCH_SIGNALS, MEDIA_SEARCH_FAILURE_CODES } from './media-search-observation.ts'
import { UPLOAD_STAGES } from './media-upload-failure-state.ts'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const draftFile = 'tests/e2e/cms-draft.spec.ts'
const safetyFile = 'tests/e2e/cms-editor-safety.spec.ts'
const autosaveFile = 'tests/e2e/cms-autosave.spec.ts'
const sourcesFile = 'tests/e2e/cms-sources.spec.ts'
const taxonomyFile = 'tests/e2e/cms-taxonomy.spec.ts'
const mediaFile = 'tests/e2e/cms-media.spec.ts'
const previewFile = 'tests/e2e/cms-preview.spec.ts'
const mediaTeardownSteps = ['MED_TEARDOWN_CONTEXT_CLOSE', 'MED_TEARDOWN_RECOVER', 'MED_TEARDOWN_DISCONNECT']
export const MEDIA_ERROR_CODES = Object.freeze([
  'VALIDATION_ERROR', 'UNSUPPORTED_MEDIA', 'FILE_TOO_LARGE', 'IMAGE_LIMIT_EXCEEDED', 'MEDIA_BUSY',
  'MEDIA_STORAGE_UNAVAILABLE', 'MEDIA_NOT_AVAILABLE', 'MEDIA_IN_USE', 'MEDIA_CONFLICT',
  'EDIT_CONFLICT', 'FORBIDDEN', 'NOT_FOUND', 'NOT_EDITABLE', 'UNSUPPORTED_DOCUMENT',
  'UNKNOWN_OUTCOME', 'STORAGE_CLEANUP_PENDING', 'INTERNAL_ERROR',
])
export const MEDIA_OBSERVATION_PHASES = Object.freeze([
  'PAGE', 'INPUT', 'SUBMIT', 'INTENT_RESERVED', 'POST_FORWARDED', 'POST_RESPONSE',
  'POST_FAILURE', 'SUCCESS_UI', 'UI_ERROR_CODE', 'RECOVER', 'DB_CHECK',
  'MED_SCOPE_OTHER_LOGIN', 'MED_SCOPE_OTHER_NAVIGATE', 'MED_SCOPE_OTHER_INPUT',
  'MED_SCOPE_OTHER_SEARCH', 'MED_SCOPE_OTHER_HIDDEN', 'MED_SCOPE_OTHER_GET',
  'MED_SCOPE_ADMIN_LOGIN', 'MED_SCOPE_ADMIN_NAVIGATE', 'MED_SCOPE_ADMIN_INPUT',
  'MED_SCOPE_ADMIN_SEARCH', 'MED_SCOPE_ADMIN_VISIBLE',
])
const mediaScopePhases = MEDIA_OBSERVATION_PHASES.filter(phase => phase.startsWith('MED_SCOPE_'))
const sourceTeardownSteps = [
  'SRC_TEARDOWN_DISPOSE', 'SRC_TEARDOWN_CONTEXT_CLOSE', 'SRC_TEARDOWN_RECOVER', 'SRC_TEARDOWN_DISCONNECT',
]
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
  ['SRC-01', 'SRC-01 sources route denies anonymous non-CMS and foreign readers', sourcesFile, ['SRC_ACCESS']],
  ['SRC-02/09', 'SRC-02/09 full source metadata retains fixed Vietnam time and millisecond precision', sourcesFile, ['SRC_METADATA_INPUT', 'SRC_METADATA_SUBMIT', 'SRC_METADATA_DB', 'SRC_METADATA_RELOAD']],
  ['SRC-02', 'SRC-02 changes requested saves blank optional fields as null', sourcesFile, ['SRC_NULL_FIELDS']],
  ['SRC-03-ADMIN', 'SRC-03 admin source author does not replace article ownership', sourcesFile, ['SRC_ADMIN_SCOPE']],
  ['SRC-03-SUPER', 'SRC-03 super source author does not replace article ownership', sourcesFile, ['SRC_ADMIN_SCOPE']],
  ['SRC-04', 'SRC-04 excluded statuses and unsupported documents expose read-only sources', sourcesFile, ['SRC_READ_ONLY']],
  ['SRC-07/08', 'SRC-07/08 safe source links and legacy unsafe text never execute or fetch', sourcesFile, ['SRC_URL_INPUT', 'SRC_UNSAFE_RENDER']],
  ['SRC-10/11', 'SRC-10/11 manual source panel has no idle writes and one pending mutation', sourcesFile, ['SRC_MANUAL_IDLE', 'SRC_SINGLE_FLIGHT']],
  ['SRC-12', 'SRC-12 two source tabs have one winner and preserve the losing form', sourcesFile, ['SRC_TWO_TABS_SUBMIT', 'SRC_TWO_TABS_DB']],
  ['SRC-13-SOURCE', 'SRC-13 source commit conflicts with the other stale surface', sourcesFile, ['SRC_CROSS_SURFACE_SUBMIT', 'SRC_CROSS_SURFACE_DB']],
  ['SRC-13-AUTOSAVE', 'SRC-13 autosave commit conflicts with the other stale surface', sourcesFile, ['SRC_CROSS_SURFACE_SUBMIT', 'SRC_CROSS_SURFACE_DB']],
  ['SRC-14-ACTOR', 'SRC-14 suspended demoted and expired sessions retain source input without writes', sourcesFile, ['SRC_ACTOR_REVOKED']],
  ['SRC-14-PARENT', 'SRC-14 changed article owner or status blocks an already open source form', sourcesFile, ['SRC_PARENT_REVOKED']],
  ['SRC-15', 'SRC-15 delete confirmation removes only the selected source', sourcesFile, ['SRC_DELETE_CANCEL', 'SRC_DELETE_DB']],
  ['SRC-17', 'SRC-17 source create update delete retain monotonic persisted DATETIME tokens', sourcesFile, ['SRC_TOKEN_PRECISION']],
  ['SRC-18', 'SRC-18 offline and lost real ACK preserve input and never duplicate create', sourcesFile, ['SRC_OFFLINE', 'SRC_UNKNOWN_ACK']],
  ['SRC-20', 'SRC-20 dirty navigation cancellation retains source form and accepted leave has no followup', sourcesFile, ['SRC_NAVIGATION_CANCEL', 'SRC_NAVIGATION_LEAVE']],
  ['SRC-21', 'SRC-21 editor source links retain the autosave navigation guard', sourcesFile, ['SRC_EDITOR_LINKS']],
  ['SRC-23', 'SRC-23 source form labels keyboard errors and long URLs fit all viewports', sourcesFile, ['SRC_ACCESSIBLE_LAYOUT']],
  ...TAXONOMY_CASES.map(([id, title, step]) => [id, title, taxonomyFile,
    [step, ...(id === 'TAX-10/11' ? TAX_ROUNDTRIP_STEPS : []),
      ...(Object.hasOwn(TAX_TIMING_BODIES, id) ? [...TAX_TEARDOWN_STEPS, ...TAX_GRAPH_STEPS] : [])]]),
  ['MED-01', 'MED-01 protected media routes and bytes enforce role and article scope', mediaFile, ['MED_ACCESS']],
  ['MED-02/05/10', 'MED-02/05/10 PNG and JPEG upload persist canonical private bytes and protected GET HEAD', mediaFile, ['MED_UPLOAD_CANONICAL']],
  ['MED-03/24', 'MED-03/24 invalid files and origin leave no media row or canonical residue', mediaFile, ['MED_VALIDATION']],
  ['MED-08/11', 'MED-08/11 own library excludes foreign asset while admin can find it', mediaFile,
    ['MED_SCOPE_SEARCH', 'MED_SCOPE_CREATOR_UPLOAD', 'MED_SCOPE_OTHER', 'MED_SCOPE_ADMIN', ...mediaScopePhases]],
  ['MED-08-PAGE', 'MED-08 paging keeps selected metadata while foreign scope stays hidden', mediaFile, ['MED_PAGING_SCOPE']],
  ['MED-09/19/34', 'MED-09/19/34 metadata edit uses exact CAS and preserves immutable binary identity', mediaFile, ['MED_METADATA_CAS']],
  ['MED-12/13', 'MED-12/13 cover select and clear preserve article fields and use shared token', mediaFile, ['MED_COVER_ROUNDTRIP']],
  ['MED-16', 'MED-16 used cover rejects deletion without SetNull', mediaFile, ['MED_DELETE_USED']],
  ['MED-16-MATRIX', 'MED-16 all fixture statuses and owners remain attached after denied delete', mediaFile, ['MED_DELETE_USED_MATRIX']],
  ['MED-17', 'MED-17 confirmed unused delete removes exact DB row and canonical file', mediaFile, ['MED_DELETE_UNUSED']],
  ['MED-21/28', 'MED-21/28 controls remain labelled and usable at 390px and 768px', mediaFile, ['MED_ACCESSIBLE_LAYOUT']],
  ['MED-10-XSS', 'MED-10-XSS HTML-like metadata is escaped after reload and cannot execute', mediaFile, ['MED_ESCAPED_METADATA']],
  ['MED-11-COVER', 'MED-11-COVER foreign direct bytes and operation deny, current foreign cover preview stays narrow', mediaFile, ['MED_COVER_READ_SCOPE']],
  ['MED-12/13-REPLACE', 'MED-12/13-REPLACE cover no-op, replace and clear use persisted shared token', mediaFile, ['MED_COVER_REPLACE']],
  ['MED-17-CANCEL', 'MED-17-CANCEL cancel delete preserves DB row and canonical file', mediaFile, ['MED_DELETE_CANCEL']],
  ['MED-22', 'MED-22 committed upload with lost response is recovered through the same operation', mediaFile, ['MED_UPLOAD_LOST_ACK']],
  ['MED-24/27', 'MED-24/27 offline and cancelled navigation retain unsaved File without dispatch', mediaFile, ['MED_OFFLINE_NAVIGATION']],
  ['MED-14-COVER', 'MED-14 cover wins against the stale Article surface without losing input', mediaFile, ['MED_AUTOSAVE_CONFLICT']],
  ['MED-14-AUTOSAVE', 'MED-14 autosave wins against the stale Article surface without losing input', mediaFile, ['MED_AUTOSAVE_CONFLICT']],
  ['MED-15-COVER-SOURCE', 'MED-15 cover wins between cover and source creation', mediaFile, ['MED_SOURCE_CONFLICT']],
  ['MED-15-SOURCE', 'MED-15 source wins between cover and source creation', mediaFile, ['MED_SOURCE_CONFLICT']],
  ['MED-15-COVER-CLASS', 'MED-15 cover wins between cover and classification', mediaFile, ['MED_CLASSIFICATION_CONFLICT']],
  ['MED-15-CLASS', 'MED-15 classification wins between cover and classification', mediaFile, ['MED_CLASSIFICATION_CONFLICT']],
  ['MED-18', 'MED-18 concurrent cover attach and unused delete cannot detach implicitly or dangle', mediaFile, ['MED_ATTACH_DELETE_RACE']],
  ['MED-20', 'MED-20 fresh actor and Article status are checked again on mutation', mediaFile, ['MED_FRESH_AUTH']],
  ['MED-20-ROLE-OWNER', 'MED-20 role revocation and parent owner change reject a preloaded mutation', mediaFile, ['MED_FRESH_ROLE_OWNER']],
  ['MED-20-SESSION', 'MED-20 expired session returns a safe mutation failure without discarding metadata input', mediaFile, ['MED_SESSION_LOST']],
  ['MED-21', 'MED-21 synchronous double submit dispatches one metadata update', mediaFile, ['MED_SINGLE_FLIGHT']],
  ['MED-23-METADATA', 'MED-23 committed metadata with lost Server Action ACK retains input until explicit reload', mediaFile, ['MED_METADATA_LOST_ACK']],
  ['MED-23-DELETE', 'MED-23 committed delete with lost ACK does not recreate the row or resend', mediaFile, ['MED_DELETE_LOST_ACK']],
  ['MED-23-COVER', 'MED-23 committed cover with lost ACK keeps the chosen asset until explicit reload', mediaFile, ['MED_COVER_LOST_ACK']],
  ['MED-26', 'MED-26 legacy media is read-only and a current cover can be retained or cleared without external fetch', mediaFile, ['MED_LEGACY_MEDIA']],
  ['PREV-01', 'PREV-01 anonymous direct preview has no saved article marker', previewFile, ['PREV_ANON']],
  ['PREV-02', 'PREV-02 non-CMS roles cannot open preview', previewFile, ['PREV_NON_CMS']],
  ['PREV-03', 'PREV-03 creator sees own and foreign missing invalid paths reveal no article', previewFile, ['PREV_SCOPE']],
  ['PREV-04', 'PREV-04 admin and super read foreign draft without reassigning author', previewFile, ['PREV_ANY_SCOPE']],
  ['PREV-05', 'PREV-05 all ten saved statuses remain readable but editing policy stays separate', previewFile, ['PREV_STATUSES']],
  ['PREV-06', 'PREV-06 fresh actor and owner changes revoke a later preview request', previewFile, ['PREV_REVOKE']],
  ['PREV-07/08/12', 'PREV-07/08/12 header uses saved time and missing profile and empty data have fallbacks', previewFile, ['PREV_HEADER_EMPTY']],
  ['PREV-10', 'PREV-10 unsupported editor schema is safe and does not mutate Article', previewFile, ['PREV_UNSUPPORTED']],
  ['PREV-09/16/17/20', 'PREV-09/16/17/20 saved Vietnamese rich text and source render after reload without private note', previewFile, ['PREV_SAVED_CONTENT']],
  ['PREV-11', 'PREV-11 hostile saved metadata and links neither execute nor auto-request external resources', previewFile, ['PREV_XSS_NETWORK']],
  ['PREV-13/14/15', 'PREV-13/14/15 attached foreign-uploader private PNG renders while unrelated bytes deny and load failure falls back', previewFile, ['PREV_PRIVATE_COVER']],
  ['PREV-13-JPEG', 'PREV-13 real JPEG upload and Article cover remain readable in saved preview', previewFile, ['PREV_JPEG_COVER']],
  ['PREV-15-LEGACY', 'PREV-15 legacy cover never requests its external URL', previewFile, ['PREV_LEGACY_COVER']],
  ['PREV-16', 'PREV-16 saved category topic tag instrument and primary survive preview read without mutation', previewFile, ['PREV_CLASSIFICATION']],
  ['PREV-17/18', 'PREV-17/18 list and persisted editor link open saved preview without replacing editor', previewFile,
    ['PREV_LINKS', 'PREV_LINK_OWN_LIST', 'PREV_LINK_SUBMITTED_LIST', 'PREV_SUBMITTED_LIST_GOTO',
      'PREV_SUBMITTED_LIST_LINK_COUNT', 'PREV_SUBMITTED_LIST_LINK_VISIBLE', 'PREV_SUBMITTED_LIST_NEXT_COUNT',
      'PREV_SUBMITTED_LIST_NEXT_CLICK', 'PREV_SUBMITTED_LIST_NO_EDIT', 'PREV_LINK_NEW', 'PREV_LINK_EDITOR', 'PREV_LINK_POPUP']],
  ['PREV-19', 'PREV-19 dirty editor stays intact while preview reads the persisted title', previewFile, ['PREV_DIRTY_TAB']],
  ['PREV-21', 'PREV-21 GET and reload leave persisted Article unchanged', previewFile, ['PREV_NO_WRITE']],
  ['PREV-22', 'PREV-22 private HTML has noindex and does not advertise draft metadata', previewFile, ['PREV_PRIVACY']],
  ['PREV-23', 'PREV-23 long saved content remains within responsive app viewport', previewFile, ['PREV_LAYOUT']],
].map(([caseId, title, file = draftFile, steps = []]) => Object.freeze({ caseId, title, file,
  steps: Object.freeze(file === sourcesFile ? [...steps, ...sourceTeardownSteps]
    : file === mediaFile ? [...steps, ...mediaTeardownSteps] : steps) }))
const byTitle = new Map(definitions.map(definition => [definition.title, definition]))
const byId = new Map(definitions.map(definition => [definition.caseId, definition]))
export const MEDIA_TIMING_BODIES = Object.freeze(Object.fromEntries(definitions
  .filter(definition => definition.file === mediaFile).map(definition => [definition.caseId, definition.steps[0]])))
const unknownCase = Object.freeze({ caseId: 'UNKNOWN_CASE', file: null, steps: Object.freeze([]) })
const caseStatuses = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted', 'unknown']
const resultStatuses = ['passed', 'failed', 'timedout', 'interrupted', 'unknown', 'infrastructure-error-details-redacted']
export const MAX_DIAGNOSTIC_LINE_LENGTH = 4096
export const MAX_TIMING_MS = 3_600_000

function sourceFile(file) {
  if (typeof file !== 'string' || file.length > 4096) return null
  const candidate = (isAbsolute(file) ? relative(repositoryRoot, file) : file).replaceAll('\\', '/')
  return [draftFile, safetyFile, autosaveFile, sourcesFile, taxonomyFile, mediaFile, previewFile].includes(candidate) ? candidate : null
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

function milliseconds(value) { return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMING_MS }

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
  } else if (kind === 'TIMING') {
    if (!exactKeys(record, ['caseId', 'phaseCode', 'scope', 'status', 'durationMs', 'testOffsetMs',
      'bodyState', 'bodyElapsedMs', 'testTimeoutMs', 'location'])) return null
    const definition = byId.get(record.caseId)
    if (!definition || !Object.hasOwn(TAX_TIMING_BODIES, record.caseId)
      && !Object.hasOwn(MEDIA_TIMING_BODIES, record.caseId)) return null
    const phaseAllowed = record.scope === 'hook' ? Object.values(TAX_TIMING_HOOKS).includes(record.phaseCode)
      : record.scope === 'fixture' ? record.phaseCode === 'PW_FIXTURE'
        : ['phase', 'assertion'].includes(record.scope) && definition.steps.includes(record.phaseCode)
    if (!phaseAllowed || !['started', 'passed', 'failed'].includes(record.status)
      || !['notStarted', 'running', 'ended'].includes(record.bodyState)
      || ![record.durationMs, record.testOffsetMs, record.bodyElapsedMs, record.testTimeoutMs].every(milliseconds)
      || record.status === 'started' && record.durationMs !== 0
      || record.bodyState === 'notStarted' && record.bodyElapsedMs !== 0
      || !wireLocation(record.location, definition.file)) return null
    canonical = { caseId: record.caseId, phaseCode: record.phaseCode, scope: record.scope, status: record.status,
      durationMs: record.durationMs, testOffsetMs: record.testOffsetMs,
      bodyState: record.bodyState, bodyElapsedMs: record.bodyElapsedMs, testTimeoutMs: record.testTimeoutMs,
      location: record.location }
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
  } else if (kind === 'MEDIA_OBSERVATION') {
    if (!exactKeys(record, ['caseId', 'phase', 'status', 'elapsedMs', 'durationMs', 'httpStatus', 'errorCode', 'intentCount'])
      || !Object.hasOwn(MEDIA_TIMING_BODIES, record.caseId)
      || !MEDIA_OBSERVATION_PHASES.includes(record.phase)
      || mediaScopePhases.includes(record.phase) && record.caseId !== 'MED-08/11'
      || !['started', 'passed', 'failed'].includes(record.status)
      || !milliseconds(record.elapsedMs) || !milliseconds(record.durationMs)
      || record.status === 'started' && record.durationMs !== 0
      || !Number.isSafeInteger(record.httpStatus) || record.httpStatus !== 0 && (record.httpStatus < 100 || record.httpStatus > 599)
      || record.errorCode !== null && !MEDIA_ERROR_CODES.includes(record.errorCode)
      || !Number.isSafeInteger(record.intentCount) || record.intentCount < 0 || record.intentCount > 1) return null
    canonical = { caseId: record.caseId, phase: record.phase, status: record.status,
      elapsedMs: record.elapsedMs, durationMs: record.durationMs, httpStatus: record.httpStatus,
      errorCode: record.errorCode, intentCount: record.intentCount }
  } else if (kind === 'MEDIA_SEARCH_SIGNAL') {
    if (!exactKeys(record, ['caseId', 'actor', 'signal', 'elapsedMs', 'httpStatus', 'requestOrdinal', 'failureCode'])
      || record.caseId !== 'MED-08/11' || !['other', 'admin'].includes(record.actor)
      || !MEDIA_SEARCH_SIGNALS.includes(record.signal) || !milliseconds(record.elapsedMs)
      || !Number.isSafeInteger(record.requestOrdinal) || record.requestOrdinal < 0 || record.requestOrdinal > 100
      || ((record.signal.startsWith('ACTION_')
        || (record.signal.startsWith('NAVIGATION_') && record.signal !== 'NAVIGATION_COMMIT'))
        ? record.requestOrdinal === 0 : record.requestOrdinal !== 0)
      || (record.signal === 'ACTION_FAILED'
        ? !MEDIA_SEARCH_FAILURE_CODES.includes(record.failureCode) : record.failureCode !== null)
      || !Number.isSafeInteger(record.httpStatus)
      || (record.signal.endsWith('_RESPONSE')
        ? record.httpStatus < 100 || record.httpStatus > 599 : record.httpStatus !== 0)) return null
    canonical = { caseId: record.caseId, actor: record.actor, signal: record.signal,
      elapsedMs: record.elapsedMs, httpStatus: record.httpStatus,
      requestOrdinal: record.requestOrdinal, failureCode: record.failureCode }
  } else if (kind === 'MEDIA_UPLOAD_STATE') {
    if (!exactKeys(record, ['caseId', 'journalStage', 'rowPresent', 'objectPresent', 'tempJournalPresent'])
      || !Object.hasOwn(MEDIA_TIMING_BODIES, record.caseId)
      || !UPLOAD_STAGES.includes(record.journalStage)
      || ![record.rowPresent, record.objectPresent, record.tempJournalPresent]
        .every(value => ['present', 'absent', 'unknown'].includes(value))) return null
    canonical = { caseId: record.caseId, journalStage: record.journalStage, rowPresent: record.rowPresent,
      objectPresent: record.objectPresent, tempJournalPresent: record.tempJournalPresent }
  } else return null
  return `CMS_E2E ${kind} ${JSON.stringify(canonical)}`
}

function filterLine(line) {
  if (line.length > MAX_DIAGNOSTIC_LINE_LENGTH) return null
  const match = /^CMS_E2E (DISCOVERY|CASE|DIAGNOSTIC|TIMING|MEDIA_OBSERVATION|MEDIA_SEARCH_SIGNAL|MEDIA_UPLOAD_STATE|RESULT) (\{[^\r\n]*\})$/.exec(line)
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
