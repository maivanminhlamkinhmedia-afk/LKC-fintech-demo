// Pure plans only. W0 identity is NEVER inferred from the reusable Q1 constants.
export const SOURCE_SHA = '5321f28673eeee11ed8f913c78c7cdcb38896f9e';
export const HARNESS_SHA = 'f4c8fda177a81f96e13a05fa8a856128371835ad';
export const BASELINE_SHA = '5e6b14f006453da7f9b1554c210e9ad85a9f8c0c';
export const REPOSITORY = 'maivanminhlamkinhmedia-afk/LKC-fintech-demo';
export const HEAD_BRANCH = 'test/cms-w0-mariadb-validation';
export const BASE_BRANCH = 'feature/cms-access-001a-draft-writer-foundation';
export const SCHEMA_BLOB = '2ac6b2c9688ddac6dcd20f1c0ec9f47007314858';
export const REUSE_BLOBS = Object.freeze({
  'scripts/cms-release-s1/fixture-plan.mjs': '212a80b44fc33cccfbaaf5f083eb1394cce97eda',
  'scripts/cms-release-s1/metadata.mjs': 'd9f83e1e18b077271a237b3d2200ee0e1f35538a',
  'scripts/cms-release-s1/run.mjs': 'e9726058e9a88530cb9f601bb484adc2450497cb',
});
export const VARIANTS = Object.freeze(['lf', 'crlf', 'fault', 'recovery']);
export const MIGRATION_NAMES = Object.freeze([
  '20260910081136_rbac_client_sales_creator', '20260910105507_phase2_customer_crm',
  '20260914050000_sales_team_member_user_unique', '20260921130000_cms_financial_publishing',
  '20261008155242_cms011_review_foundation', '20261009003458_product_catalog_foundation',
  '20261009190000_cms_article_audience',
]);
export const CASE_IDS = Object.freeze([
  'BASELINE', 'MIGRATION', 'LEGACY', 'MIXED_CLIENT', 'SAVE_NULL_PUBLIC', 'OMITTED_AUDIENCE',
  'STALE_CAS', 'SERIALIZABLE', 'CONCURRENT_ACTIONS', 'ROLLBACK', 'LOST_ACK',
  'PAID_DENIED', 'INCONSISTENT_DENIED', 'ACTOR_SCOPE', 'POINTERS_HISTORY', 'CONSTRAINTS',
  'FINAL_SCHEMA', 'FINAL_HISTORY', 'PARTIAL_DDL', 'RECOVERY',
]);
export function databaseName(nonce, variant) {
  if (!/^[a-f0-9]{22}$/.test(nonce) || !VARIANTS.includes(variant)) throw new Error('W0_IDENTITY_REFUSED');
  // The prefix is required by the unchanged S1 metadata helper. Manifest purpose is W0.
  return `s1_${nonce}_${variant}`;
}
export function migrationPlan(migrations, variant, count) {
  if (!VARIANTS.includes(variant) || ![4, 7].includes(count)
      || !Array.isArray(migrations) || migrations.length !== 7) throw new Error('W0_MIGRATIONS_REFUSED');
  return migrations.map((m, i) => {
    if (m.name !== MIGRATION_NAMES[i] || !/^[a-f0-9]{40}$/.test(m.gitBlob)
        || !/^[a-f0-9]{64}$/.test(m.lfSha256) || !/^[a-f0-9]{64}$/.test(m.crlfSha256)) throw new Error('W0_MIGRATIONS_REFUSED');
    const crlf = variant === 'crlf' && i < 3;
    return Object.freeze({ name: m.name, gitBlob: m.gitBlob, sha256: crlf ? m.crlfSha256 : m.lfSha256, eol: crlf ? 'CRLF' : 'LF' });
  }).slice(0, count);
}
// W0 action canonicalizes slugs. Derive canonical synthetic slugs BEFORE the
// legacy baseline snapshot so a later no-op does not accidentally edit the slug.
// Immutable S1 plans and all other legacy fields are preserved.
export function legacyOperations(plan) {
  return plan.map(op => op.delegate === 'article' && op.method === 'create'
    ? { ...op, args: { ...op.args, data: { ...op.args.data, slug: op.args.data.slug.replaceAll('_', '-') } } }
    : op);
}
export const document = () => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic W0 content' }] }] });
export function draftInput(slug, audience) {
  const value = { title: 'Synthetic W0 draft', slug, excerpt: '', articleType: 'NEWS', contentJson: document() };
  if (audience !== undefined) value.audience = { accessMode: audience, productIds: [] };
  return value;
}
export function updateInput(row, audience) {
  return { ...draftInput(row.slug, audience), title: row.title, excerpt: row.excerpt,
    articleType: row.articleType, contentJson: structuredClone(row.contentJson), expectedUpdatedAt: row.updatedAt.toISOString() };
}
export function expectedRuntimeCases() {
  return VARIANTS.flatMap(v => (v === 'fault'
    ? ['BASELINE', 'PARTIAL_DDL', 'FINAL_HISTORY']
    : CASE_IDS.filter(c => c !== 'PARTIAL_DDL' && (c !== 'RECOVERY' || v === 'recovery')))
    .map(c => `${v}:${c}`));
}
// Planning only: never calls DROP or DELETE. Failed/unknown outcomes prohibit SQL cleanup.
export function cleanupPlan({ nonce, database, variant, owned, outcome, activeConnections }) {
  if (database !== databaseName(nonce, variant) || owned !== true
      || !Number.isSafeInteger(activeConnections) || activeConnections < 0) throw new Error('W0_CLEANUP_REFUSED');
  if (outcome !== 'KNOWN_COMPLETE' || activeConnections !== 0) return Object.freeze({ action: 'PRESERVE', database });
  return Object.freeze({ action: 'RUNNER_SERVICE_DISPOSAL_ONLY', database });
}
