import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const root = new URL('../src/', import.meta.url)
const component = new URL('features/referrals/components/ClientRegistrationEntry.tsx', root).href
const route = new URL('app/dang-ky/page.tsx', root).href
const bridge = Symbol.for('screen03-react-test')
let current
globalThis[bridge] = {
  useId: () => 'screen03',
  useState(initial) {
    const owner = current, slot = owner.cursor++
    if (!(slot in owner.values)) owner.values[slot] = typeof initial === 'function' ? initial() : initial
    return [owner.values[slot], next => { owner.values[slot] = typeof next === 'function' ? next(owner.values[slot]) : next }]
  },
  useRef(initial) {
    const owner = current, slot = owner.cursor++
    if (!(slot in owner.values)) owner.values[slot] = { current: initial }
    return owner.values[slot]
  },
}
// Actual TSX + referral state machine; React scheduling and Next link/navigation
// are adapted. These are unit/render checks, not browser/server integration proof.
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react' && context.parentURL === component) return { url: 'screen03:react', shortCircuit: true }
    if (specifier === 'react' && context.parentURL?.startsWith('screen03:')) return nextResolve(import.meta.resolve('react'), context)
    if (specifier === 'next/link') return { url: 'screen03:link', shortCircuit: true }
    if (specifier.includes('landing/components/Navbar')) return { url: 'screen03:navbar', shortCircuit: true }
    if (specifier.includes('landing/components/Footer')) return { url: 'screen03:footer', shortCircuit: true }
    if (specifier.startsWith('@/')) return nextResolve(new URL(specifier.slice(2), root).href + '.tsx', context)
    if (specifier.startsWith('.') && context.parentURL?.startsWith(root.href)) {
      const url = new URL(specifier, context.parentURL)
      for (const suffix of ['.ts', '.tsx']) if (existsSync(new URL(url.href + suffix))) return nextResolve(url.href + suffix, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    const mocks = {
      'screen03:react': `export const {useId,useState,useRef}=globalThis[Symbol.for('screen03-react-test')]`,
      'screen03:link': `import {createElement} from 'react'; export default function Link(p){return createElement('a',p,p.children)}`,
      'screen03:navbar': `import {createElement} from 'react'; export const Navbar=()=>createElement('nav',null,'LKC Navbar')`,
      'screen03:footer': `import {createElement} from 'react'; export const Footer=()=>createElement('footer',null,'LKC Footer')`,
    }
    if (mocks[url]) return { format: 'module', source: mocks[url], shortCircuit: true }
    if (url.startsWith(root.href) && /\.tsx?$/.test(url)) {
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: url,
      }).outputText }
    }
    return nextLoad(url, context)
  },
})
const { ClientRegistrationEntry } = await import(component)
const { ReferralCodeField } = await import(new URL('features/referrals/components/ReferralCodeField.tsx', root))
const { default: RegistrationPage, metadata } = await import(route)
hook.deregister()

function mount(adapter) {
  const owner = { cursor: 0, values: [] }
  return { render() { current = owner; owner.cursor = 0; return ClientRegistrationEntry({ adapter }) } }
}
function nodes(element, type) {
  if (!element || typeof element !== 'object') return []
  return [...(element.type === type ? [element] : []), ...[element.props?.children].flat(Infinity).flatMap(child => nodes(child, type))]
}
function referral(tree) { return nodes(tree, ReferralCodeField)[0].props }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const originalFormData = globalThis.FormData
const originalInput = Object.getOwnPropertyDescriptor(globalThis, 'HTMLInputElement')
afterEach(() => {
  globalThis.FormData = originalFormData
  if (originalInput) Object.defineProperty(globalThis, 'HTMLInputElement', originalInput)
  else delete globalThis.HTMLInputElement
})
function formFixture() {
  class Input { value = 'synthetic-password' }
  globalThis.HTMLInputElement = Input
  const inputs = { password: new Input(), confirmPassword: new Input() }
  globalThis.FormData = class extends Map { constructor() { super([['name', 'Synthetic'], ['email', 'test@example.invalid'], ['password', inputs.password.value], ['confirmPassword', inputs.confirmPassword.value]]) } }
  return { inputs, event: { preventDefault() {}, currentTarget: { elements: { namedItem: key => inputs[key] } } } }
}

test('production route composes existing Navbar/Footer and supplies no adapter', () => {
  const tree = RegistrationPage()
  assert.equal(nodes(tree, ClientRegistrationEntry).length, 1)
  assert.deepEqual(nodes(tree, ClientRegistrationEntry)[0].props, {})
  assert.equal(tree.props.children[0].type.name, 'Navbar')
  assert.equal(tree.props.children.at(-1).type.name, 'Footer')
  assert.equal(metadata.alternates.canonical, '/dang-ky')
})

test('default route clearly unavailable; fields empty, disabled, no password collection', () => {
  const tree = mount().render()
  assert.match(renderToStaticMarkup(tree), /Đăng ký trực tuyến chưa sẵn sàng/)
  assert.equal(nodes(tree, 'fieldset')[0].props.disabled, true)
  for (const input of nodes(tree, 'input')) {
    assert.equal(input.props.disabled, true)
    assert.equal(input.props.value, '')
    assert.equal(input.props.readOnly, true)
    assert.equal(input.props.autoComplete, 'off')
  }
  assert.equal(referral(tree).disabled, true)
  assert.equal(referral(tree).onVerify, undefined)
})

test('programmatic submit without adapter returns before any data read', async () => {
  globalThis.FormData = class { constructor() { assert.fail('must not collect input') } }
  let prevented = false
  await nodes(mount().render(), 'form')[0].props.onSubmit({ preventDefault() { prevented = true }, get currentTarget() { assert.fail('must not read form') } })
  assert.equal(prevented, true)
})

test('programmatic referral edit without adapter is ignored', () => {
  const mounted = mount()
  referral(mounted.render()).onChange('PRIVATE')
  assert.equal(referral(mounted.render()).state.input.kind, 'omitted')
  assert.doesNotMatch(renderToStaticMarkup(mounted.render()), /PRIVATE/)
})

test('all registration fields have linked labels; no invented password format', () => {
  const tree = mount({ submit: async () => ({}) }).render()
  for (const input of nodes(tree, 'input')) {
    assert.ok(nodes(tree, 'label').some(l => l.props.htmlFor === input.props.id))
    assert.equal(input.props.pattern, undefined)
    assert.equal(input.props.minLength, undefined)
  }
  assert.equal(referral(tree).state.status, 'omitted')
})

test('referral edits preserve whitespace/case; optional value can be explicitly cleared', () => {
  const mounted = mount({ submit: async () => ({}) })
  referral(mounted.render()).onChange(' AbC ')
  assert.equal(referral(mounted.render()).state.input.code, ' AbC ')
  referral(mounted.render()).onChange('')
  assert.equal(referral(mounted.render()).state.status, 'omitted')
})

test('late verification response cannot overwrite edited code', async () => {
  const response = deferred()
  const mounted = mount({ submit: async () => ({}), verifyReferral: () => response.promise })
  referral(mounted.render()).onChange('A')
  const task = referral(mounted.render()).onVerify()
  assert.equal(referral(mounted.render()).state.status, 'pending')
  referral(mounted.render()).onChange('B')
  response.resolve({ outcome: 'valid' }); await task
  assert.equal(referral(mounted.render()).state.status, 'unverified')
  assert.equal(referral(mounted.render()).state.input.code, 'B')
})

for (const [payload, status] of [[{ outcome: 'invalid' }, 'invalid'], [{ outcome: 'unavailable' }, 'source-error'], [{ outcome: 'valid' }, 'reported-valid']]) {
  test(`verification ${status} reuses PR76 state without losing code`, async () => {
    const mounted = mount({ submit: async () => ({}), verifyReferral: async () => payload })
    referral(mounted.render()).onChange(' A ')
    await referral(mounted.render()).onVerify()
    assert.equal(referral(mounted.render()).state.status, status)
    assert.equal(referral(mounted.render()).state.input.code, ' A ')
  })
}

test('verification rejection yields source-error and never renders raw exception', async () => {
  const mounted = mount({ submit: async () => ({}), verifyReferral: async () => { throw Error('PRIVATE') } })
  referral(mounted.render()).onChange('A')
  await referral(mounted.render()).onVerify()
  assert.equal(referral(mounted.render()).state.status, 'source-error')
  assert.doesNotMatch(renderToStaticMarkup(mounted.render()), /PRIVATE/)
})

test('submission locks fields, rejects duplicate submit and keeps exact referral for server', async () => {
  const response = deferred(), calls = []
  const mounted = mount({ submit: (data, intent) => { calls.push({ data, intent }); return response.promise } })
  referral(mounted.render()).onChange(' AbC ')
  const { event, inputs } = formFixture()
  const task = nodes(mounted.render(), 'form')[0].props.onSubmit(event)
  assert.equal(nodes(mounted.render(), 'form')[0].props['aria-busy'], true)
  assert.equal(nodes(mounted.render(), 'fieldset')[0].props.disabled, true)
  await nodes(mounted.render(), 'form')[0].props.onSubmit(event)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].intent.kind, 'requires-server-verification')
  assert.equal(calls[0].data.get('referralCode'), ' AbC ')
  response.resolve({ status: 'unavailable' }); await task
  assert.equal(inputs.password.value, '')
  assert.equal(inputs.confirmPassword.value, '')
  assert.equal(calls[0].data.has('password'), false)
  assert.equal(referral(mounted.render()).state.input.code, ' AbC ')
  assert.match(renderToStaticMarkup(mounted.render()), /Chưa thể hoàn tất đăng ký/)
})

test('server field errors associate with inputs, without rendering remote strings', async () => {
  const mounted = mount({ submit: async () => ({ status: 'field-errors', fields: { email: 'invalid', password: 'required', referralCode: 'invalid', name: 'PRIVATE' } }) })
  const { event } = formFixture()
  await nodes(mounted.render(), 'form')[0].props.onSubmit(event)
  const tree = mounted.render(), input = nodes(tree, 'input').find(n => n.props.name === 'email')
  assert.equal(input.props['aria-invalid'], true)
  assert.ok(nodes(tree, 'p').some(n => n.props.id === input.props['aria-describedby']))
  const group = nodes(tree, 'div').find(n => n.props.role === 'group')
  assert.ok(nodes(tree, 'p').some(n => n.props.id === group.props['aria-describedby']))
  assert.doesNotMatch(renderToStaticMarkup(tree), /PRIVATE/)
})

test('submission exception and forged success cannot claim a created account or subscription', async () => {
  for (const submit of [async () => { throw Error('PRIVATE') }, async () => ({ status: 'success', role: 'CLIENT', subscriptionActive: true })]) {
    const mounted = mount({ submit }), { event } = formFixture()
    await nodes(mounted.render(), 'form')[0].props.onSubmit(event)
    assert.match(renderToStaticMarkup(mounted.render()), /Chưa thể hoàn tất đăng ký/)
    assert.doesNotMatch(renderToStaticMarkup(mounted.render()), /PRIVATE|subscriptionActive|Tạo tài khoản thành công/)
  }
})

test('no automatic caregiver or commission content; no prototype controls in production', () => {
  const html = renderToStaticMarkup(mount().render())
  assert.doesNotMatch(html, /LKC-DEMO01|assignedSalesId|hoa hồng|người chăm sóc|role="combobox"/)
  assert.match(html, /không tự kích hoạt sản phẩm/)
  assert.match(html, /href="\/dang-nhap"/)
  assert.match(html, /href="\/nha-dau-tu"/)
})
