import { config } from "dotenv";
config({ path: ".env.local" });
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { PrismaClient } from "../src/generated/prisma/client";

// Plain Node.js (this CLI script, unlike Vercel's own runtime) has no global
// WebSocket implementation, which @neondatabase/serverless needs even for
// non-transaction queries.
neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const KEY_PREFIX = "fibott_dev_";

async function generateDeviceApiKey() {
  const secret = crypto.randomBytes(24).toString("hex");
  const plaintext = `${KEY_PREFIX}${secret}`;
  const hash = await bcrypt.hash(plaintext, 10);
  const prefix = plaintext.slice(0, KEY_PREFIX.length + 8);
  return { plaintext, hash, prefix };
}

async function main() {
  await prisma.rewardRule.upsert({
    where: { materialType: "PET_BOTTLE" },
    update: {},
    create: { materialType: "PET_BOTTLE", pointsPerItem: 5 },
  });
  await prisma.rewardRule.upsert({
    where: { materialType: "ALUMINUM_CAN" },
    update: {},
    create: { materialType: "ALUMINUM_CAN", pointsPerItem: 10 },
  });
  await prisma.rewardRule.upsert({
    where: { materialType: "REJECTED" },
    update: {},
    create: { materialType: "REJECTED", pointsPerItem: 0, isActive: false },
  });

  const existingVoucherRule = await prisma.voucherRule.findFirst({
    where: { label: "1 Hour WiFi" },
  });
  if (!existingVoucherRule) {
    await prisma.voucherRule.create({
      data: { label: "1 Hour WiFi", pointsCost: 100, durationMinutes: 60 },
    });
  }

  const adminEmail = "admin@fibott.local";
  const adminPassword = "Admin12345!";
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Fibott Admin",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      emailVerified: new Date(),
    },
  });

  const testUserEmail = "testuser@fibott.local";
  const testUserPassword = "TestUser12345!";
  const testUserPasswordHash = await bcrypt.hash(testUserPassword, 10);
  await prisma.user.upsert({
    where: { email: testUserEmail },
    update: {},
    create: {
      email: testUserEmail,
      name: "Test User",
      passwordHash: testUserPasswordHash,
      role: "USER",
      emailVerified: new Date(),
      pointsBalance: 500,
    },
  });

  const devices: { name: string; type: "ESP32_CAM" | "KIOSK_CONTROLLER" }[] = [
    { name: "Fibott-Kiosk-01-Cam", type: "ESP32_CAM" },
    { name: "Fibott-Kiosk-01-Controller", type: "KIOSK_CONTROLLER" },
  ];

  const generatedKeys: { name: string; plaintext: string }[] = [];

  for (const device of devices) {
    const existing = await prisma.device.findFirst({ where: { name: device.name } });
    if (existing) continue;

    const { plaintext, hash, prefix } = await generateDeviceApiKey();
    await prisma.device.create({
      data: {
        name: device.name,
        type: device.type,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
      },
    });
    generatedKeys.push({ name: device.name, plaintext });
  }

  console.log("Seed complete.");
  console.log(`Admin login: ${adminEmail} / ${adminPassword}`);
  console.log(`Test user login: ${testUserEmail} / ${testUserPassword}`);
  if (generatedKeys.length > 0) {
    console.log("\nDevice API keys (shown once, save these for testing):");
    for (const key of generatedKeys) {
      console.log(`  ${key.name}: ${key.plaintext}`);
    }
  } else {
    console.log("\nDevices already seeded; no new API keys generated.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
