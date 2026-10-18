import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Render the real route and catalogue. Only navigation/chrome/viewport hooks are
// adapted for Node; keyboard, layout and navigation need separate browser checks.
const sourceRoot = new URL('../src/', import.meta.url)
const componentUrl = new URL('features/landing/components/PaidResearchCatalogSection.tsx', sourceRoot)
const adapterKey = Symbol.for('product-catalog-public-ui')
globalThis[adapterKey] = createElement
const adapter = source => `data:text/javascript,${encodeURIComponent(source)}`
const element = "const h=globalThis[Symbol.for('product-catalog-public-ui')];"
const replacements = new Map([
  ['next/link', adapter(element + "export default function Link(p){return h('a',p)}")],
  ['@/features/landing/components/Navbar', adapter(element + "export function Navbar(){return h('nav',{'aria-label':'Existing navigation'})}")],
  ['@/features/landing/components/Footer', adapter(element + "export function Footer(){return h('footer',null,'Existing footer')}")],
  ['@/features/landing/hooks/useInView', adapter("export function useInView(){return {ref:null,inView:true}}")],
])
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(sourceRoot.href)) {
      if (replacements.has(specifier)) return next(replacements.get(specifier), context)
      if (specifier.startsWith('@/')) {
        const relative = specifier.slice(2)
        const url = ['.tsx', '.ts'].map(ext => new URL(relative + ext, sourceRoot)).find(existsSync)
        if (url) return next(url.href, context)
      }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot.href) && /\.tsx?$/.test(url)) {
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText }
    }
    return next(url, context)
  },
})
let PaidResearchCatalogSection, SanPhamPage
try {
  ;({ PaidResearchCatalogSection } = await import(componentUrl.href))
  ;({ default: SanPhamPage } = await import(new URL('app/san-pham/SanPhamClient.tsx', sourceRoot).href))
} finally {
  hook.deregister()
  delete globalThis[adapterKey]
}
const render = state => renderToStaticMarkup(createElement(PaidResearchCatalogSection, { state }))
const consultationOnly = html => {
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])
  assert.ok(hrefs.length > 0)
  assert.ok(hrefs.every(href => href === '/nha-dau-tu'))
  assert.doesNotMatch(html, /<button|<form|<input|checkout|entitlement|runtimeAuthorized/i)
}

test('empty catalogue is honest, labelled, and offers consultation without invented products', () => {
  const html = render({ status: 'ready', products: [] })
  assert.match(html, /Nghiên cứu trả phí/)
  assert.match(html, /Chưa có dữ liệu công bố/)
  assert.match(html, /role="status"/)
  const headingId = html.match(/<h2 id="([^"]+)"/)?.[1]
  assert.ok(headingId)
  assert.ok(html.includes(`aria-labelledby="${headingId}"`))
  assert.doesNotMatch(html, /<article|<ul|₫|VNĐ|\/tháng/)
  consultationOnly(html)
})

test('loading announces progress and never exposes stale supplied product data', () => {
  const html = render({ status: 'loading', products: [{ id: 'test-only', name: 'STALE FIXTURE' }] })
  assert.match(html, /role="status"/)
  assert.match(html, /Đang tải danh sách sản phẩm/)
  assert.doesNotMatch(html, /STALE FIXTURE|<article|Chưa có dữ liệu công bố/)
  consultationOnly(html)
})

test('error is accessible, generic and does not expose a supplied backend error', () => {
  const html = render({ status: 'error', error: 'PRIVATE_BACKEND_DETAIL', products: [{ name: 'STALE FIXTURE' }] })
  assert.match(html, /role="alert"/)
  assert.match(html, /Chưa thể tải danh sách sản phẩm/)
  assert.doesNotMatch(html, /PRIVATE_BACKEND_DETAIL|STALE FIXTURE|<article/)
  consultationOnly(html)
})

test('supplied public metadata renders as text with consultation links, without commercial fields', () => {
  // Test-only metadata; never imported by the page or treated as a real catalogue.
  const products = Object.freeze([
    Object.freeze({ id: 'fixture-only-a', name: 'Nghiên cứu thử nghiệm A', description: 'Mô tả tiếng Việt & phân tích.', price: 'PRIVATE_PRICE', entitlement: 'PRIVATE_ACCESS' }),
    Object.freeze({ id: 'fixture-only-b', name: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' }),
  ])
  const html = render({ status: 'ready', products })
  assert.equal((html.match(/<article /g) ?? []).length, 2)
  assert.match(html, /Nghiên cứu thử nghiệm A/)
  assert.match(html, /Mô tả tiếng Việt &amp; phân tích/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /aria-label="Liên hệ tư vấn về Nghiên cứu thử nghiệm A"/)
  assert.doesNotMatch(html, /<script|<img|PRIVATE_PRICE|PRIVATE_ACCESS|fixture-only-[ab]/)
  consultationOnly(html)
})

test('Screen 01 keeps existing offerings and replaces inert flagship buttons with real advice links', () => {
  const html = renderToStaticMarkup(createElement(SanPhamPage))
  for (const text of ['Existing navigation', 'Existing footer', 'Ba dịch vụ cốt lõi', 'Tư vấn sử dụng hệ thống', 'Cho thuê hệ thống', 'Môi giới đầu tư', 'LKC Stock', 'LKC Crypto', 'Chưa có dữ liệu công bố']) {
    assert.ok(html.includes(text), text)
  }
  for (const name of ['Stock', 'Crypto']) {
    assert.match(html, new RegExp('<a href="/nha-dau-tu"[^>]*>Tư vấn LKC ' + name))
  }
  assert.doesNotMatch(html, /<button|Tham gia LKC|<article/)
  assert.match(html, /href="\/goc-nhin"/)
})

test('both flagship focus indicators contrast at least 3:1 across their gradient backgrounds', () => {
  const nodes = (value, ancestors = []) => Array.isArray(value) ? value.flatMap(child => nodes(child, ancestors))
    : value && typeof value === 'object' && value.props
      ? [{ node: value, ancestors }, ...nodes(value.props.children, [...ancestors, value])] : []
  const rgb = hex => hex.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255)
  const luminance = channels => channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
  const tree = nodes(SanPhamPage())
  for (const name of ['Stock', 'Crypto']) {
    const matches = tree.filter(({ node }) => node.props.href === '/nha-dau-tu'
      && String(node.props.children?.[0]).trim() === 'Tư vấn LKC ' + name)
    assert.equal(matches.length, 1, name)
    const { node, ancestors } = matches[0]
    const ring = node.props.className.match(/focus-visible:outline-\[(#[a-f\d]{6})\]/i)?.[1]
    assert.ok(ring, name + ': explicit focus colour is required')
    assert.ok(node.props.className.split(' ').includes('focus-visible:outline-2'))
    assert.ok(node.props.className.split(' ').includes('focus-visible:outline-offset-4'))
    const gradient = ancestors.findLast(parent => parent.props.style?.background?.startsWith('linear-gradient'))?.props.style.background
    const stops = gradient?.match(/#[a-f\d]{6}/gi) ?? []
    assert.equal(stops.length, 3, name + ': measure every gradient stop')
    for (const stop of stops) {
      assert.ok(contrast(rgb(ring), rgb(stop)) >= 3, name + ': insufficient contrast against ' + stop)
    }
    // Conservative lower bound for all sRGB interpolated colours, not just
    // endpoints. A white decorative glow only raises this dark ring's contrast.
    const lowerBound = [0, 1, 2].map(channel => Math.min(...stops.map(stop => rgb(stop)[channel])))
    assert.ok(luminance(rgb(ring)) < luminance(lowerBound), name + ': expected a dark indicator')
    assert.ok(contrast(rgb(ring), lowerBound) >= 3, name + ': gradient interior contrast')
  }
})
