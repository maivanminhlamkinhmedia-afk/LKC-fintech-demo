// Offline candidate boundary. No JSON.parse occurs until the entire raw input
// passes the grammar/duplicate-key scan. No transport, environment or CLI here.
export const JSON_LIMITS = Object.freeze({response: 1048576, document: 16384, depth: 64});

// Even a faulty injected provider must not smuggle raw error text into a report.
const SAFE_CODES = new Set(`JSON_LIMIT_INVALID JSON_BYTES_REQUIRED JSON_SIZE JSON_BOM JSON_UTF8 JSON_GRAMMAR JSON_DEPTH
JSON_DUPLICATE_KEY JSON_UNSAFE_KEY INPUT_ABORTED BOOTSTRAP_INVALID TRUSTED_CAPABILITY_MISSING BROKER_IDENTITY_MISMATCH
BROKER_PERMISSION_MISMATCH BROKER_CREDENTIAL_INVALID BROKER_CREDENTIAL_EXPIRED ADAPTER_ABORTED ENDPOINT_FORBIDDEN
API_RATE_LIMITED API_HTTP_DENIED API_ENCODING_INVALID REPOSITORY_IDENTITY_MISMATCH API_UNAVAILABLE BROKER_UNAVAILABLE
POLICY_ENVELOPE_INVALID POLICY_KEY_UNTRUSTED POLICY_KEY_INVALID POLICY_DIGEST_MISMATCH POLICY_SIGNATURE_INVALID
POLICY_SCHEMA_INVALID POLICY_REPOSITORY_MISMATCH POLICY_MATERIAL_MISMATCH POLICY_LIMIT_MISMATCH POLICY_RULES_INVALID
POLICY_REGISTER_MISSING POLICY_REGISTER_UNAVAILABLE POLICY_REGISTER_MISMATCH POLICY_REVOCATION_INVALID POLICY_REVOKED
POLICY_ROLLBACK_FLOOR POLICY_REGISTER_CHANGED POLICY_INVALID CONTROLLER_CONFIG_INVALID CLOCK_INVALID EVALUATION_DEADLINE EVALUATION_BUSY
REQUEST_INVALID DISCOVERY_INCOMPLETE DISCOVERY_INVALID API_RECORDS_NOT_VERIFIED DISCOVERY_CHANGED EVALUATION_UNAVAILABLE`.split(/\s+/));
export class EvidenceInputError extends Error {
  constructor(code) {
    const safe = SAFE_CODES.has(code) ? code : 'EVIDENCE_INVALID';
    super(safe); this.name = 'EvidenceInputError';
    Object.defineProperty(this, 'code', {value: safe, enumerable: true});
  }
}
export function requireEvidence(condition, code) {
  if (!condition) throw new EvidenceInputError(code);
}

export function validateJsonBytes(input, {maxBytes = JSON_LIMITS.response, maxDepth = JSON_LIMITS.depth} = {}) {
  requireEvidence(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= JSON_LIMITS.response &&
    Number.isSafeInteger(maxDepth) && maxDepth > 0 && maxDepth <= JSON_LIMITS.depth, 'JSON_LIMIT_INVALID');
  requireEvidence(input instanceof Uint8Array, 'JSON_BYTES_REQUIRED');
  requireEvidence(input.byteLength > 0 && input.byteLength <= maxBytes, 'JSON_SIZE');
  const bytes = Buffer.from(input); // Own the bytes; caller mutation cannot race the scan/parse.
  requireEvidence(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'JSON_BOM');
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); }
  catch { throw new EvidenceInputError('JSON_UTF8'); }
  let pos = 0;
  const bad = () => { throw new EvidenceInputError('JSON_GRAMMAR'); };
  const space = () => { while (/[\x20\t\r\n]/.test(text[pos] ?? '\0')) pos++; };
  function string() {
    if (text[pos++] !== '"') bad();
    let value = '', closed = false;
    while (pos < text.length) {
      const ch = text[pos++];
      if (ch === '"') { closed = true; break; }
      if (ch.charCodeAt(0) < 32) bad();
      if (ch !== '\\') { value += ch; continue; }
      const escape = text[pos++];
      const simple = {'"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t'};
      if (Object.hasOwn(simple, escape)) value += simple[escape];
      else if (escape === 'u') {
        const hex = text.slice(pos, pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) bad();
        value += String.fromCharCode(parseInt(hex, 16)); pos += 4;
      } else bad();
    }
    if (!closed) bad();
    for (let n = 0; n < value.length; n++) {
      const c = value.charCodeAt(n);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(++n);
        if (!(next >= 0xdc00 && next <= 0xdfff)) bad();
      } else if (c >= 0xdc00 && c <= 0xdfff) bad();
    }
    return value;
  }
  function value(depth) {
    space();
    const ch = text[pos];
    if (ch === '{' || ch === '[') {
      requireEvidence(depth < maxDepth, 'JSON_DEPTH');
      pos++;
      const object = ch === '{', end = object ? '}' : ']', keys = new Set();
      space();
      if (text[pos] === end) { pos++; return; }
      for (;;) {
        if (object) {
          const key = string();
          requireEvidence(!keys.has(key), 'JSON_DUPLICATE_KEY'); keys.add(key);
          // Defense in depth: never pass magic object keys to downstream consumers.
          requireEvidence(!['__proto__', 'constructor', 'prototype'].includes(key), 'JSON_UNSAFE_KEY');
          space(); if (text[pos++] !== ':') bad();
        }
        value(depth + 1); space();
        if (text[pos] === end) { pos++; return; }
        if (text[pos++] !== ',') bad();
        space();
      }
    }
    if (ch === '"') { string(); return; }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, pos)) { pos += literal.length; return; }
    }
    const number = text.slice(pos).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number || !Number.isFinite(Number(number[0]))) bad();
    pos += number[0].length;
  }
  value(0); space(); if (pos !== text.length) bad();
  return text;
}

export function parseJsonBytes(input, limits) {
  const text = validateJsonBytes(input, limits);
  return JSON.parse(text);
}

// The caller supplies cancellation/deadlines. Byte and chunk-count bounds are
// enforced even for empty chunks. UTF-8 is decoded only after bounded assembly.
export async function collectJsonBytes(body, {signal, maxBytes = JSON_LIMITS.response} = {}) {
  requireEvidence(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= JSON_LIMITS.response, 'JSON_LIMIT_INVALID');
  const chunks = []; let size = 0, count = 0;
  const add = (chunk) => {
    requireEvidence(!signal?.aborted, 'INPUT_ABORTED');
    requireEvidence(chunk instanceof Uint8Array, 'JSON_BYTES_REQUIRED');
    size += chunk.byteLength;
    requireEvidence(size <= maxBytes && ++count <= 4096, 'JSON_SIZE');
    chunks.push(Buffer.from(chunk));
  };
  if (body instanceof Uint8Array) add(body);
  else {
    requireEvidence(body && typeof body[Symbol.asyncIterator] === 'function', 'JSON_BYTES_REQUIRED');
    for await (const chunk of body) add(chunk);
  }
  const bytes = Buffer.concat(chunks, size);
  validateJsonBytes(bytes, {maxBytes});
  return bytes;
}
