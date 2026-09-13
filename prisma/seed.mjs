import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured");
}

const url = new URL(databaseUrl);

const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ""),
  connectionLimit: 5,
  allowPublicKeyRetrieval: true,
});

const prisma = new PrismaClient({ adapter });

const demo = [
  ["admin@lkc.vn", "LKC Admin", "ADMIN"],
  ["salesmanager@lkc.vn", "Sales Manager", "SALES_MANAGER"],
  ["sales@lkc.vn", "Sales Demo", "SALES"],
  ["creator@lkc.vn", "Creator Demo", "CREATOR"],
  ["analyst@lkc.vn", "Analyst Demo", "ANALYST"],
  ["employee@lkc.vn", "Employee Demo", "EMPLOYEE"],
  ["client@lkc.vn", "Client Demo", "CLIENT"],
];

const password =
  process.env.SEED_DEMO_PASSWORD || "ChangeMe@123456";

const hash = await bcrypt.hash(password, 12);

const users = new Map();

try {
  for (const [email, name, role] of demo) {
    const user = await prisma.user.upsert({
      where: { email },
     update: {
  name,
  role,
  status: "ACTIVE",
  password: hash,
},
      create: {
        email,
        name,
        role,
        status: "ACTIVE",
        password: hash,
      },
    });

    users.set(role, user);
  }

  const salesManager = users.get("SALES_MANAGER");
  const sales = users.get("SALES");
  const client = users.get("CLIENT");

  let team = await prisma.salesTeam.findFirst({
    where: {
      name: "LKC Sales Demo",
    },
  });

  if (!team) {
    team = await prisma.salesTeam.create({
      data: {
        name: "LKC Sales Demo",
        managerId: salesManager.id,
      },
    });
  }

  for (const member of [salesManager, sales]) {
    await prisma.salesTeamMember.upsert({
      where: {
        teamId_userId: {
          teamId: team.id,
          userId: member.id,
        },
      },
      update: {},
      create: {
        teamId: team.id,
        userId: member.id,
      },
    });
  }

  await prisma.customerProfile.upsert({
    where: {
      userId: client.id,
    },
    update: {
      assignedSalesId: sales.id,
      status: "PROSPECT",
    },
    create: {
      userId: client.id,
      customerCode: `LKC-${client.id.slice(-8).toUpperCase()}`,
      status: "PROSPECT",
      assignedSalesId: sales.id,
      source: "DEMO",
    },
  });

  console.log("");
  console.log("======================================");
  console.log("LKC FINTECH DEMO DATA CREATED");
  console.log("======================================");
  console.log(`Users created: ${demo.length}`);
  console.log("Sales team created: LKC Sales Demo");
  console.log("Client assigned to Sales Demo");
  console.log("");
  console.log("Demo password is taken from:");
  console.log("SEED_DEMO_PASSWORD");
  console.log("======================================");
} finally {
  await prisma.$disconnect();
}