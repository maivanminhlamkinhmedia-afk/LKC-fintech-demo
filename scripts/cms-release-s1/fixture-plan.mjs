// Pure disposable-fixture plans. No connection, credentials, environment or execution.
// Only the separately authorized run.mjs executor may consume these instructions.
export const SOURCE_SHA = '61c5591bb875bffaeb3d71d2f734d39d1e87faf7';
export const BASELINE_SHA = '5e6b14f006453da7f9b1554c210e9ad85a9f8c0c';
export const REPOSITORY = 'maivanminhlamkinhmedia-afk/LKC-fintech-demo';
export const SCHEMA_SHA256 = 'd2c6d315d0ccd7a17cc0598af5d5e57ad61465a1aa7e7e993e789cb1f0341e8d';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export const MIGRATIONS = freeze([
  { name: '20260910081136_rbac_client_sales_creator', gitBlob: 'e43fea064fbaf7c7b1a30cf363604cedb59fa40c', lfSha256: '847df4b90da61ca65af95aef5771c2aeb04dd525a88cc5cc341a0c6b5d2b0d62', crlfSha256: 'f40c1bae5bbf7f78e08bf1295e6b3788f452d473529ee883ba53ee56011e3cef' },
  { name: '20260910105507_phase2_customer_crm', gitBlob: '9bd8f4af8f329b4d60763580849c900326cb919f', lfSha256: '4a0b91e3e2c833119cb9eb24a010b10241cd1f1d717e2ffcf17ebc109fb2a49a', crlfSha256: 'ab159fd957ed707647a21496e93e7f50c2dee6a8e222ea5b3721e5e683415b1a' },
  { name: '20260914050000_sales_team_member_user_unique', gitBlob: '5dd6fc44189430452a6bb4c1aa3dcc072edc5f91', lfSha256: '7a8397a8074623db51d42b8a42e480ee14ebbae898d8f4e6e2b741afd2f24455', crlfSha256: '5ffaeb9c0ab190855c8e9954d8a1eaef0e3ad1becf77148302ec0c2a2aeb3956' },
  { name: '20260921130000_cms_financial_publishing', gitBlob: '9397929f294b8ce3fcd3ea64da648b27ca29fc7b', lfSha256: '1809a1dc433bcc45115cee083b7a0c7b9cd572f99f0230160f45b5330d713f99', crlfSha256: 'f9aa96083f45da1af14f4dda89f0842f2a0471e65bf5fbc2c31e74a6e0402d14' },
  { name: '20261008155242_cms011_review_foundation', gitBlob: '680896796c2af30a9e40d48489828118539cd643', lfSha256: '707a93671041e42d0e80f9b60f0840731e38ffb5418654b9131ed011108294be', crlfSha256: '7362d5b04298085bf068f2c6d2f597fc3db058eac47e09636cfedeabca222789' },
  { name: '20261009003458_product_catalog_foundation', gitBlob: '75602de8902f52219c10e486022b13a1cf8c173e', lfSha256: '17b65882d802c5b2e413b127d7cbc5574551dd464d5e61d71a6e03bd7e77d86f', crlfSha256: 'cd209e3d74482db87f7bc23bfc889a6593e03b88e27c20b6d17d6796e84abacd' },
  { name: '20261009190000_cms_article_audience', gitBlob: 'd359f5451527dadc8d136fa6b2d3ac61ffa9b41e', lfSha256: '7dffdce01ccbe965b1d10d8fd34003f3fb765e84f87e50f8a2e7359a7bb7d23c', crlfSha256: '89c77a05e42a22454dd658fdd65fd207cf7c1c17e67872c1f38b156eefc13a31' },
]);

export const PHASES = freeze([
  'VERIFY_IMMUTABLE_INPUTS', 'VERIFY_DISPOSABLE_RESOURCE', 'MEASURE_CONFIGURATION',
  'BASELINE_LF', 'BASELINE_HISTORICAL_EOL', 'SEED_LEGACY_WITH_OLD_CLIENT',
  'APPLY_FOUNDATION_PRODUCT_AUDIENCE', 'VERIFY_LEGACY_PRESERVATION',
  'VERIFY_EXPANDED_CONSTRAINTS', 'MIXED_CLIENTS', 'SERIALIZABLE_CAS',
  'TIMESTAMP_KEYSET', 'PARTIAL_DDL_FAILURE', 'FRESH_RECOVERY_COMPARISON',
  'SANITIZED_EVIDENCE',
]);
export const FIXTURE_TIME = '2026-01-01T00:00:00.123Z';
export const NEXT_FIXTURE_TIME = '2026-01-01T00:00:00.124Z';
const ID_SUFFIXES = freeze({
  author: 'author', reviewer: 'reviewer', articleA: 'articlea', articleB: 'articleb',
  casArticle: 'cas', versionA: 'versiona', versionB: 'versionb', versionNew: 'versionnew',
  legacyReview: 'legacyreview', reviewNew: 'reviewnew', event: 'event',
  category: 'category', topic: 'topic', tag: 'tag', instrument: 'instrument',
  media: 'media', product: 'product',
});

export function makeFixtureIds(runId) {
  if (typeof runId !== 'string' || !/^[a-z0-9]{8,24}$/.test(runId)) {
    throw new Error('S1_INVALID_FIXTURE_RUN_ID');
  }
  const namespace = `s1_${runId}`;
  return freeze({ runId, namespace, ...Object.fromEntries(
    Object.entries(ID_SUFFIXES).map(([key, suffix]) => [key, `${namespace}_${suffix}`]),
  ) });
}

function ownIds(input) {
  try {
    if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) throw 0;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const runId = descriptors.runId?.value;
    const expected = makeFixtureIds(runId);
    if (Reflect.ownKeys(descriptors).length !== Object.keys(expected).length) throw 0;
    for (const [key, value] of Object.entries(expected)) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.value !== value) throw 0;
    }
    return expected;
  } catch {
    throw new Error('S1_INVALID_FIXTURE_IDENTITY');
  }
}

function operation(id, delegate, method, args, expect = 'SUCCESS') {
  return freeze({ id, delegate, method, args, expect });
}
function create(id, delegate, data, expect = 'SUCCESS') {
  return operation(id, delegate, 'create', { data }, expect);
}
function document() {
  return { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Synthetic S1 fixture. No customer data.' },
  ] }] };
}
function article(ids, id) {
  return {
    id, title: 'Synthetic S1 article', slug: id, excerpt: 'Synthetic excerpt',
    contentJson: document(), contentText: 'Synthetic S1 fixture. No customer data.',
    editorSchemaVersion: 1, articleType: 'NEWS', status: 'DRAFT', authorId: ids.author,
    editorId: null, categoryId: null, coverMediaId: null, seoTitle: null,
    seoDescription: null, featured: false, submittedAt: null, approvedAt: null,
    scheduledAt: null, publishedAt: null, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
  };
}
function legacyVersion(ids, id, articleId) {
  return {
    id, articleId, versionNumber: 1, title: 'Synthetic legacy version',
    excerpt: 'Synthetic legacy excerpt', contentJson: document(),
    contentText: 'Synthetic S1 fixture. No customer data.', editorSchemaVersion: 1,
    createdById: ids.author, changeSummary: null, createdAt: FIXTURE_TIME,
  };
}

// Valid for the four-migration schema: intentionally omits every expanded field.
export function legacyPlan(input) {
  const ids = ownIds(input);
  const user = (id, role) => ({
    id, email: `${id}@example.invalid`, name: 'Synthetic S1', password: '!S1_DISABLED_LOGIN!',
    role, status: 'ACTIVE', createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
  });
  return freeze([
    create('legacy-author', 'user', user(ids.author, 'CREATOR')),
    create('legacy-reviewer', 'user', user(ids.reviewer, 'ADMIN')),
    create('legacy-category', 'articleCategory', {
      id: ids.category, name: 'Synthetic category', slug: ids.category,
      createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    }),
    create('legacy-topic', 'articleTopic', {
      id: ids.topic, name: 'Synthetic topic', slug: ids.topic,
      createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    }),
    create('legacy-tag', 'articleTag', {
      id: ids.tag, name: 'Synthetic tag', slug: ids.tag,
      createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    }),
    create('legacy-instrument', 'financialInstrument', {
      id: ids.instrument, canonicalKey: ids.instrument, name: 'Synthetic instrument',
      symbol: 'S1', instrumentType: 'OTHER', createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    }),
    create('legacy-media', 'mediaAsset', {
      id: ids.media, filename: `${ids.media}.png`, originalFilename: 'synthetic.png',
      url: `synthetic:${ids.media}`, mimeType: 'image/png', sizeBytes: 1,
      width: 1, height: 1, uploadedById: ids.author, altText: null, caption: null,
      createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    }),
    create('legacy-article-a', 'article', article(ids, ids.articleA)),
    create('legacy-article-b', 'article', article(ids, ids.articleB)),
    create('legacy-cas-article', 'article', article(ids, ids.casArticle)),
    create('legacy-version-a', 'articleVersion', legacyVersion(ids, ids.versionA, ids.articleA)),
    create('legacy-version-b', 'articleVersion', legacyVersion(ids, ids.versionB, ids.articleB)),
    create('legacy-review', 'articleReview', {
      id: ids.legacyReview, articleId: ids.articleA, reviewerId: ids.reviewer,
      decision: 'COMMENT', comment: 'Synthetic legacy review', fromStatus: null,
      toStatus: null, createdAt: FIXTURE_TIME,
    }),
  ]);
}

function capturedEdges(ids) {
  const binding = { articleId: ids.articleA, versionId: ids.versionNew };
  return [
    ['category', 'articleVersionCategory', { ...binding, categoryId: ids.category, nameAtCapture: 'Synthetic category' }],
    ['topic', 'articleVersionTopic', { ...binding, topicId: ids.topic, nameAtCapture: 'Synthetic topic' }],
    ['tag', 'articleVersionTag', { ...binding, tagId: ids.tag, nameAtCapture: 'Synthetic tag' }],
    ['instrument', 'articleVersionInstrument', { ...binding, instrumentId: ids.instrument, nameAtCapture: 'Synthetic instrument', symbolAtCapture: 'S1', isPrimary: true }],
    ['source', 'articleVersionSource', { ...binding, position: 0, sourceIdAtCapture: `${ids.namespace}_source`, sourceType: 'OTHER', title: 'Synthetic source', publisher: null, url: null, publishedAt: null, accessedAt: null, dataTimestamp: null }],
    ['disclosure', 'articleVersionDisclosure', { ...binding, position: 0, disclosureIdAtCapture: `${ids.namespace}_disclosure`, statement: 'Synthetic disclosure', conflictType: null }],
    ['media', 'articleVersionMedia', { ...binding, assetId: ids.media, context: 'COVER', altTextAtCapture: null, captionAtCapture: 'Synthetic captured caption' }],
    ['product', 'articleVersionProduct', { ...binding, productId: ids.product }],
  ];
}

// DB-only fixtures exercise constraints; this is not application workflow activation.
export function expandedPlan(input) {
  const ids = ownIds(input);
  return freeze([
    create('expanded-product', 'product', {
      id: ids.product, name: 'Synthetic S1 Product', contentState: 'SELECTABLE', saleStopped: true,
      createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    }),
    create('expanded-version', 'articleVersion', {
      ...legacyVersion(ids, ids.versionNew, ids.articleA), versionNumber: 2,
      snapshotFormatVersion: 1, basisUpdatedAt: FIXTURE_TIME, accessMode: 'PAID_PRODUCT',
      slug: ids.articleA, articleType: 'NEWS', seoTitle: null, seoDescription: null, featured: false,
    }),
    ...capturedEdges(ids).map(([name, delegate, data]) => create(`expanded-${name}`, delegate, data)),
    create('expanded-working-product', 'articleProduct', { articleId: ids.articleA, productId: ids.product }),
    create('expanded-review', 'articleReview', {
      id: ids.reviewNew, articleId: ids.articleA, versionId: ids.versionNew,
      reviewerId: ids.reviewer, decision: 'COMMENT', comment: 'Synthetic version-bound review',
      fromStatus: 'DRAFT', toStatus: 'SUBMITTED', createdAt: FIXTURE_TIME,
    }),
    create('expanded-event', 'articleReviewEvent', {
      id: ids.event, articleId: ids.articleA, versionId: ids.versionNew, actorId: ids.author,
      action: 'SUBMIT', fromStatus: 'DRAFT', toStatus: 'SUBMITTED',
      operationId: `${ids.namespace}_operation`, occurredAt: FIXTURE_TIME,
    }),
    operation('expanded-pointers', 'article', 'update', {
      where: { id: ids.articleA }, data: {
        accessMode: 'PAID_PRODUCT', activeReviewVersionId: ids.versionNew,
        activeApprovalVersionId: ids.versionNew, updatedAt: FIXTURE_TIME,
      },
    }),
  ]);
}

export function constraintCases(input) {
  const ids = ownIds(input);
  const cases = [];
  for (const [name, delegate, data] of capturedEdges(ids)) {
    cases.push(create(`unique-${name}`, delegate, { ...data }, 'P2002'));
    // Use the other Article's existing legacy version, so no existing PK can
    // conceal a broken same-Article FK behind a duplicate-key rejection.
    cases.push(create(`cross-article-${name}`, delegate, {
      ...data, articleId: ids.articleA, versionId: ids.versionB,
    }, 'P2003'));
  }
  cases.push(create('unique-article-version-number', 'articleVersion', {
    ...legacyVersion(ids, `${ids.namespace}_duplicateversion`, ids.articleA),
  }, 'P2002'));
  cases.push(create('unknown-version-product', 'articleVersionProduct', {
    articleId: ids.articleB, versionId: ids.versionB,
    productId: `${ids.namespace}_missingproduct`,
  }, 'P2003'));
  cases.push(create('unique-working-product', 'articleProduct', {
    articleId: ids.articleA, productId: ids.product,
  }, 'P2002'));
  cases.push(create('unknown-working-product', 'articleProduct', {
    articleId: ids.articleB, productId: `${ids.namespace}_missingproduct`,
  }, 'P2003'));
  cases.push(create('cross-article-review', 'articleReview', {
    id: `${ids.namespace}_badreview`, articleId: ids.articleA, versionId: ids.versionB,
    reviewerId: ids.reviewer, decision: 'COMMENT', createdAt: FIXTURE_TIME,
  }, 'P2003'));
  cases.push(create('cross-article-event', 'articleReviewEvent', {
    id: `${ids.namespace}_badevent`, articleId: ids.articleA, versionId: ids.versionB,
    actorId: ids.author, action: 'SUBMIT', fromStatus: 'DRAFT', toStatus: 'SUBMITTED',
    operationId: `${ids.namespace}_badoperation`, occurredAt: FIXTURE_TIME,
  }, 'P2003'));
  cases.push(create('duplicate-event-operation', 'articleReviewEvent', {
    id: `${ids.namespace}_duplicateevent`, articleId: ids.articleA, versionId: ids.versionNew,
    actorId: ids.author, action: 'SUBMIT', fromStatus: 'DRAFT', toStatus: 'SUBMITTED',
    operationId: `${ids.namespace}_operation`, occurredAt: FIXTURE_TIME,
  }, 'P2002'));
  for (const field of ['activeReviewVersionId', 'activeApprovalVersionId']) {
    cases.push(operation(`cross-article-${field}`, 'article', 'update', {
      where: { id: ids.articleA }, data: { [field]: ids.versionB, updatedAt: FIXTURE_TIME },
    }, 'P2003'));
  }
  for (const [name, delegate, id] of [
    ['version', 'articleVersion', ids.versionNew], ['article', 'article', ids.articleA],
    ['product', 'product', ids.product], ['media', 'mediaAsset', ids.media],
    ['category', 'articleCategory', ids.category], ['topic', 'articleTopic', ids.topic],
    ['tag', 'articleTag', ids.tag], ['instrument', 'financialInstrument', ids.instrument],
  ]) {
    cases.push(operation(`restrict-delete-${name}`, delegate, 'delete', { where: { id } }, 'P2003'));
    cases.push(operation(`restrict-update-${name}`, delegate, 'update', {
      where: { id }, data: { id: `${id}_rekey` },
    }, 'P2003'));
  }
  cases.push(create('nullable-review-version', 'articleReview', {
    id: `${ids.namespace}_nullreview`, articleId: ids.articleB, versionId: null,
    reviewerId: ids.reviewer, decision: 'COMMENT', createdAt: FIXTURE_TIME,
  }));
  cases.push(operation('nullable-article-pointers', 'article', 'update', {
    where: { id: ids.articleB }, data: {
      activeReviewVersionId: null, activeApprovalVersionId: null, accessMode: null,
      updatedAt: FIXTURE_TIME,
    },
  }));
  return freeze(cases);
}

export function keysetPlan(input, count = 53) {
  const ids = ownIds(input);
  if (!Number.isInteger(count) || count < 3 || count > 53) throw new Error('S1_INVALID_KEYSET_COUNT');
  return freeze(Array.from({ length: count }, (_, index) => {
    const id = `${ids.namespace}_page${String(index).padStart(3, '0')}`;
    return create(`keyset-${index}`, 'article', {
      ...article(ids, id), status: 'SUBMITTED', accessMode: 'PUBLIC',
      // Three rows per timestamp force the secondary ID key to be exercised.
      submittedAt: `2026-01-01T00:00:00.${String(123 + Math.floor(index / 3)).padStart(3, '0')}Z`,
    });
  }));
}

export function readLegacySpec(input) {
  const ids = ownIds(input);
  const fields = (keys) => Object.fromEntries(keys.map((key) => [key, true]));
  return freeze({
    articles: {
      where: { id: { in: [ids.articleA, ids.articleB, ids.casArticle] } }, orderBy: { id: 'asc' },
      select: fields(['id', 'title', 'slug', 'excerpt', 'contentJson', 'contentText',
        'editorSchemaVersion', 'articleType', 'status', 'authorId', 'editorId', 'categoryId',
        'coverMediaId', 'seoTitle', 'seoDescription', 'featured', 'submittedAt', 'approvedAt',
        'scheduledAt', 'publishedAt', 'createdAt', 'updatedAt']),
    },
    versions: {
      where: { id: { in: [ids.versionA, ids.versionB] } }, orderBy: { id: 'asc' },
      select: fields(['id', 'articleId', 'versionNumber', 'title', 'excerpt', 'contentJson',
        'contentText', 'editorSchemaVersion', 'createdById', 'changeSummary', 'createdAt']),
    },
    reviews: {
      where: { id: ids.legacyReview }, orderBy: { id: 'asc' },
      select: fields(['id', 'articleId', 'reviewerId', 'decision', 'comment', 'fromStatus', 'toStatus', 'createdAt']),
    },
  });
}

// Normalization is for equality checks only, never a replacement for raw-byte provenance.
export function normalizedLegacySnapshot(snapshot) {
  const seen = new WeakSet();
  function visit(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    if (!value || typeof value !== 'object' || seen.has(value)) throw 0;
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      result = value.map(visit);
    } else {
      if (Object.getPrototypeOf(value) !== Object.prototype) throw 0;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      result = {};
      for (const key of Object.keys(descriptors).sort()) {
        const descriptor = descriptors[key];
        if (!Object.hasOwn(descriptor, 'value')) throw 0;
        result[key] = visit(descriptor.value);
      }
    }
    seen.delete(value);
    return result;
  }
  try { return freeze(visit(snapshot)); } catch { throw new Error('S1_INVALID_LEGACY_SNAPSHOT'); }
}
