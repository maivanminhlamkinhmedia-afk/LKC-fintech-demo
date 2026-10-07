import assert from 'node:assert/strict'
import test from 'node:test'
import { diagnosticCase, formatDiagnosticRecord } from '../scripts/cms-e2e/diagnostics.mjs'

const file = 'tests/e2e/cms-preview.spec.ts'
const title = 'PREV-03 creator sees own and foreign missing invalid paths reveal no article'
test('PREV registry accepts only exact title/file/step with safe output', () => {
  assert.equal(diagnosticCase({ title, location: { file } }).caseId, 'PREV-03')
  assert.equal(diagnosticCase({ title: `${title} SECRET`, location: { file } }).caseId, 'UNKNOWN_CASE')
  assert.equal(diagnosticCase({ title, location: { file: 'tests/e2e/cms-draft.spec.ts' } }).caseId, 'UNKNOWN_CASE')
  const record = { caseId: 'PREV-03', stepCode: 'PREV_SCOPE', status: 'passed',
    testLocation: { file, line: 1, column: 1 }, stepLocation: { file, line: 2, column: 1 },
    assertionLocation: null, assertionSource: null }
  assert.match(formatDiagnosticRecord('DIAGNOSTIC', record), /PREV_SCOPE/)
  assert.equal(formatDiagnosticRecord('DIAGNOSTIC', { ...record, stepCode: 'SECRET' }), null)
  assert.equal(formatDiagnosticRecord('DIAGNOSTIC', { ...record, content: 'PRIVATE_CONTENT' }), null)
  const hostileTitle = 'PREV-11 hostile saved metadata and links neither execute nor auto-request external resources'
  assert.equal(diagnosticCase({ title: hostileTitle, location: { file } }).caseId, 'PREV-11')
  assert.match(formatDiagnosticRecord('DIAGNOSTIC', { ...record, caseId: 'PREV-11', stepCode: 'PREV_XSS_NETWORK' }), /PREV_XSS_NETWORK/)
  for (const phase of ['PREV_LINK_OWN_LIST', 'PREV_LINK_SUBMITTED_LIST', 'PREV_SUBMITTED_LIST_GOTO',
    'PREV_SUBMITTED_LIST_LINK_COUNT', 'PREV_SUBMITTED_LIST_LINK_VISIBLE', 'PREV_SUBMITTED_LIST_NEXT_COUNT',
    'PREV_SUBMITTED_LIST_NEXT_TARGET', 'PREV_SUBMITTED_LIST_NEXT_CLICK', 'PREV_SUBMITTED_LIST_PAGE_ADVANCED',
    'PREV_SUBMITTED_LIST_NO_EDIT', 'PREV_LINK_NEW', 'PREV_LINK_EDITOR', 'PREV_LINK_POPUP']) {
    assert.match(formatDiagnosticRecord('DIAGNOSTIC', { ...record, caseId: 'PREV-17/18', stepCode: phase }), new RegExp(phase))
  }
  assert.equal(formatDiagnosticRecord('DIAGNOSTIC', { ...record, caseId: 'PREV-17/18', stepCode: 'PREV_LINK_SECRET' }), null)
})
