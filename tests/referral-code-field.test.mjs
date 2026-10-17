import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import ts from 'typescript'
import { renderToStaticMarkup } from 'react-dom/server'
import { createReferralEntry, beginReferralCheck, completeReferralCheck, changeReferralCode } from '../src/features/referrals/registration-referral-intent.ts'

// Transpile only the actual TSX component; real React elements/server renderer.
// Direct event-handler tests below are not browser/hydration or server authority proof.
const componentURL = new URL('../src/features/referrals/components/ReferralCodeField.tsx', import.meta.url).href
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url !== componentURL) return nextLoad(url, context)
    const { outputText } = ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: 'ReferralCodeField.tsx',
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  },
})
const { ReferralCodeField } = await import(componentURL)
hook.deregister()

function nodes(element, type) {
  if (!element || typeof element !== 'object') return []
  return [ ...(element.type === type ? [element] : []),
    ...[element.props?.children].flat(Infinity).flatMap(child => nodes(child, type)) ]
}
function field(state = createReferralEntry(), overrides = {}) {
  return ReferralCodeField({ id: 'referral', state, onChange() {}, ...overrides })
}
function result(outcome) {
  const pending = beginReferralCheck(createReferralEntry('Code'))
  return completeReferralCheck(pending, pending.request, { outcome })
}

test('optional text field has linked label/help/status and no invented code rules', () => {
  const tree = field()
  const input = nodes(tree, 'input')[0].props
  assert.equal(nodes(tree, 'label')[0].props.htmlFor, input.id)
  assert.equal(input.type, 'text')
  assert.equal(input.name, 'referralCode')
  assert.equal(input.required, undefined)
  assert.equal(input.pattern, undefined)
  assert.equal(input.maxLength, undefined)
  for (const id of input['aria-describedby'].split(' ')) assert.ok(nodes(tree, 'p').some(p => p.props.id === id))
  assert.equal(nodes(tree, 'p').find(p => p.props.role === 'status').props['aria-live'], 'polite')
})

test('missing verification adapter is explicit and cannot fabricate a successful check', () => {
  const tree = field(createReferralEntry('Code'))
  assert.equal(nodes(tree, 'button')[0].props.disabled, true)
  assert.match(renderToStaticMarkup(tree), /Chưa kết nối nguồn xác minh/)
  assert.match(renderToStaticMarkup(tree), /chưa được xác minh/)
})

test('native button is keyboard accessible without submitting registration', () => {
  const received = []
  const tree = field(createReferralEntry(' AbC '), { onVerify: code => received.push(code) })
  const button = nodes(tree, 'button')[0].props
  assert.equal(button.type, 'button')
  assert.equal(button.disabled, false)
  assert.equal(button.tabIndex, undefined)
  button.onClick()
  assert.deepEqual(received, [' AbC '])
  assert.equal(nodes(tree, 'input')[0].props.onKeyDown, undefined)
  assert.equal(nodes(tree, 'form').length, 0)
})

test('input edits preserve exact text and explicit clearing, with no client normalization', () => {
  const received = []
  const input = nodes(field(createReferralEntry('A'), { onChange: value => received.push(value) }), 'input')[0]
  input.props.onChange({ currentTarget: { value: ' aBc ' } })
  input.props.onChange({ currentTarget: { value: '' } })
  assert.deepEqual(received, [' aBc ', ''])
})

test('pending announces busy, retains editable input and prevents duplicate verification', () => {
  const state = beginReferralCheck(createReferralEntry('Code'))
  const tree = field(state, { onVerify() { assert.fail('duplicate check') } })
  assert.equal(tree.props['aria-busy'], true)
  const input = nodes(tree, 'input')[0].props
  assert.equal(input.value, 'Code')
  assert.equal(input.disabled, false)
  const button = nodes(tree, 'button')[0].props
  assert.equal(button.disabled, true)
  button.onClick()
  assert.match(renderToStaticMarkup(tree), /Đang kiểm tra/)
})

for (const [outcome, expected] of [['invalid', /mã không hợp lệ/], ['unavailable', /Không thể xác minh/]]) {
  test(`${outcome} has associated field error and retains code`, () => {
    const tree = field(result(outcome), { onVerify() {} })
    assert.equal(nodes(tree, 'input')[0].props['aria-invalid'], true)
    assert.equal(nodes(tree, 'input')[0].props.value, 'Code')
    assert.match(renderToStaticMarkup(tree), expected)
  })
}

test('reported positive result explicitly requires server revalidation', () => {
  const tree = field(result('valid'))
  assert.match(renderToStaticMarkup(tree), /Máy chủ vẫn phải xác minh khi đăng ký/)
  assert.equal(nodes(tree, 'input')[0].props['aria-invalid'], undefined)
})

test('malformed input is a field error, never a false omission', () => {
  const tree = field(createReferralEntry({ assignedSalesId: 'private-sales' }))
  assert.equal(nodes(tree, 'input')[0].props['aria-invalid'], true)
  assert.match(renderToStaticMarkup(tree), /Dữ liệu mã giới thiệu không hợp lệ/)
  assert.doesNotMatch(renderToStaticMarkup(tree), /private-sales/)
})

test('markup escapes entered HTML and does not render remote verification content', () => {
  const tree = field(createReferralEntry('<script>alert(1)</script>'))
  const html = renderToStaticMarkup(tree)
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
})

test('disabled parent prevents checks; empty value cannot initiate a check', () => {
  for (const tree of [field(createReferralEntry('A'), { disabled: true, onVerify() { assert.fail() } }),
    field(createReferralEntry(''), { onVerify() { assert.fail() } })]) {
    const button = nodes(tree, 'button')[0].props
    assert.equal(button.disabled, true)
    button.onClick()
  }
})

test('field supports narrow containers and touch-sized native controls', () => {
  const tree = field()
  assert.match(tree.props.className, /min-w-0/)
  assert.ok(nodes(tree, 'div').some(n => n.props.className.includes('flex-col')))
  for (const type of ['input', 'button']) assert.match(nodes(tree, type)[0].props.className, /min-h-11/)
})

test('two field instances keep labels and announcements separate', () => {
  const first = field(createReferralEntry(), { id: 'first' })
  const second = field(createReferralEntry(), { id: 'second' })
  assert.notEqual(nodes(first, 'input')[0].props.id, nodes(second, 'input')[0].props.id)
  assert.notEqual(nodes(first, 'input')[0].props['aria-describedby'], nodes(second, 'input')[0].props['aria-describedby'])
})

test('controlled parent composes edit/check/response without clearing a failed code', () => {
  let state = createReferralEntry('A')
  const props = { onChange(raw) { state = changeReferralCode(state, raw) }, onVerify() { state = beginReferralCheck(state) } }
  nodes(field(state, props), 'button')[0].props.onClick()
  const request = state.request
  nodes(field(state, props), 'input')[0].props.onChange({ currentTarget: { value: 'B' } })
  state = completeReferralCheck(state, request, { outcome: 'valid' })
  assert.equal(state.status, 'unverified')
  nodes(field(state, props), 'button')[0].props.onClick()
  state = completeReferralCheck(state, state.request, { outcome: 'invalid' })
  assert.equal(nodes(field(state, props), 'input')[0].props.value, 'B')
  assert.equal(nodes(field(state, props), 'input')[0].props['aria-invalid'], true)
})
