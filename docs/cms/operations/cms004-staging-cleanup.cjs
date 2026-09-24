#!/usr/bin/env node
"use strict";

// CMS-004 staging fixture cleanup. Default: check only; --apply deletes the
// exact five articles, one profile, two QA users and their own AUTH_LOGIN logs.
// Run from the LKC repository root. Dependencies are loaded from that directory.
// Credentials stay local. No migration, reset, seed, FK disabling or retry.
const { createRequire } = require("node:module");
const { join } = require("node:path");
const projectRequire = createRequire(join(process.cwd(), "package.json"));
const ids = ["cms004_qa_creator", "cms004_qa_other"];
const expected = new Map([
  ["cms004-qa-draft", [ids[0], "DRAFT"]],
  ["cms004-qa-submitted", [ids[0], "SUBMITTED"]],
  ["cms004-qa-published", [ids[0], "PUBLISHED"]],
  ["cms004-qa-archived", [ids[0], "ARCHIVED"]],
  ["cms004-qa-foreign-draft", [ids[1], "DRAFT"]]
]);
const articleScope = { OR: [
  { slug: { startsWith: "cms004-qa-" } },
  { authorId: { in: ids } }
] };
const profileScope = { userId: { in: ids } };
const userScope = { id: { in: ids } };
class Stop extends Error {}
function assert(ok, reason) {
  if (!ok) throw new Stop(reason);
}
async function identity(db) {
  const [row] = await db.$queryRaw`SELECT DATABASE() AS dbName, CURRENT_USER() AS dbUser`;
  assert(row?.dbName === "edpmjmha_lkcstage" &&
    String(row?.dbUser).split("@")[0] === "edpmjmha_lkcstg",
    "SERVER_IDENTITY_MISMATCH");
}
async function counts(db) {
  return Promise.all([
    db.article.count({ where: articleScope }),
    db.authorProfile.count({ where: profileScope }),
    db.user.count({ where: userScope })
  ]);
}
function printCounts(values) {
  console.log("remaining_articles =", values[0]);
  console.log("remaining_profiles =", values[1]);
  console.log("remaining_users =", values[2]);
}
async function preflight(db) {
  await identity(db);
  const [articles, profiles, users, logs] = await Promise.all([
    db.article.findMany({
      where: articleScope,
      select: { id: true, slug: true, authorId: true, status: true, _count: true }
    }),
    db.authorProfile.findMany({
      where: profileScope, select: { id: true, userId: true, slug: true }
    }),
    db.user.findMany({
      where: userScope,
      select: {
        id: true, email: true, role: true, status: true,
        customerProfile: { select: { id: true } }, _count: true
      }
    }),
    db.auditLog.findMany({
      where: { actorId: { in: ids } },
      select: { id: true, actorId: true, action: true, entityType: true, entityId: true }
    })
  ]);
  if (!articles.length && !profiles.length && !users.length && !logs.length) {
    return { clean: true };
  }
  assert(articles.length === 5 && profiles.length === 1 && users.length === 2,
    "FIXTURE_COUNTS_CHANGED");
  for (const article of articles) {
    const fixture = expected.get(article.slug);
    assert(fixture && article.authorId === fixture[0] && article.status === fixture[1],
      "ARTICLE_FIXTURE_MISMATCH");
    assert(article._count && Object.values(article._count).every(n => n === 0),
      "ARTICLE_HAS_RELATED_DATA");
  }
  assert(new Set(articles.map(a => a.slug)).size === 5, "ARTICLE_FIXTURE_MISMATCH");
  assert(profiles[0].userId === ids[0] && profiles[0].slug === "cms004-qa-creator",
    "PROFILE_FIXTURE_MISMATCH");
  for (const user of users) {
    assert(ids.includes(user.id) && user.role === "CREATOR" && user.status === "ACTIVE",
      "USER_FIXTURE_MISMATCH");
    if (user.id === ids[0]) {
      assert(user.email === "cms004-creator@example.invalid", "USER_FIXTURE_MISMATCH");
    }
    assert(!user.customerProfile && user._count &&
      Object.entries(user._count).every(([name, n]) =>
        name === "articlesAuthored" || name === "auditLogs" || n === 0),
      "USER_HAS_OTHER_RELATED_DATA");
  }
  assert(new Set(users.map(u => u.id)).size === 2, "USER_FIXTURE_MISMATCH");
  for (const log of logs) {
    assert(ids.includes(log.actorId) && log.action === "AUTH_LOGIN" &&
      log.entityType === "User" && log.entityId === log.actorId,
      "UNEXPECTED_QA_AUDIT_RECORD");
  }
  console.log("STAGING_IDENTITY = OK");
  console.log("FIXTURE_PREFLIGHT = OK");
  console.log("fixture_articles = 5");
  console.log("fixture_profiles = 1");
  console.log("fixture_users = 2");
  console.log("fixture_login_logs =", logs.length);
  return { clean: false, articles, profiles, logs };
}
let prisma;
let stage = "CONFIG";
let committed = false;
async function main() {
  const args = process.argv.slice(2);
  assert(args.length <= 1 && (!args.length || ["--check", "--apply"].includes(args[0])),
    "USE_CHECK_OR_APPLY");
  const apply = args[0] === "--apply";
  console.log("MODE =", apply ? "APPLY" : "CHECK");
  const dotenv = projectRequire("dotenv");
  dotenv.config({ path: ".env.local", quiet: true });
  dotenv.config({ path: ".env", quiet: true });
  assert(process.env.DATABASE_URL, "DATABASE_URL_MISSING");
  let url;
  try { url = new URL(process.env.DATABASE_URL); }
  catch { throw new Stop("DATABASE_URL_INVALID"); }
  const target = {
    host: url.hostname, port: Number(url.port || 3306),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username)
  };
  console.log("TARGET =", JSON.stringify(target));
  assert(url.protocol === "mysql:" && target.host === "127.0.0.1" &&
    target.port === 3307 && target.database === "edpmjmha_lkcstage" &&
    target.user === "edpmjmha_lkcstg", "STAGING_TARGET_MISMATCH");
  stage = "CONNECT";
  const { PrismaClient } = projectRequire("@prisma/client");
  const { PrismaMariaDb } = projectRequire("@prisma/adapter-mariadb");
  prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
      ...target, password: decodeURIComponent(url.password),
      connectionLimit: 1, allowPublicKeyRetrieval: true
    }),
    log: []
  });
  stage = "PREFLIGHT";
  const result = await prisma.$transaction(async tx => {
    const fixture = await preflight(tx);
    if (fixture.clean) return { clean: true };
    if (!apply) return { checked: true };
    stage = "DELETE_FIXTURES";
    const articles = await tx.article.deleteMany({ where: {
      AND: [
        { id: { in: fixture.articles.map(a => a.id) } },
        { slug: { in: [...expected.keys()] } },
        { authorId: { in: ids } }
      ]
    } });
    assert(articles.count === 5, "ARTICLE_DELETE_COUNT_MISMATCH");
    const profiles = await tx.authorProfile.deleteMany({ where: {
      id: fixture.profiles[0].id, userId: ids[0], slug: "cms004-qa-creator"
    } });
    assert(profiles.count === 1, "PROFILE_DELETE_COUNT_MISMATCH");
    if (fixture.logs.length) {
      const logs = await tx.auditLog.deleteMany({ where: {
        id: { in: fixture.logs.map(log => log.id) },
        actorId: { in: ids }, action: "AUTH_LOGIN",
        entityType: "User", entityId: { in: ids }
      } });
      assert(logs.count === fixture.logs.length, "AUDIT_DELETE_COUNT_MISMATCH");
    }
    const users = await tx.user.deleteMany({ where: {
      id: { in: ids }, role: "CREATOR", status: "ACTIVE"
    } });
    assert(users.count === 2, "USER_DELETE_COUNT_MISMATCH");
    stage = "VERIFY_TRANSACTION";
    assert((await counts(tx)).every(n => n === 0) &&
      await tx.auditLog.count({ where: { actorId: { in: ids } } }) === 0,
      "FIXTURES_REMAIN");
    stage = "COMMIT";
    return { applied: true };
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
  committed = Boolean(result.applied);
  if (committed) console.log("CLEANUP_COMMITTED = YES");
  if (result.clean) console.log("ALREADY_CLEAN = YES");
  stage = "VERIFY_AFTER_TRANSACTION";
  await identity(prisma);
  const remaining = await counts(prisma);
  printCounts(remaining);
  if (apply || result.clean) assert(remaining.every(n => n === 0), "FIXTURES_REMAIN");
  console.log("RESULT =", committed || result.clean ? "CLEANUP_VERIFIED" : "CHECK_ONLY");
}
main().catch(error => {
  console.log("CHECK_FAILED_AT =", stage);
  if (error instanceof Stop) console.log("STOP =", error.message);
  else {
    const code = String(error?.code || "");
    if (/^(P[0-9]{4}|MODULE_NOT_FOUND|ECONNREFUSED|ETIMEDOUT)$/.test(code)) {
      console.log("ERROR_CODE =", code);
    }
  }
  console.log("CLEANUP_VERIFIED = NO");
  console.log("NEXT = Run --check before any further cleanup attempt");
  if (committed) console.log("CLEANUP_COMMITTED = YES");
  process.exitCode = 1;
}).finally(async () => {
  if (prisma) await prisma.$disconnect().catch(() => {});
});
