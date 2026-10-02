'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */
const { parentPort } = require('node:worker_threads')
const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')

const MAX_BYTES = 5 * 1024 * 1024
const MAX_SIDE = 4096
const MAX_PIXELS = 4_194_304
function reject(code) { const error = new Error(code); error.code = code; throw error }
function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) reject('IMAGE_LIMIT_EXCEEDED')
}
function pngHeader(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) reject('UNSUPPORTED_MEDIA')
  let offset = 8, ended = false
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    if (length > buffer.length - offset - 12) reject('UNSUPPORTED_MEDIA')
    const kind = buffer.toString('ascii', offset + 4, offset + 8)
    if (offset === 8 && (kind !== 'IHDR' || length !== 13)) reject('UNSUPPORTED_MEDIA')
    if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') reject('UNSUPPORTED_MEDIA')
    offset += length + 12
    if (kind === 'IEND') { if (length !== 0) reject('UNSUPPORTED_MEDIA'); ended = true; break }
  }
  if (!ended || buffer.readUInt32BE(8) !== 13) reject('UNSUPPORTED_MEDIA')
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20)
  dimensions(width, height)
  return { width, height, end: offset }
}
function orientationFromExif(segment) {
  if (segment.length < 14 || segment.toString('ascii', 0, 6) !== 'Exif\0\0') return 1
  const tiff = segment.subarray(6)
  const little = tiff.toString('ascii', 0, 2) === 'II'
  if (!little && tiff.toString('ascii', 0, 2) !== 'MM') return 1
  const u16 = offset => offset + 2 <= tiff.length ? little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset) : -1
  const u32 = offset => offset + 4 <= tiff.length ? little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset) : -1
  if (u16(2) !== 42) return 1
  const ifd = u32(4), count = u16(ifd)
  if (ifd < 8 || count < 0 || count > 1024 || ifd + 2 + count * 12 > tiff.length) return 1
  for (let n = 0; n < count; n++) {
    const at = ifd + 2 + n * 12
    if (u16(at) === 0x0112 && u16(at + 2) === 3 && u32(at + 4) === 1) {
      const value = u16(at + 8)
      return value >= 1 && value <= 8 ? value : 1
    }
  }
  return 1
}
function jpegHeader(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) reject('UNSUPPORTED_MEDIA')
  let offset = 2, width = 0, height = 0, orientation = 1, foundScan = false
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) reject('UNSUPPORTED_MEDIA')
    while (buffer[offset] === 0xff) offset++
    const marker = buffer[offset++]
    if (marker === 0xd9) break
    if (marker === 0xda) { foundScan = true; break }
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > buffer.length) reject('UNSUPPORTED_MEDIA')
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) reject('UNSUPPORTED_MEDIA')
    if (marker === 0xe1) orientation = orientationFromExif(buffer.subarray(offset + 2, offset + length))
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      if (length < 8) reject('UNSUPPORTED_MEDIA')
      height = buffer.readUInt16BE(offset + 3); width = buffer.readUInt16BE(offset + 5)
      dimensions(width, height)
    }
    offset += length
  }
  if (!foundScan || !width || !height || buffer.lastIndexOf(Buffer.from([0xff, 0xd9])) < offset) reject('UNSUPPORTED_MEDIA')
  return { width, height, orientation }
}
function orient(data, width, height, orientation) {
  if (orientation === 1) return { data, width, height }
  const rotated = orientation >= 5
  const outWidth = rotated ? height : width, outHeight = rotated ? width : height
  dimensions(outWidth, outHeight)
  const output = Buffer.alloc(outWidth * outHeight * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let dx, dy
    switch (orientation) {
      case 2: dx = width - 1 - x; dy = y; break
      case 3: dx = width - 1 - x; dy = height - 1 - y; break
      case 4: dx = x; dy = height - 1 - y; break
      case 5: dx = y; dy = x; break
      case 6: dx = height - 1 - y; dy = x; break
      case 7: dx = height - 1 - y; dy = width - 1 - x; break
      case 8: dx = y; dy = width - 1 - x; break
      default: reject('UNSUPPORTED_MEDIA')
    }
    data.copy(output, (dy * outWidth + dx) * 4, (y * width + x) * 4, (y * width + x) * 4 + 4)
  }
  return { data: output, width: outWidth, height: outHeight }
}
function canonicalize(message) {
  const input = Buffer.from(message.bytes)
  if (!input.length || input.length > MAX_BYTES) reject('FILE_TOO_LARGE')
  let image, output
  if (message.mimeType === 'image/png') {
    const header = pngHeader(input)
    try { image = PNG.sync.read(input.subarray(0, header.end), { checkCRC: true }) } catch { reject('UNSUPPORTED_MEDIA') }
    if (image.width !== header.width || image.height !== header.height || image.data.length !== image.width * image.height * 4) reject('UNSUPPORTED_MEDIA')
    output = PNG.sync.write({ width: image.width, height: image.height, data: image.data }, { colorType: 6 })
  } else if (message.mimeType === 'image/jpeg') {
    const header = jpegHeader(input)
    try { image = jpeg.decode(input, { tolerantDecoding: false, maxResolutionInMP: MAX_PIXELS / 1_000_000,
      maxMemoryUsageInMB: 96, formatAsRGBA: true }) } catch { reject('UNSUPPORTED_MEDIA') }
    if (image.width !== header.width || image.height !== header.height || image.data.length !== image.width * image.height * 4) reject('UNSUPPORTED_MEDIA')
    image = orient(image.data, image.width, image.height, header.orientation)
    output = jpeg.encode(image, 82).data
  } else reject('UNSUPPORTED_MEDIA')
  dimensions(image.width, image.height)
  if (!output.length || output.length > MAX_BYTES) reject('IMAGE_LIMIT_EXCEEDED')
  return { bytes: output, width: image.width, height: image.height, mimeType: message.mimeType }
}
parentPort.on('message', message => {
  try { parentPort.postMessage({ ok: true, data: canonicalize(message) }) }
  catch (error) { parentPort.postMessage({ ok: false, code: ['UNSUPPORTED_MEDIA', 'FILE_TOO_LARGE', 'IMAGE_LIMIT_EXCEEDED'].includes(error?.code) ? error.code : 'UNSUPPORTED_MEDIA' }) }
})
