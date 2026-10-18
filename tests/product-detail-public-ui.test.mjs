import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Synthetic DTOs stay in tests. Render the actual component with chrome adapted
// for Node; production route HTTP, responsive layout and focus need browser QA.
const root = new URL('../src/', import.meta.url)
const componentURL = new URL('features/landing/components/PaidResearchProductDetail.tsx', root)
const pageURL = new URL('app/san-pham/[slug]/page.tsx', root)
const adapterKey = Symbol.for('product-detail-public-ui')
globalThis[adapterKey] = createElement
const adapter = source => 'data:text/javascript,' + encodeURIComponent(source)
const h = "const h=globalThis[Symbol.for('product-detail-public-ui')];"
const replacements = new Map([
  ['server-only', adapter('export {}')],
  ['next/link', adapter(h + "export default function Link(p){return h('a',p)}")],
  ['next/navigation', adapter("export function notFound(){throw new Error('NEXT_HTTP_ERROR_FALLBACK;404')}")],
  ['./Navbar', adapter(h + "export function Navbar(){return h('nav',{'aria-label':'Existing navigation'})}")],
  ['./Footer', adapter(h + "export function Footer(){return h('footer',null,'Existing footer')}")],
])
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(root.href) && replacements.has(specifier)) {
      return next(replacements.get(specifier), context)
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.startsWith(root.href) && url.endsWith('.tsx')) {
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText }
    }
    return next(url, context)
  },
})
let PaidResearchProductDetail, ProductDetailPage
try {
  ;({ PaidResearchProductDetail } = await import(componentURL.href))
  ;({ default: ProductDetailPage } = await import(pageURL.href))
} finally {
  hook.deregister()
  delete globalThis[adapterKey]
}
const fixture = overrides => Object.freeze({
  publication: 'published', kind: 'equities',
  name: 'Mẫu kiểm thử — không phải sản phẩm công bố',
  description: 'Mô tả tổng hợp chỉ dùng kiểm thử.', ...overrides,
})
const render = product => renderToStaticMarkup(createElement(PaidResearchProductDetail, { product }))
const noCommerce = html => {
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])
  assert.deepEqual([...new Set(hrefs)].sort(), ['#product-detail', '/nha-dau-tu', '/san-pham'])
  assert.doesNotMatch(html, /<button|<form|<input|checkout|ProductPlan|entitlement|runtimeAuthorized|₫|VNĐ/)
}

test('missing or unpublished DTO never leaks supplied metadata', () => {
  for (const product of [null, undefined, fixture({ publication: 'draft', name: 'PRIVATE_NAME', description: 'PRIVATE_BODY' })]) {
    const html = render(product)
    assert.match(html, /Chưa có thông tin sản phẩm công bố/)
    assert.match(html, /role="status"/)
    assert.doesNotMatch(html, /PRIVATE_NAME|PRIVATE_BODY|Quyền lợi theo thiết kế/)
    noCommerce(html)
  }
})

test('invalid public DTO fails closed, including inherited object keys', () => {
  for (const patch of [
    { kind: 'unknown' }, { kind: 'constructor' }, { kind: '__proto__' },
    { name: '' }, { name: '   ' }, { name: 42 }, { description: null }, { description: ' ' },
    { publication: undefined },
  ]) {
    const html = render(fixture(patch))
    assert.match(html, /Chưa có thông tin sản phẩm công bố/)
    assert.doesNotMatch(html, /Mô tả tổng hợp|Mẫu kiểm thử|Quyền lợi theo thiết kế/)
  }
})

test('all five approved categories retain three included benefit groups', () => {
  for (const [kind, label] of [
    ['equities', 'Chứng khoán cơ sở'], ['equityDerivatives', 'Chứng khoán phái sinh'],
    ['commodityDerivatives', 'Hàng hóa phái sinh'], ['gold', 'Vàng'], ['digitalAssets', 'Tài sản số'],
  ]) {
    const html = render(fixture({ kind }))
    assert.ok(html.includes(label))
    assert.ok(html.includes('Gói bao gồm khuyến nghị thủ công, khuyến nghị tự động, vùng và xu hướng xác suất'))
    const headings = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(match => match[1])
    assert.deepEqual(headings, ['Khuyến nghị thủ công', 'Khuyến nghị tự động', 'Vùng và xu hướng xác suất'])
    assert.ok(html.includes('Nội dung có thể được tiếp nhận từ server/hệ thống máy hoặc webhook khi có nguồn được cấu hình và kiểm chứng.'))
    assert.doesNotMatch(html, /có hỗ trợ tự động hóa|Vùng \/ xu hướng xác suất/)
    assert.equal((html.match(/<li /g) ?? []).length, 3)
    assert.match(html, /không phải ba gói bán riêng/)
    assert.equal((html.match(/Chưa xác nhận sẵn sàng/g) ?? []).length, 3)
    noCommerce(html)
  }
})

test('availability is explicit per benefit and independent of publication', () => {
  const html = render(fixture({ availability: Object.freeze({ manual: 'available', automated: 'not_ready', probability: 'unconfirmed' }) }))
  assert.match(html, /Thông tin giới thiệu đã công bố/)
  assert.equal((html.match(/Đã sẵn sàng cung cấp/g) ?? []).length, 1)
  assert.equal((html.match(/Chưa sẵn sàng cung cấp/g) ?? []).length, 1)
  assert.equal((html.match(/Chưa xác nhận sẵn sàng/g) ?? []).length, 1)
  assert.match(html, /Mô tả thiết kế không đồng nghĩa với việc dữ liệu đang hoạt động/)
  for (const availability of [null, {}, { manual: 'invalid', automated: true, probability: '<script>secret</script>' }]) {
    const fallback = render(fixture({ availability }))
    assert.equal((fallback.match(/Chưa xác nhận sẵn sàng/g) ?? []).length, 3)
    assert.doesNotMatch(fallback, /Đã sẵn sàng cung cấp|secret/)
  }
})

test('DTO text is escaped and unknown commercial/private fields are never rendered', () => {
  const html = render(fixture({
    name: '<script>alert("test")</script>', description: '<img src=x onerror=alert(1)> & thử',
    productId: 'PRIVATE_ID', slug: 'PRIVATE_SLUG', price: 'PRIVATE_PRICE',
    term: 'PRIVATE_TERM', entitlement: 'PRIVATE_ACCESS', internalNotes: 'PRIVATE_NOTES',
    href: 'javascript:alert(1)',
  }))
  assert.match(html, /&lt;script&gt;alert\(&quot;test&quot;\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; thử/)
  assert.doesNotMatch(html, /<script|<img|PRIVATE_|javascript:/)
  noCommerce(html)
})

test('detail has labelled landmarks, heading hierarchy and keyboard destinations', () => {
  for (const product of [null, fixture()]) {
    const html = render(product)
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1)
    assert.equal((html.match(/<main /g) ?? []).length, 1)
    assert.match(html, /id="product-detail" tabindex="-1"/)
    assert.match(html, /href="#product-detail"/)
    for (const [, id] of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(html.includes('id="' + id + '"'))
    assert.match(html, /focus-visible:outline-2/)
    assert.match(html, /focus-visible:outline-\[#0F172A\]/)
    assert.doesNotMatch(html, /tabindex="[1-9]/)
  }
})

test('every slug fails closed while the approved public source is missing', () => {
  // Strings below are test inputs, never production slug mappings.
  for (const slug of ['fixture-only', 'unknown', 'gold', 'constructor', '<script>']) {
    assert.throws(() => ProductDetailPage({ params: Promise.resolve({ slug }) }), /NEXT_HTTP_ERROR_FALLBACK;404/)
  }
  assert.throws(() => ProductDetailPage(), /NEXT_HTTP_ERROR_FALLBACK;404/)
})

test('public route stays disconnected from staff producers, data adapters and fixtures', () => {
  const page = readFileSync(pageURL, 'utf8')
  const component = readFileSync(componentURL, 'utf8')
  const imports = [...page.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1])
  assert.deepEqual(imports, ['next/navigation'])
  assert.match(component, /^import 'server-only'/)
  assert.doesNotMatch(page + component, /dangerouslySetInnerHTML|fetch\(|prisma\.|generateStaticParams|generateMetadata/)
})
