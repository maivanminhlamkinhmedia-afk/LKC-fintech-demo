import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MEDIA_LIMITS, MediaError, mediaFailure, normalizeUploadDescriptor, normalizeMetadataEdit, normalizeDelete,
  normalizeCover, mediaSearch, mediaToken, nextMediaUpdatedAt } from '../src/features/cms/media-contract.ts'

const descriptor = () => ({ originalFilename: ' ảnh Việt.png ', altText: ' Ảnh minh họa ', caption: null, mimeType: 'image/png' })
const token = '2026-09-30T01:02:03.456Z'
const code = (work, expected) => assert.throws(work, error => error instanceof MediaError && error.code === expected)

test('upload descriptor normalizes NFC and retains only canonical plain metadata', () => {
  assert.deepEqual(normalizeUploadDescriptor(descriptor()), { originalFilename: 'ảnh Việt.png', altText: 'Ảnh minh họa', caption: null, mimeType: 'image/png' })
  assert.equal(MEDIA_LIMITS.bytes, 5 * 1024 * 1024)
})
test('exact MIME, basename and extension policy', () => {
  for (const name of ['../a.png', 'C:a.png', 'a\\b.png', 'a.svg', '.png\0', 'a\n.png']) code(() => normalizeUploadDescriptor({ ...descriptor(), originalFilename: name }), 'VALIDATION_ERROR')
  code(() => normalizeUploadDescriptor({ ...descriptor(), mimeType: 'image/jpeg' }), 'VALIDATION_ERROR')
  assert.equal(normalizeUploadDescriptor({ ...descriptor(), originalFilename: 'a.JPEG', mimeType: 'image/jpeg' }).mimeType, 'image/jpeg')
})
test('plain text Unicode bounds and required alt', () => {
  code(() => normalizeUploadDescriptor({ ...descriptor(), altText: '' }), 'VALIDATION_ERROR')
  code(() => normalizeUploadDescriptor({ ...descriptor(), altText: 'a'.repeat(301) }), 'VALIDATION_ERROR')
  code(() => normalizeUploadDescriptor({ ...descriptor(), caption: 'x'.repeat(2001) }), 'VALIDATION_ERROR')
  assert.equal(normalizeUploadDescriptor({ ...descriptor(), altText: '🙂'.repeat(300) }).altText.length, 600)
})
test('hostile accessors, non-enumerable, symbols, class instances and toJSON are rejected before invocation', () => {
  let calls = 0
  const getter = descriptor(); Object.defineProperty(getter, 'altText', { enumerable: true, get() { calls++; throw Error('SECRET') } })
  code(() => normalizeUploadDescriptor(getter), 'VALIDATION_ERROR')
  const hidden = descriptor(); Object.defineProperty(hidden, 'altText', { enumerable: false, value: 'a' })
  code(() => normalizeUploadDescriptor(hidden), 'VALIDATION_ERROR')
  code(() => normalizeUploadDescriptor({ ...descriptor(), [Symbol('x')]: 1 }), 'VALIDATION_ERROR')
  code(() => normalizeUploadDescriptor(Object.assign(new Date(), descriptor())), 'VALIDATION_ERROR')
  const withJSON = { ...descriptor(), toJSON() { calls++ } }
  code(() => normalizeUploadDescriptor(withJSON), 'VALIDATION_ERROR')
  assert.equal(calls, 0)
})
test('metadata and delete CAS timestamps require exact milliseconds', () => {
  assert.equal(normalizeMetadataEdit({ altText: ' Ảnh ', caption: '', expectedUpdatedAt: token }).expectedUpdatedAt.toISOString(), token)
  assert.equal(normalizeDelete({ expectedUpdatedAt: token }).expectedUpdatedAt.toISOString(), token)
  for (const value of ['2026-09-30T01:02:03Z', '2026-09-30T01:02:03.456+00:00', '2026-02-30T01:02:03.456Z']) code(() => mediaToken(value), 'VALIDATION_ERROR')
  assert.equal(nextMediaUpdatedAt(new Date(token), new Date(token).getTime()).toISOString(), '2026-09-30T01:02:03.457Z')
})
test('cover fields and token pairing remain exact', () => {
  assert.deepEqual(normalizeCover({ mediaId: null, expectedMediaUpdatedAt: null, expectedUpdatedAt: token }),
    { mediaId: null, expectedMediaUpdatedAt: null, expectedUpdatedAt: new Date(token) })
  code(() => normalizeCover({ mediaId: 'asset', expectedMediaUpdatedAt: null, expectedUpdatedAt: token }), 'VALIDATION_ERROR')
  code(() => normalizeCover({ mediaId: null, expectedMediaUpdatedAt: token, expectedUpdatedAt: token }), 'VALIDATION_ERROR')
  code(() => normalizeCover({ mediaId: null, expectedMediaUpdatedAt: null, expectedUpdatedAt: token, uploaderId: 'foreign' }), 'VALIDATION_ERROR')
})
test('bounded search and safe mapping', () => {
  assert.deepEqual(mediaSearch({ q: '  Việt  ', page: 2 }), { q: 'Việt', page: 2 })
  code(() => mediaSearch({ q: 'x'.repeat(101), page: 1 }), 'VALIDATION_ERROR')
  code(() => mediaSearch({ q: '', page: 10001 }), 'VALIDATION_ERROR')
  const hostile = {}; Object.defineProperty(hostile, 'message', { get() { throw Error('SECRET') } })
  assert.deepEqual(mediaFailure(hostile), { code: 'INTERNAL_ERROR', message: 'Chưa xác nhận được kết quả. Giữ dữ liệu và tải lại để kiểm tra.' })
})
