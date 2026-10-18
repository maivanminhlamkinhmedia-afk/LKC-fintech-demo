import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const root = new URL('../src/features/landing/', import.meta.url)
const projectionURL = new URL('public-research-catalog-projection.ts', root)
const contractURL = new URL('public-research-catalog-contract.ts', root)
const detailURL = new URL('components/PaidResearchProductDetail.tsx', root)
const catalogURL = new URL('components/PaidResearchCatalogSection.tsx', root)
const adapterKey = Symbol.for('catalog-candidate-boundary-test')
globalThis[adapterKey] = createElement
const adapter = source => 'data:text/javascript,' + encodeURIComponent(source)
const h = "const h=globalThis[Symbol.for('catalog-candidate-boundary-test')];"
const replacements = new Map([
  ['next/link', adapter(h + "export default function Link(p){return h('a',p)}")],
  ['./Navbar', adapter(h + "export function Navbar(){return h('nav',null,'Existing navigation')}")],
  ['./Footer', adapter(h + "export function Footer(){return h('footer',null,'Existing footer')}")],
])
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(root.href)) {
      if (specifier === 'server-only') return next('data:text/javascript,export{}', context)
      if (specifier === './public-research-catalog-contract') return next(contractURL.href, context)
      if (replacements.has(specifier)) return next(replacements.get(specifier), context)
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if ([projectionURL.href, contractURL.href, detailURL.href, catalogURL.href].includes(url)) {
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText }
    }
    return next(url, context)
  },
})
let projectPublicResearchCatalog, projectResearchCatalogCandidate, limits
let PaidResearchProductDetail, PaidResearchCatalogSection
try {
  ;({ projectPublicResearchCatalog, projectResearchCatalogCandidate } = await import(projectionURL.href))
  ;({ RESEARCH_CATALOG_INPUT_LIMITS: limits } = await import(contractURL.href))
  ;({ PaidResearchProductDetail } = await import(detailURL.href))
  ;({ PaidResearchCatalogSection } = await import(catalogURL.href))
} finally {
  hook.deregister()
  delete globalThis[adapterKey]
}

// Synthetic identities below exist only in tests; no ID/slug/catalogue is seeded.
const fixture = overrides => ({
  id: 'fixture-only-a', publication: 'published', kind: 'equities',
  name: 'Mẫu kiểm thử', description: 'Nội dung tổng hợp & chưa xác minh nguồn công bố.',
  ...overrides,
})
const invalid = snapshot => assert.deepEqual(projectResearchCatalogCandidate(snapshot), { status: 'INVALID_SNAPSHOT' })

test('public boundary stays closed with no producer, even for forged approval and valid candidates', () => {
  const candidate = projectResearchCatalogCandidate([fixture()])
  let reads = 0
  const forged = { approved: true, publication: 'published', source: 'C01', products: [fixture()] }
  Object.defineProperty(forged, 'authorization', { get() { reads++; throw Error('PRIVATE') } })
  for (const input of [undefined, null, [], forged, candidate]) {
    // JS extra arguments cannot become an authorization path.
    const result = projectPublicResearchCatalog(input)
    assert.deepEqual(result, { status: 'PUBLICATION_SOURCE_UNAVAILABLE', products: [] })
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.products))
  }
  assert.equal(reads, 0)
})

test('all five kinds project three benefit states without deriving an identity or approving publication', () => {
  const kinds = ['equities', 'equityDerivatives', 'commodityDerivatives', 'gold', 'digitalAssets']
  const input = kinds.map((kind, i) => fixture({ id: 'fixture-only-' + i, kind }))
  const result = projectResearchCatalogCandidate(input)
  assert.equal(result.status, 'CANDIDATE_ONLY')
  assert.equal(result.publicationVerified, false)
  assert.equal(result.products.length, 5)
  result.products.forEach((product, i) => {
    assert.equal(product.suppliedId, input[i].id)
    assert.equal(product.suppliedKind, kinds[i])
    assert.deepEqual(product.suppliedAvailability, { manual: 'unconfirmed', automated: 'unconfirmed', probability: 'unconfirmed' })
    assert.deepEqual(Object.keys(product).sort(), ['candidateTag', 'suppliedAvailability', 'suppliedDescription', 'suppliedId', 'suppliedKind', 'suppliedName'])
    assert.equal(product.candidateTag, 'UNVERIFIED_SUPPLIED_SNAPSHOT')
  })
})

test('empty supplied catalogue remains an unverified candidate, never a public ready result', () => {
  assert.deepEqual(projectResearchCatalogCandidate([]), { status: 'CANDIDATE_ONLY', publicationVerified: false, products: [] })
  assert.equal(projectPublicResearchCatalog().status, 'PUBLICATION_SOURCE_UNAVAILABLE')
})

test('candidate and former detail bypass cannot render published metadata in the actual components', t => {
  const result = projectResearchCatalogCandidate([fixture({
    name: 'CANDIDATE_NAME_NOT_PUBLIC', description: 'CANDIDATE_DESCRIPTION_NOT_PUBLIC',
    availability: { manual: 'available', automated: 'available', probability: 'available' },
  })])
  const candidate = result.products[0]
  assert.equal(candidate.catalog, undefined)
  assert.equal(candidate.detail, undefined)
  assert.doesNotMatch(JSON.stringify(result), /"publication":|"catalog":|"detail":/)
  for (const value of [candidate, result, candidate.suppliedAvailability, candidate.detail]) {
    const html = renderToStaticMarkup(createElement(PaidResearchProductDetail, { product: value }))
    assert.match(html, /Chưa có thông tin sản phẩm công bố/)
    assert.doesNotMatch(html, /CANDIDATE_NAME_NOT_PUBLIC|CANDIDATE_DESCRIPTION_NOT_PUBLIC|Thông tin giới thiệu đã công bố|Đã sẵn sàng cung cấp/)
  }
  const stateHTML = renderToStaticMarkup(createElement(PaidResearchCatalogSection, { state: result }))
  assert.match(stateHTML, /Chưa có dữ liệu công bố/)
  // Force an unsupported JS call to test metadata non-disclosure too. The
  // existing catalogue does not validate malformed list items; TypeScript below
  // prevents assigning this candidate as a list DTO. No source UI change here.
  const warnings = []
  const error = t.mock.method(console, 'error', (...args) => warnings.push(args.map(String).join(' ')))
  let forcedListHTML
  try {
    forcedListHTML = renderToStaticMarkup(createElement(PaidResearchCatalogSection, {
      state: { status: 'ready', products: [candidate] },
    }))
  } finally {
    error.mock.restore()
  }
  // A forced malformed list item has no React key; do not hide other warnings.
  assert.ok(warnings.every(message => message.includes('unique "key" prop')))
  for (const html of [stateHTML, forcedListHTML]) {
    assert.doesNotMatch(html, /CANDIDATE_NAME_NOT_PUBLIC|CANDIDATE_DESCRIPTION_NOT_PUBLIC|fixture-only-a/)
  }
  assert.deepEqual(projectPublicResearchCatalog(candidate), { status: 'PUBLICATION_SOURCE_UNAVAILABLE', products: [] })
})

test('TypeScript rejects declared and inferred candidates as either public presentation DTO', () => {
  // Compile a virtual test module against the real source types without creating
  // a fourth task file. Unused @ts-expect-error directives make this test fail if
  // a future candidate becomes assignable to either presentation DTO.
  const configPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url))
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  assert.equal(config.error, undefined)
  const basePath = fileURLToPath(new URL('../', import.meta.url))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, basePath)
  assert.deepEqual(parsed.errors, [])
  const virtualPath = fileURLToPath(new URL('catalog-candidate-type-regression.virtual.ts', import.meta.url))
  const source = `
    import type { ResearchCatalogCandidateProduct } from '../src/features/landing/public-research-catalog-contract'
    import { projectResearchCatalogCandidate } from '../src/features/landing/public-research-catalog-projection'
    import type { PublicResearchProduct } from '../src/features/landing/components/PaidResearchCatalogSection'
    import type { PublicResearchProductDetailDTO } from '../src/features/landing/components/PaidResearchProductDetail'
    type Inferred = Extract<ReturnType<typeof projectResearchCatalogCandidate>, { status: 'CANDIDATE_ONLY' }>['products'][number]
    declare const declared: ResearchCatalogCandidateProduct
    declare const inferred: Inferred
    // Positive controls: resolve real DTOs and the inferred candidate shape.
    const sameCandidate: ResearchCatalogCandidateProduct = inferred
    const publicList: PublicResearchProduct = { id: 'fixture-only', name: 'Fixture', description: 'Fixture' }
    const publicDetail: PublicResearchProductDetailDTO = { publication: 'published', kind: 'gold', name: 'Fixture', description: 'Fixture' }
    // @ts-expect-error Candidate is not a public list DTO.
    const badList: PublicResearchProduct = declared
    // @ts-expect-error Candidate is not a published detail DTO.
    const badDetail: PublicResearchProductDetailDTO = declared
    // @ts-expect-error Actual inferred output also cannot enter the list.
    const badInferredList: PublicResearchProduct = inferred
    // @ts-expect-error Actual inferred output also cannot enter detail.
    const badInferredDetail: PublicResearchProductDetailDTO = inferred
    // @ts-expect-error Old nested presentation-ready escape hatch is absent.
    const oldList: PublicResearchProduct = inferred.catalog
    // @ts-expect-error Old published detail escape hatch is absent.
    const oldDetail: PublicResearchProductDetailDTO = inferred.detail
  `
  const options = { ...parsed.options, noEmit: true, incremental: false }
  const host = ts.createCompilerHost(options)
  const originalRead = host.readFile.bind(host)
  const originalExists = host.fileExists.bind(host)
  const normalize = value => value.replaceAll('\\', '/').toLowerCase()
  host.readFile = file => normalize(file) === normalize(virtualPath) ? source : originalRead(file)
  host.fileExists = file => normalize(file) === normalize(virtualPath) || originalExists(file)
  const program = ts.createProgram([virtualPath], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => basePath, getNewLine: () => '\n',
  }))
})

test('availability is copied only when explicitly supplied, with no readiness inference', () => {
  for (const value of ['available', 'not_ready', 'unconfirmed']) {
    const result = projectResearchCatalogCandidate([fixture({ availability: { manual: value } })])
    assert.equal(result.products[0].suppliedAvailability.manual, value)
    assert.equal(result.products[0].suppliedAvailability.automated, 'unconfirmed')
    assert.equal(result.products[0].suppliedAvailability.probability, 'unconfirmed')
    assert.equal(result.publicationVerified, false)
  }
  for (const availability of [null, true, [], { manual: true }, { automated: 'live' }, { probability: 'approved' }]) {
    invalid([fixture({ availability })])
  }
})

test('projection allowlists data fields and preserves plain text without encoding it as HTML', () => {
  const name = '<script>alert("fixture")</script>'
  const description = '<img src=x onerror=alert(1)> & nghiên cứu'
  const result = projectResearchCatalogCandidate([fixture({
    name, description, price: 'PRIVATE_PRICE', slug: 'PRIVATE_SLUG', ProductPlan: 'PRIVATE_PLAN',
    internalNotes: 'PRIVATE_NOTES', checkout: 'javascript:alert(1)', entitlement: 'PRIVATE_ACCESS',
    availability: { manual: 'unconfirmed', privateSource: 'PRIVATE_SOURCE' },
  })])
  assert.equal(result.products[0].suppliedName, name)
  assert.equal(result.products[0].suppliedDescription, description)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|javascript:|&lt;script/)
  // Facts need a future explicit, authorized conversion; no HTML/href is emitted.
  assert.equal(result.publicationVerified, false)
})

test('unknown, draft, retired or malformed records invalidate the whole snapshot with no partial leak', () => {
  for (const patch of [
    { publication: 'draft' }, { publication: 'retired' }, { publication: undefined },
    { kind: 'constructor' }, { kind: 'unknown' }, { kind: undefined },
    { id: '' }, { id: ' padded ' }, { id: 7 }, { id: 'space id' }, { id: 'line\nid' },
    { name: '' }, { name: '  ' }, { name: null }, { description: '' }, { description: false },
    { name: '\u0000PRIVATE' }, { description: '\u007FPRIVATE' },
  ]) invalid([fixture({ id: 'valid-before-invalid', name: 'PRIVATE_VALID' }), fixture(patch)])
  for (const input of [null, undefined, {}, '[]', true, 42]) invalid(input)
})

test('duplicate supplied identities fail the entire snapshot; no deduplication or renaming', () => {
  invalid([fixture(), fixture({ name: 'Different metadata', kind: 'gold' })])
  invalid([fixture(), fixture()])
})

test('plain own properties are required; getters and inherited metadata do not execute or pass', () => {
  let reads = 0
  const getterRecord = fixture()
  Object.defineProperty(getterRecord, 'name', { get() { reads++; return 'PRIVATE' } })
  invalid([getterRecord])
  invalid([Object.create(fixture())])
  invalid([new Date()])
  const array = []
  Object.defineProperty(array, '0', { get() { reads++; return fixture() } })
  invalid(array)
  invalid(new Array(1))
  assert.equal(reads, 0)
  const plain = Object.assign(Object.create(null), fixture())
  assert.equal(projectResearchCatalogCandidate([plain]).status, 'CANDIDATE_ONLY')
})

test('proxy failures return a generic invalid result without leaking exceptions', () => {
  const proxy = new Proxy({}, { getPrototypeOf() { throw Error('PRIVATE_BACKEND_DETAILS') } })
  invalid([proxy])
  const revoked = Proxy.revocable([], {})
  revoked.revoke()
  invalid(revoked.proxy)
})

test('array length uses a descriptor without get traps; other Proxy reflection traps remain possible', () => {
  let gets = 0
  let descriptors = 0
  const array = new Proxy([fixture()], {
    get() { gets++; throw Error('get trap must not be used') },
    getOwnPropertyDescriptor(target, key) {
      descriptors++
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  assert.equal(projectResearchCatalogCandidate(array).status, 'CANDIDATE_ONLY')
  assert.equal(gets, 0)
  assert.ok(descriptors > 0)
  invalid(new Proxy([], { getOwnPropertyDescriptor() { throw Error('PRIVATE_DESCRIPTOR_ERROR') } }))
})

test('technical payload limits reject oversize data and permit boundary sizes', () => {
  for (const key of ['id', 'name', 'description']) {
    assert.equal(projectResearchCatalogCandidate([fixture({ [key]: 'a'.repeat(limits[key]) })]).status, 'CANDIDATE_ONLY')
    invalid([fixture({ [key]: 'a'.repeat(limits[key] + 1) })])
  }
  const input = Array.from({ length: limits.products }, (_, i) => fixture({ id: 'fixture-only-' + i }))
  assert.equal(projectResearchCatalogCandidate(input).products.length, limits.products)
  invalid([...input, fixture({ id: 'fixture-over-limit' })])
})

test('output is detached and frozen; input is unchanged and cannot alter a projected snapshot', () => {
  const item = fixture({ availability: { manual: 'not_ready' } })
  const input = [item]
  const original = JSON.stringify(input)
  const result = projectResearchCatalogCandidate(input)
  assert.equal(JSON.stringify(input), original)
  item.name = 'CHANGED'
  item.availability.manual = 'available'
  input.push(fixture())
  assert.equal(result.products.length, 1)
  assert.equal(result.products[0].suppliedName, 'Mẫu kiểm thử')
  assert.equal(result.products[0].suppliedAvailability.manual, 'not_ready')
  for (const value of [result, result.products, result.products[0], result.products[0].suppliedAvailability]) {
    assert.ok(Object.isFrozen(value))
  }
})

test('projection runtime imports are local contract and server-only, with no producer or I/O', () => {
  const source = readFileSync(projectionURL, 'utf8')
  const ast = ts.createSourceFile('projection.ts', source, ts.ScriptTarget.Latest, true)
  const imports = ast.statements.filter(ts.isImportDeclaration)
    .filter(node => !node.importClause?.isTypeOnly).map(node => node.moduleSpecifier.text)
  assert.deepEqual(imports, ['server-only', './public-research-catalog-contract'])
  assert.doesNotMatch(source, /fetch\(|process\.env|prisma\.|dangerouslySetInnerHTML/)
  const contract = ts.createSourceFile('contract.ts', readFileSync(contractURL, 'utf8'), ts.ScriptTarget.Latest, true)
  assert.equal(contract.statements.filter(ts.isImportDeclaration).length, 0)
})
