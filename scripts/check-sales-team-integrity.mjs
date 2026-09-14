import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

// Read-only preflight. Never repair duplicates or connect to production here.
const url = new URL(process.env.DATABASE_URL);
const database = decodeURIComponent(url.pathname.slice(1));
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  || url.protocol !== 'mysql:'
  || !/(?:^|_)(?:dev|test)(?:_|$)/i.test(database)
  || /(?:^|_)(?:prod|production)(?:_|$)/i.test(database)) {
  throw new Error('Sales Team preflight requires a loopback database with a dev/test database name.');
}
const prisma = new PrismaClient({ adapter: new PrismaMariaDb({
  host: url.hostname, port: Number(url.port || 3306),
  user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
  database, connectionLimit: 1, allowPublicKeyRetrieval: true,
}) });

try {
  const groups = await prisma.salesTeamMember.groupBy({
    by: ['userId'], _count: { _all: true },
    having: { userId: { _count: { gt: 1 } } },
  });
  const duplicates = groups.length ? await prisma.salesTeamMember.findMany({
    where: { userId: { in: groups.map((group) => group.userId) } },
    select: { id: true, userId: true, teamId: true },
    orderBy: [{ userId: 'asc' }, { teamId: 'asc' }],
  }) : [];
  console.log(JSON.stringify({
    host: url.hostname, database,
    membershipCount: await prisma.salesTeamMember.count(),
    duplicateUserCount: groups.length, duplicates,
    result: groups.length ? 'BLOCKED: do not migrate or auto-repair data' : 'PASS: no duplicate memberships',
  }, null, 2));
  if (groups.length) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
