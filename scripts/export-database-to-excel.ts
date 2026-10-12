import { config } from "dotenv";
config({ path: ".env.local" });
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import * as XLSX from "xlsx";
import path from "path";
import { PrismaClient } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function exportDatabase() {
  console.log("Fetching database records for export...");

  const [
    users,
    deposits,
    pointsTransactions,
    vouchers,
    voucherRules,
    rewardRules,
    devices,
    depositSessions,
    systemLogs,
    notifications,
    leaderboardSettings,
    monthlyAwards,
  ] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        pointsBalance: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.deposit.findMany({
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: {
        id: true,
        userId: true,
        materialType: true,
        quantity: true,
        pointsAwarded: true,
        status: true,
        classificationLabel: true,
        classificationConfidence: true,
        deviceId: true,
        depositSessionId: true,
        createdAt: true,
      },
    }),
    prisma.pointsTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: {
        id: true,
        userId: true,
        type: true,
        amount: true,
        balanceAfter: true,
        source: true,
        note: true,
        depositId: true,
        voucherId: true,
        createdAt: true,
      },
    }),
    prisma.voucher.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        code: true,
        pointsCost: true,
        durationMinutes: true,
        status: true,
        issuedAt: true,
        redeemedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
    prisma.voucherRule.findMany({
      select: {
        id: true,
        label: true,
        pointsCost: true,
        durationMinutes: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.rewardRule.findMany({
      select: {
        id: true,
        materialType: true,
        pointsPerItem: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.device.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        apiKeyPrefix: true,
        location: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
      },
    }),
    prisma.depositSession.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        code: true,
        userId: true,
        deviceId: true,
        status: true,
        activatedAt: true,
        completedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
    prisma.systemLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: {
        id: true,
        source: true,
        level: true,
        tag: true,
        message: true,
        details: true,
        deviceId: true,
        createdAt: true,
      },
    }),
    prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        userId: true,
        title: true,
        message: true,
        type: true,
        isRead: true,
        createdAt: true,
      },
    }),
    prisma.leaderboardRewardSetting.findMany(),
    prisma.monthlyLeaderboardAward.findMany({
      orderBy: { awardedAt: "desc" },
    }),
  ]);

  console.log(`Fetched:
- Users: ${users.length}
- Deposits: ${deposits.length}
- Transactions: ${pointsTransactions.length}
- Vouchers: ${vouchers.length}
- Voucher Rules: ${voucherRules.length}
- Reward Rules: ${rewardRules.length}
- Devices: ${devices.length}
- Deposit Sessions: ${depositSessions.length}
- System Logs: ${systemLogs.length}
- Notifications: ${notifications.length}
- Leaderboard Settings: ${leaderboardSettings.length}
- Monthly Awards: ${monthlyAwards.length}
  `);

  const wb = XLSX.utils.book_new();

  // Helper to convert dates to ISO strings for Excel compatibility
  const sanitize = (rows: any[]) =>
    rows.map((row) => {
      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        if (v instanceof Date) {
          clean[k] = v.toISOString();
        } else if (typeof v === "object" && v !== null) {
          clean[k] = JSON.stringify(v);
        } else {
          clean[k] = v;
        }
      }
      return clean;
    });

  const addSheet = (data: any[], sheetName: string) => {
    const ws = XLSX.utils.json_to_sheet(sanitize(data));
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  };

  addSheet(users, "Users");
  addSheet(deposits, "Deposits");
  addSheet(pointsTransactions, "PointsTransactions");
  addSheet(vouchers, "Vouchers");
  addSheet(rewardRules, "RewardRules");
  addSheet(voucherRules, "VoucherRules");
  addSheet(devices, "Devices");
  addSheet(depositSessions, "DepositSessions");
  addSheet(leaderboardSettings, "LeaderboardSettings");
  addSheet(monthlyAwards, "MonthlyAwards");
  addSheet(systemLogs, "SystemLogs");
  addSheet(notifications, "Notifications");

  const outputPath = path.resolve(process.cwd(), "fibott_database_export.xlsx");
  XLSX.writeFile(wb, outputPath);

  console.log(`\nSuccessfully created Excel export at: ${outputPath}`);
}

exportDatabase()
  .catch((e) => {
    console.error("Export error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
