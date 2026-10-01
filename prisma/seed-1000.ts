import { config } from "dotenv";
config({ path: ".env.local" });
import bcrypt from "bcryptjs";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { PrismaClient } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const FIRST_NAMES = [
  "Alex", "Jordan", "Taylor", "Morgan", "Sam", "Chris", "Pat", "Riley", "Casey", "Avery",
  "Dakota", "Reese", "Quinn", "Skyler", "Rowan", "Emerson", "Finley", "Hayden", "Logan", "Peyton",
  "Jesse", "Kai", "Devon", "Dallas", "Shiloh", "Sage", "River", "Phoenix", "Eden", "Amari"
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson"
];

const SYSTEM_TAGS = ["HARDWARE", "SYSTEM", "DEPOSIT", "VOUCHER", "MIKROTIK", "AUTH", "NETWORK", "AI_VISION"];

const LOG_MESSAGES: { level: "INFO" | "WARN" | "ERROR"; tag: string; message: string; details?: string }[] = [
  { level: "INFO", tag: "SYSTEM", message: "System heartbeat check normal." },
  { level: "INFO", tag: "HARDWARE", message: "ESP32-CAM optical sensor calibrated successfully." },
  { level: "INFO", tag: "DEPOSIT", message: "Bottle deposit session initiated by user." },
  { level: "INFO", tag: "DEPOSIT", message: "Item classified as PET_BOTTLE with 98.4% confidence." },
  { level: "INFO", tag: "DEPOSIT", message: "Item classified as ALUMINUM_CAN with 96.1% confidence." },
  { level: "INFO", tag: "VOUCHER", message: "WiFi voucher generated and sent to router." },
  { level: "INFO", tag: "MIKROTIK", message: "Router REST API connection verified." },
  { level: "WARN", tag: "HARDWARE", message: "Camera lens illumination below target threshold." },
  { level: "WARN", tag: "DEPOSIT", message: "Item rejected: unclassifiable object detected." },
  { level: "WARN", tag: "NETWORK", message: "High latency detected on MikroTik gateway (180ms)." },
  { level: "ERROR", tag: "HARDWARE", message: "Buzzer pin GPIO status failed to return high signal." },
  { level: "ERROR", tag: "MIKROTIK", message: "MikroTik Hotspot API connection timeout after 5000ms." },
  { level: "ERROR", tag: "SYSTEM", message: "Database connection pool transient retry triggered." },
];

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomDateInPastMonths(monthsBack: number): Date {
  const now = new Date();
  const past = new Date(now.getTime() - monthsBack * 30 * 24 * 60 * 60 * 1000);
  const randomTimestamp = past.getTime() + Math.random() * (now.getTime() - past.getTime());
  return new Date(randomTimestamp);
}

async function seed1000() {
  console.log("Starting bulk seeding of 1000 users and 1000 system logs...");

  const defaultPasswordHash = await bcrypt.hash("User12345!", 10);

  // 1. Prepare 1000 user records
  const existingCount = await prisma.user.count({ where: { role: "USER" } });
  console.log(`Current existing users count: ${existingCount}`);

  const targetUserCount = 1000;
  const usersToCreate: Array<{
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    role: "USER";
    pointsBalance: number;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  const now = new Date();

  for (let i = 1; i <= targetUserCount; i++) {
    const email = `recycler${i}@fibott.local`;
    const firstName = FIRST_NAMES[(i - 1) % FIRST_NAMES.length];
    const lastName = LAST_NAMES[Math.floor((i - 1) / FIRST_NAMES.length) % LAST_NAMES.length];
    const name = `${firstName} ${lastName} #${i}`;
    const createdAt = getRandomDateInPastMonths(3); // within last 3 months
    // Top users get higher points balances to create distinct leaderboard positions
    const pointsBalance = i <= 10 ? getRandomInt(1500, 3500) : i <= 50 ? getRandomInt(400, 1400) : getRandomInt(0, 350);

    usersToCreate.push({
      id: `usr_dummy_${String(i).padStart(4, "0")}`,
      email,
      name,
      passwordHash: defaultPasswordHash,
      role: "USER",
      pointsBalance,
      createdAt,
      updatedAt: createdAt,
    });
  }

  // Use createMany with skipDuplicates
  console.log(`Inserting ${usersToCreate.length} user records...`);
  await prisma.user.createMany({
    data: usersToCreate,
    skipDuplicates: true,
  });
  console.log("Users created successfully.");

  // Fetch device or ensure a device exists
  let device = await prisma.device.findFirst();
  if (!device) {
    device = await prisma.device.create({
      data: {
        name: "Fibott-Kiosk-01-Cam",
        type: "ESP32_CAM",
        apiKeyHash: "hash_demo_1000",
        apiKeyPrefix: "fibott_dev_1000",
      },
    });
  }

  // 2. Generate Deposits & Deposit Sessions so leaderboard has rich data for current & past months!
  const createdUsers = await prisma.user.findMany({
    where: { id: { startsWith: "usr_dummy_" } },
    select: { id: true, createdAt: true },
    take: 500,
  });

  const depositsToCreate: Array<{
    userId: string;
    deviceId: string;
    materialType: "PET_BOTTLE" | "ALUMINUM_CAN" | "REJECTED";
    quantity: number;
    pointsAwarded: number;
    status: "ACCEPTED" | "REJECTED";
    classificationLabel: string;
    classificationConfidence: number;
    createdAt: Date;
  }> = [];

  // Create deposits over the past 3 months
  for (let uIdx = 0; uIdx < createdUsers.length; uIdx++) {
    const user = createdUsers[uIdx];
    // Top 3 users get significant recycling volume
    const depositCount = uIdx === 0 ? 80 : uIdx === 1 ? 65 : uIdx === 2 ? 50 : uIdx < 20 ? getRandomInt(10, 30) : getRandomInt(1, 5);

    for (let d = 0; d < depositCount; d++) {
      const isBottle = Math.random() > 0.3;
      const materialType = isBottle ? "PET_BOTTLE" : "ALUMINUM_CAN";
      const pointsPerItem = isBottle ? 5 : 10;
      const qty = getRandomInt(1, 4);
      const createdAt = getRandomDateInPastMonths(2); // recent 2 months

      depositsToCreate.push({
        userId: user.id,
        deviceId: device.id,
        materialType,
        quantity: qty,
        pointsAwarded: qty * pointsPerItem,
        status: "ACCEPTED",
        classificationLabel: isBottle ? "plastic bottle" : "aluminum can",
        classificationConfidence: parseFloat((0.9 + Math.random() * 0.09).toFixed(3)),
        createdAt,
      });
    }
  }

  console.log(`Inserting ${depositsToCreate.length} deposit records...`);
  await prisma.deposit.createMany({
    data: depositsToCreate,
  });
  console.log("Deposits created successfully.");

  // 3. Prepare 1000 system log records
  console.log("Inserting 1000 system log records...");
  const systemLogsToCreate: Array<{
    source: "HARDWARE" | "SYSTEM";
    level: "INFO" | "WARN" | "ERROR";
    tag: string;
    message: string;
    details: string;
    deviceId: string;
    createdAt: Date;
  }> = [];

  for (let i = 1; i <= 1000; i++) {
    const tmpl = getRandomItem(LOG_MESSAGES);
    const createdAt = getRandomDateInPastMonths(2);

    systemLogsToCreate.push({
      source: tmpl.tag === "HARDWARE" ? "HARDWARE" : "SYSTEM",
      level: tmpl.level,
      tag: tmpl.tag,
      message: `${tmpl.message} [Ref #${i}]`,
      details: tmpl.details ?? JSON.stringify({ eventId: `evt_${i}`, timestamp: createdAt.toISOString() }),
      deviceId: device.id,
      createdAt,
    });
  }

  await prisma.systemLog.createMany({
    data: systemLogsToCreate,
  });
  console.log("System logs inserted successfully.");

  // 4. Ensure default leaderboard reward settings exist
  await prisma.leaderboardRewardSetting.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      rank1Points: 500,
      rank2Points: 300,
      rank3Points: 100,
    },
  });

  const totalUsers = await prisma.user.count();
  const totalLogs = await prisma.systemLog.count();
  const totalDeposits = await prisma.deposit.count();

  console.log(`\n================ SEED COMPLETE ================`);
  console.log(`Total Users in DB: ${totalUsers}`);
  console.log(`Total System Logs in DB: ${totalLogs}`);
  console.log(`Total Deposits in DB: ${totalDeposits}`);
  console.log(`===============================================`);
}

seed1000()
  .catch((err) => {
    console.error("Error during seed1000:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
