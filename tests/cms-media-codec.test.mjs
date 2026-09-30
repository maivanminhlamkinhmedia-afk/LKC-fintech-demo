import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'

const workerPath = new URL('../src/features/cms/media-codec-worker.cjs', import.meta.url)
function canonicalize(bytes, mimeType) {
  const worker = new Worker(workerPath)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(Error('worker timeout')) }, 5000)
    worker.once('message', message => { clearTimeout(timer); worker.terminate(); resolve(message) })
    worker.once('error', error => { clearTimeout(timer); worker.terminate(); reject(error) })
    worker.postMessage({ bytes, mimeType })
  })
}
const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128])
test('real PNG worker preserves alpha and discards ancillary text on re-encode', async () => {
  const image = PNG.sync.write({ width: 2, height: 1, data: rgba })
  const text = Buffer.from('SECRET-GPS-METADATA')
  const result = await canonicalize(Buffer.concat([image, text]), 'image/png')
  assert.equal(result.ok, true)
  const output = Buffer.from(result.data.bytes)
  assert.equal(output.includes(text), false)
  assert.deepEqual(PNG.sync.read(output).data, rgba)
  assert.deepEqual([result.data.width, result.data.height], [2, 1])
})
test('real JPEG worker normalizes EXIF orientation and drops metadata', async () => {
  const image = jpeg.encode({ width: 2, height: 1, data: rgba }, 90).data
  const tiff = Buffer.from('49492a0008000000010012010300010000000600000000000000', 'hex')
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff, Buffer.from('SECRET-GPS-METADATA')])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]), exif])
  const input = Buffer.concat([image.subarray(0, 2), app1, image.subarray(2)])
  const result = await canonicalize(input, 'image/jpeg')
  assert.equal(result.ok, true)
  assert.deepEqual([result.data.width, result.data.height], [1, 2])
  assert.equal(Buffer.from(result.data.bytes).includes(Buffer.from('SECRET-GPS-METADATA')), false)
  assert.deepEqual([jpeg.decode(Buffer.from(result.data.bytes)).width, jpeg.decode(Buffer.from(result.data.bytes)).height], [1, 2])
  const trailing = Buffer.from('SYNTHETIC_PRIVATE_METADATA')
  const second = await canonicalize(Buffer.concat([image, trailing]), 'image/jpeg')
  assert.equal(second.ok, true)
  assert.equal(Buffer.from(second.data.bytes).includes(trailing), false)
})
test('invalid format and image dimensions fail without canonical bytes', async () => {
  const valid = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([1, 2, 3, 255]) })
  for (const [bytes, mimeType, code] of [[Buffer.alloc(0), 'image/png', 'FILE_TOO_LARGE'],
    [valid, 'image/jpeg', 'UNSUPPORTED_MEDIA'], [valid.subarray(0, 18), 'image/png', 'UNSUPPORTED_MEDIA']]) {
    const result = await canonicalize(bytes, mimeType)
    assert.deepEqual(result, { ok: false, code })
  }
  const huge = Buffer.from(valid); huge.writeUInt32BE(5000, 16)
  assert.deepEqual(await canonicalize(huge, 'image/png'), { ok: false, code: 'IMAGE_LIMIT_EXCEEDED' })
})
test('animated PNG chunks and malformed JPEG cannot pass the full worker', async () => {
  const valid = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([1, 2, 3, 255]) })
  const animation = Buffer.concat([valid.subarray(0, 33), Buffer.from('000000006163544c00000000', 'hex'), valid.subarray(33)])
  assert.deepEqual(await canonicalize(animation, 'image/png'), { ok: false, code: 'UNSUPPORTED_MEDIA' })
  assert.deepEqual(await canonicalize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg'), { ok: false, code: 'UNSUPPORTED_MEDIA' })
})
