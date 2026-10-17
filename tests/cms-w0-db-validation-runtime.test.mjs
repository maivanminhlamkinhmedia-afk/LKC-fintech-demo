// Runtime matrix is an exported function, NOT registered by node --test discovery.
// Only the locked runner can mint the permit. Importing this file does no DB work.
import assert from 'node:assert/strict';
import { assertRuntimePermit } from '../scripts/cms-w0-db-validation/run.mjs';
import { createBarrier } from '../scripts/cms-w0-db-validation/action-bridge.mjs';
import { draftInput, updateInput } from '../scripts/cms-w0-db-validation/fixture-plan.mjs';
import { sha256 } from '../scripts/cms-w0-db-validation/evidence.mjs';
const fingerprint = v => sha256(JSON.stringify(v));
function error(result, code) {
  assert.equal(result.ok, false); assert.equal(result.error.code, code);
  assert.deepEqual(Object.keys(result).sort(), ['error', 'ok']);
  assert.ok(Object.keys(result.error).every(k => ['code', 'message', 'fieldErrors'].includes(k)));
  assert.ok(!JSON.stringify(result).includes('W0_INJECTED'));
}
async function expectedPrisma(fn, code) {
  let caught; try { await fn(); } catch (e) { caught = e; }
  assert.equal(caught?.code, code);
}
export async function runW0RuntimeCases(c) {
  assertRuntimePermit(c.permit);
  const { client, second, old, ddl, ids, reuse, bridge, record } = c;
  const session = { user: { id: ids.author, role: 'CREATOR' } };
  const admin = { user: { id: ids.reviewer, role: 'ADMIN' } };
  const get = id => client.article.findUniqueOrThrow({ where: { id } });
  const invoke = (op, args, controls = {}, actor = session, db = client) => bridge.invoke(db, actor, op, args, controls);
  async function pass(id, fn) {
    try { const value = await fn(); record(id, 'PASS', 'OK', fingerprint(value ?? { verified: true })); }
    catch { record(id, 'FAIL', 'W0_ASSERTION_FAILED', fingerprint({ verified: false })); throw new Error('W0_MATRIX_FAILED'); }
  }
  await pass('LEGACY', async () => {
    const version = await client.articleVersion.findUniqueOrThrow({ where: { id: ids.versionA } });
    assert.equal(version.snapshotFormatVersion, null); assert.equal(version.basisUpdatedAt, null);
    assert.equal(version.accessMode, null);
    assert.equal((await get(ids.articleA)).accessMode, null);
    assert.equal((await client.articleReview.findUniqueOrThrow({ where: { id: ids.legacyReview } })).versionId, null);
  });
  await pass('MIXED_CLIENT', async () => {
    await old.article.update({ where: { id: ids.articleB }, data: { title: 'Synthetic old client' } });
    assert.equal((await get(ids.articleB)).title, 'Synthetic old client');
    await client.article.update({ where: { id: ids.articleB }, data: { accessMode: 'PUBLIC', title: 'Synthetic new client' } });
    assert.equal((await old.article.findUniqueOrThrow({ where: { id: ids.articleB } })).title, 'Synthetic new client');
    await old.article.update({ where: { id: ids.articleB }, data: { excerpt: 'Old client preserves new column' } });
    assert.equal((await get(ids.articleB)).accessMode, 'PUBLIC');
  });
  await pass('CONSTRAINTS', async () => {
    for (const op of reuse.fixtures.expandedPlan(ids)) await client[op.delegate][op.method](op.args);
    const codes = [];
    for (const op of reuse.fixtures.constraintCases(ids)) {
      if (op.expect === 'SUCCESS') await client[op.delegate][op.method](op.args);
      else await expectedPrisma(() => client[op.delegate][op.method](op.args), op.expect);
      codes.push({ id: op.id, expected: op.expect });
    }
    return codes;
  });
  await pass('SAVE_NULL_PUBLIC', async () => {
    for (const mode of [null, 'PUBLIC']) {
      const a = await invoke('createArticleDraft', [draftInput(`${ids.namespace}-${mode ?? 'null'}`, mode)]);
      assert.equal(a.result.ok, true); assert.equal(a.observations.commits, 1);
      const id = a.result.data.id, row = await get(id);
      assert.equal(row.accessMode, mode); assert.equal(await client.articleProduct.count({ where: { articleId: id } }), 0);
      const reopened = await invoke('getArticleDraftForEdit', [session.user, id]);
      assert.equal(reopened.result.ok, true); assert.deepEqual(reopened.result.data.audience, { accessMode: mode, productIds: [] });
      const next = mode === null ? 'PUBLIC' : null;
      const save = await invoke('updateArticleDraft', [id, updateInput(row, next)]);
      assert.equal(save.result.ok, true); assert.equal((await get(id)).accessMode, next);
      assert.ok(new Date(save.result.data.updatedAt) > row.updatedAt);
    }
  });
  await pass('OMITTED_AUDIENCE', async () => {
    for (const mode of [null, 'PUBLIC']) {
      await client.article.update({ where: { id: ids.articleB }, data: { accessMode: mode } });
      const row = await get(ids.articleB), input = updateInput(row);
      assert.equal(Object.hasOwn(input, 'audience'), false); input.title = 'Legacy omission ' + (mode ?? 'null');
      const saved = await invoke('updateArticleDraft', [row.id, input]);
      assert.equal(saved.result.ok, true); assert.equal((await get(row.id)).accessMode, mode);
    }
  });
  await pass('STALE_CAS', async () => {
    const row = await get(ids.casArticle), input = updateInput(row, 'PUBLIC');
    const first = await invoke('updateArticleDraft', [row.id, input]); assert.equal(first.result.ok, true);
    const before = fingerprint(await get(row.id));
    const stale = await invoke('updateArticleDraft', [row.id, { ...input, title: 'Stale overwrite' }], {}, session, second);
    error(stale.result, 'EDIT_CONFLICT'); assert.equal(fingerprint(await get(row.id)), before);
    assert.equal(stale.observations.writes, 0);
  });
  const isolated = [];
  await pass('SERIALIZABLE', async () => {
    const row = await get(ids.casArticle);
    const save = await invoke('updateArticleDraft', [row.id, updateInput(row, null)], {
      async inspectTransaction(id) {
        // Read-only metadata polling; no mutation replay. Information_schema refresh may lag.
        let rows = [];
        for (let attempt = 0; attempt < 20; attempt++) {
          rows = await ddl.query('SELECT trx_isolation_level AS isolation FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id=?', [id]);
          if (rows.length) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(rows.length, 1); assert.equal(rows[0].isolation, 'SERIALIZABLE'); isolated.push(id);
      },
    });
    assert.equal(save.result.ok, true); assert.equal(isolated.length, 1);
    return { observedIsolation: 'SERIALIZABLE', observations: isolated.length };
  });
  await pass('CONCURRENT_ACTIONS', async () => {
    // Both transactions read the SAME persisted token before either attempts UPDATE.
    for (const reverse of [false, true]) {
      const row = await get(ids.casArticle), barrier = createBarrier(2);
      const left = { ...updateInput(row), title: reverse ? 'Content second' : 'Content first' };
      const right = updateInput(row, row.accessMode === null ? 'PUBLIC' : null);
      const requests = reverse ? [right, left] : [left, right];
      let result;
      try { result = await Promise.all([
        invoke('updateArticleDraft', [row.id, requests[0]], { barrier }, session, client),
        invoke('updateArticleDraft', [row.id, requests[1]], { barrier }, session, second),
      ]); } finally { barrier.cancel(); }
      const connectionIds = result.flatMap(r => r.observations.connectionIds);
      assert.equal(connectionIds.length, 2); assert.equal(new Set(connectionIds).size, 2);
      assert.equal(result.filter(r => r.result.ok).length, 1);
      error(result.find(r => !r.result.ok).result, 'EDIT_CONFLICT');
      assert.ok(result.some(r => r.observations.conflicts.includes('P2034')));
      const winner = result.findIndex(r => r.result.ok), persisted = await get(row.id);
      assert.equal(persisted.title, requests[winner].title);
      assert.equal(persisted.accessMode, requests[winner].audience?.accessMode ?? (requests[winner].audience ? null : row.accessMode));
      assert.ok(persisted.updatedAt > row.updatedAt);
      assert.equal(result.reduce((n, r) => n + r.observations.transactions, 0), 2);
    }
  });
  await pass('ROLLBACK', async () => {
    // Use same-Article legacy version so active pointers participate in rollback.
    await client.article.update({ where: { id: ids.articleB }, data: { activeReviewVersionId: ids.versionB, activeApprovalVersionId: ids.versionB } });
    const row = await get(ids.articleB), before = fingerprint(row);
    const failed = await invoke('updateArticleDraft', [row.id, { ...updateInput(row, null), title: 'Must rollback' }], { fault: 'ROLLBACK' });
    error(failed.result, 'INTERNAL_ERROR'); assert.equal(failed.observations.commits, 0);
    assert.equal(failed.observations.writes, 1); assert.equal(failed.observations.revalidations, 0);
    assert.equal(fingerprint(await get(row.id)), before);
  });
  await pass('LOST_ACK', async () => {
    const row = await get(ids.articleB);
    const lost = await invoke('updateArticleDraft', [row.id, { ...updateInput(row, 'PUBLIC'), title: 'Committed response withheld' }], { fault: 'LOST_ACK' });
    error(lost.result, 'INTERNAL_ERROR'); assert.equal(lost.observations.transactions, 1);
    assert.equal(lost.observations.commits, 1); assert.equal(lost.observations.lostAck, 1);
    assert.equal(lost.observations.revalidations, 0);
    // Independent observer reconciles the known injected ACK loss; no automatic replay.
    const observed = await second.article.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(observed.title, 'Committed response withheld'); assert.equal(observed.accessMode, 'PUBLIC');
    assert.ok(observed.updatedAt > row.updatedAt); assert.equal(observed.activeApprovalVersionId, null);
    return { simulatedAckLoss: true, realCommitObserved: true, attempts: 1, transportFailureProven: false };
  });
  await pass('PAID_DENIED', async () => {
    const row = await get(ids.articleA), before = fingerprint(row);
    error((await invoke('updateArticleDraft', [row.id, updateInput(row, null)])).result, 'POLICY_UNRESOLVED');
    error((await invoke('getArticleDraftForEdit', [session.user, row.id])).result, 'POLICY_UNRESOLVED');
    assert.equal(fingerprint(await get(row.id)), before);
    const input = draftInput(`${ids.namespace}-paid`, 'PUBLIC'); input.audience = { accessMode: 'PAID_PRODUCT', productIds: [ids.product] };
    const count = await client.article.count(); const denied = await invoke('createArticleDraft', [input]);
    error(denied.result, 'POLICY_UNRESOLVED'); assert.equal(denied.observations.transactions, 0);
    assert.equal(await client.article.count(), count);
  });
  await pass('INCONSISTENT_DENIED', async () => {
    for (const mode of [null, 'PUBLIC']) {
      await client.article.update({ where: { id: ids.articleA }, data: { accessMode: mode } });
      const row = await get(ids.articleA), before = fingerprint(row);
      error((await invoke('updateArticleDraft', [row.id, updateInput(row, 'PUBLIC')])).result, 'INTERNAL_ERROR');
      error((await invoke('getArticleDraftForEdit', [session.user, row.id])).result, 'INTERNAL_ERROR');
      assert.equal(fingerprint(await get(row.id)), before);
    }
  });
  await pass('ACTOR_SCOPE', async () => {
    const foreign = { user: { id: ids.reviewer, role: 'CREATOR' } };
    await client.user.update({ where: { id: ids.reviewer }, data: { role: 'CREATOR' } });
    let row = await get(ids.articleB), before = fingerprint(row);
    error((await invoke('updateArticleDraft', [row.id, updateInput(row)], {}, foreign)).result, 'NOT_FOUND');
    error((await invoke('getArticleDraftForEdit', [foreign.user, row.id], {}, foreign)).result, 'NOT_FOUND');
    await client.user.update({ where: { id: ids.reviewer }, data: { role: 'ADMIN' } });
    error((await invoke('updateArticleDraft', [row.id, updateInput(row)], {}, foreign)).result, 'FORBIDDEN');
    for (const status of ['SUSPENDED', 'DISABLED']) {
      await client.user.update({ where: { id: ids.author }, data: { status } });
      error((await invoke('updateArticleDraft', [row.id, updateInput(row)])).result, 'FORBIDDEN');
    }
    await client.user.update({ where: { id: ids.author }, data: { status: 'ACTIVE' } });
    error((await invoke('updateArticleDraft', [row.id, updateInput(row)], {}, null)).result, 'FORBIDDEN');
    error((await invoke('updateArticleDraft', [row.id, updateInput(row)], {}, { user: { id: ids.namespace + '_missing', role: 'CREATOR' } })).result, 'FORBIDDEN');
    error((await invoke('updateArticleDraft', [row.id, updateInput(row)], {}, { user: { id: ids.author, role: 'CLIENT' } })).result, 'FORBIDDEN');
    assert.equal(fingerprint(await get(row.id)), before);
    await client.article.update({ where: { id: row.id }, data: { status: 'SUBMITTED' } }); row = await get(row.id); before = fingerprint(row);
    error((await invoke('updateArticleDraft', [row.id, updateInput(row)], {}, admin)).result, 'NOT_EDITABLE');
    assert.equal(fingerprint(await get(row.id)), before);
    await client.article.update({ where: { id: row.id }, data: { status: 'DRAFT' } });
  });
  await pass('POINTERS_HISTORY', async () => {
    await client.articleProduct.delete({ where: { articleId_productId: { articleId: ids.articleA, productId: ids.product } } });
    const history = async () => ({
      versions: await client.articleVersion.findMany({ where: { articleId: ids.articleA }, orderBy: { id: 'asc' } }),
      reviews: await client.articleReview.findMany({ where: { articleId: ids.articleA }, orderBy: { id: 'asc' } }),
      events: await client.articleReviewEvent.findMany({ where: { articleId: ids.articleA }, orderBy: { id: 'asc' } }),
      products: await client.articleVersionProduct.findMany({ where: { articleId: ids.articleA }, orderBy: { productId: 'asc' } }),
    });
    const before = fingerprint(await history()); let row = await get(ids.articleA);
    const noOp = await invoke('updateArticleDraft', [row.id, updateInput(row)]); assert.equal(noOp.result.ok, true);
    row = await get(row.id); assert.equal(row.activeReviewVersionId, ids.versionNew); assert.equal(row.activeApprovalVersionId, ids.versionNew);
    const change = await invoke('updateArticleDraft', [row.id, updateInput(row, null)]); assert.equal(change.result.ok, true);
    row = await get(row.id); assert.equal(row.activeReviewVersionId, null); assert.equal(row.activeApprovalVersionId, null);
    assert.equal(fingerprint(await history()), before);
    await expectedPrisma(() => client.articleVersion.delete({ where: { id: ids.versionNew } }), 'P2003');
    assert.equal(fingerprint(await history()), before);
  });
}
