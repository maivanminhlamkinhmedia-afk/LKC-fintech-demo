import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateJsonBytes, parseJsonBytes, collectJsonBytes, JSON_LIMITS} from '../scripts/ci/trusted-evidence-json.mjs';

const bytes = (s) => Buffer.from(s, 'utf8');
function reject(s, code) { assert.throws(() => parseJsonBytes(bytes(s)), (e) => e.code === code); }

test('JSON: positive grammar, escaped syntax and independent object member sets', () => {
  for (const value of [null, true, false, -0, -1.3e-4, {}, [], [{id: 1}, {id: 2}], {text: '"id":2,\\/\n\t😀', list: [1, 2]}]) {
    assert.deepEqual(parseJsonBytes(bytes(JSON.stringify(value))), JSON.parse(JSON.stringify(value)));
  }
  assert.deepEqual(parseJsonBytes(bytes('{"\\u0061":1,"é":2,"é":3}')), {a: 1, é: 2, 'é': 3});
});

for (const key of ['id', 'head_sha', 'run_attempt', 'status', 'conclusion', 'repository', 'epoch', 'signature']) {
  test(`JSON duplicate ${key}: both orders, equal values and ignored nested field`, () => {
    for (const values of ['1,2', '2,1', '1,1']) {
      const [a, b] = values.split(',');
      reject(`{"${key}":${a},"${key}":${b}}`, 'JSON_DUPLICATE_KEY');
      reject(`{"ignored":[{"${key}":${a},"${key}":${b}}]}`, 'JSON_DUPLICATE_KEY');
    }
  });
}
for (const raw of ['{"id":1,"\\u0069d":2}', '{"😀":1,"\\ud83d\\ude00":2}', '{"a":{"x":0,"x":0}}']) {
  test(`JSON decoded-key equivalence ${raw}`, () => reject(raw, 'JSON_DUPLICATE_KEY'));
}
for (const raw of ['', ' ', '{', '[1,]', '{"a":1,}', '{"a" 1}', '{a:1}', '01', '+1', '1.', '1e', '1e999',
  'truefalse', 'null {}', 'NaN', '"a\nb"', '"\\x61"', '"\\u123"', '"\\ud800"', '"\\udc00"', '"\\ud800a"', '"unterminated']) {
  test(`JSON grammar rejects ${JSON.stringify(raw)}`, () => reject(raw, raw === '' ? 'JSON_SIZE' : 'JSON_GRAMMAR'));
}
for (const key of ['__proto__', 'constructor', 'prototype', '\\u005f_proto__']) {
  test(`JSON prototype key rejected: ${key}`, () => {
    reject(`{"${key}":{"polluted":true}}`, 'JSON_UNSAFE_KEY');
    assert.equal({}.polluted, undefined);
  });
}

test('JSON rejects invalid UTF-8, BOM and non-byte objects without materialization', () => {
  for (const bad of [Buffer.from([0xc0, 0xaf]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xff])]) {
    assert.throws(() => parseJsonBytes(bad), /JSON_UTF8/);
  }
  assert.throws(() => parseJsonBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes('{}')])), /JSON_BOM/);
  assert.throws(() => parseJsonBytes({id: 1}), /JSON_BYTES_REQUIRED/);
});

test('JSON rejects duplicates before any ordinary JSON.parse call', () => {
  const original = JSON.parse; let called = 0;
  JSON.parse = (...args) => { called++; return original(...args); };
  try {
    reject('{"ok":true,"nested":{"ignored":1,"ignored":2}}', 'JSON_DUPLICATE_KEY');
    assert.equal(called, 0);
    parseJsonBytes(bytes('{"ok":true}')); assert.equal(called, 1);
    // Negative control: ordinary deserialization loses the first duplicate.
    assert.deepEqual(original('{"id":1,"id":2}'), {id: 2});
  } finally { JSON.parse = original; }
});

test('JSON exact size/depth boundaries and invalid limits', () => {
  assert.equal(validateJsonBytes(bytes('"' + 'a'.repeat(14) + '"'), {maxBytes: 16}).length, 16);
  assert.throws(() => validateJsonBytes(bytes('"' + 'a'.repeat(15) + '"'), {maxBytes: 16}), /JSON_SIZE/);
  validateJsonBytes(bytes('['.repeat(64) + '0' + ']'.repeat(64)));
  assert.throws(() => validateJsonBytes(bytes('['.repeat(65) + '0' + ']'.repeat(65))), /JSON_DEPTH/);
  assert.throws(() => validateJsonBytes(bytes('{}'), {maxBytes: JSON_LIMITS.response + 1}), /JSON_LIMIT_INVALID/);
});

test('JSON chunk boundaries preserve UTF-8 and detect split escaped duplicates', async () => {
  const raw = bytes('{"emoji":"😀","id":1,"\\u0069d":2}');
  for (let split = 1; split < raw.length; split++) {
    const stream = (async function* () { yield raw.subarray(0, split); yield raw.subarray(split); })();
    await assert.rejects(collectJsonBytes(stream), /JSON_DUPLICATE_KEY/);
  }
  const good = bytes('{"emoji":"😀"}');
  const stream = (async function* () { for (const byte of good) yield Buffer.from([byte]); })();
  assert.deepEqual(parseJsonBytes(await collectJsonBytes(stream)), {emoji: '😀'});
});

test('JSON stream abort, oversize, invalid/empty chunk storms and truncated input deny', async () => {
  await assert.rejects(collectJsonBytes((async function* () { yield bytes('['); yield bytes('123456789'); })(), {maxBytes: 4}), /JSON_SIZE/);
  await assert.rejects(collectJsonBytes((async function* () { yield {}; })()), /JSON_BYTES_REQUIRED/);
  await assert.rejects(collectJsonBytes((async function* () { for (let i = 0; i < 4097; i++) yield Buffer.alloc(0); })()), /JSON_SIZE/);
  await assert.rejects(collectJsonBytes(bytes('{}'), {signal: AbortSignal.abort()}), /INPUT_ABORTED/);
  await assert.rejects(collectJsonBytes(bytes('{"a":')), /JSON_GRAMMAR/);
});

test('JSON guard-removal mutation admits a duplicate that the real module rejects', async () => {
  const source = readFileSync(new URL('../scripts/ci/trusted-evidence-json.mjs', import.meta.url), 'utf8');
  const mutation = source.replace('const text = validateJsonBytes(input, limits);', 'const text = Buffer.from(input).toString("utf8");');
  assert.notEqual(mutation, source);
  const mutant = await import(`data:text/javascript;base64,${Buffer.from(mutation).toString('base64')}`);
  const attack = bytes('{"run_attempt":1,"run_attempt":2}');
  assert.deepEqual(mutant.parseJsonBytes(attack), {run_attempt: 2});
  assert.throws(() => parseJsonBytes(attack), /JSON_DUPLICATE_KEY/);
});
