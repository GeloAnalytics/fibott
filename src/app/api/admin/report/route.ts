import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Period = "day" | "week" | "month";

function getPeriodStart(period: Period): Date {
  const now = new Date();
  if (period === "day") return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (period === "week") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // month — default
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const period: Period = (searchParams.get("period") as Period) ?? "month";
  const periodStart = getPeriodStart(period);

  const [
    totalBottles,
    totalCans,
    totalUsers,
    usersWhoDeposited,
    byDay,
    topUsers,
    recentDeposits,
    transactions,
  ] = await Promise.all([
    prisma.deposit.count({
      where: { materialType: "PET_BOTTLE", status: "ACCEPTED", createdAt: { gte: periodStart } },
    }),
    prisma.deposit.count({
      where: { materialType: "ALUMINUM_CAN", status: "ACCEPTED", createdAt: { gte: periodStart } },
    }),
    prisma.user.count({ where: { role: "USER" } }),
    prisma.deposit.findMany({
      where: { status: "ACCEPTED", createdAt: { gte: periodStart } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    // Activity breakdown within the period
    prisma.deposit.groupBy({
      by: ["createdAt"],
      where: {
        createdAt: { gte: periodStart },
        status: "ACCEPTED",
      },
      _count: { id: true },
      orderBy: { createdAt: "asc" },
    }),
    // Top 5 users by points (all-time)
    prisma.user.findMany({
      where: { role: "USER" },
      select: {
        id: true,
        name: true,
        email: true,
        pointsBalance: true,
        _count: { select: { deposits: { where: { status: "ACCEPTED" } } } },
      },
      orderBy: { pointsBalance: "desc" },
      take: 5,
    }),
    // Recent 50 accepted deposits within period
    prisma.deposit.findMany({
      where: { status: "ACCEPTED", createdAt: { gte: periodStart } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        materialType: true,
        pointsAwarded: true,
        classificationLabel: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
    // Points transactions within period
    prisma.pointsTransaction.findMany({
      where: { createdAt: { gte: periodStart } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        source: true,
        note: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
  ]);

  // Bucket by date/hour string for activity chart
  const dailyMap: Record<string, number> = {};
  for (const entry of byDay) {
    let dateKey: string;
    if (period === "day") {
      const d = new Date(entry.createdAt);
      dateKey = `${d.getUTCHours().toString().padStart(2, "0")}:00 UTC`;
    } else {
      dateKey = entry.createdAt.toISOString().split("T")[0];
    }
    dailyMap[dateKey] = (dailyMap[dateKey] ?? 0) + entry._count.id;
  }
  const daily = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return NextResponse.json({
    period,
    summary: {
      totalBottles,
      totalCans,
      totalAccepted: totalBottles + totalCans,
      totalUsers,
      activeUsers: usersWhoDeposited.length,
    },
    daily,
    topUsers: topUsers.map((u) => ({
      name: u.name ?? u.email ?? "Unknown",
      email: u.email ?? "",
      points: u.pointsBalance,
      deposits: u._count.deposits,
    })),
    recentDeposits: recentDeposits.map((d) => ({
      id: d.id,
      material: d.materialType,
      points: d.pointsAwarded,
      label: d.classificationLabel,
      date: d.createdAt.toISOString(),
      user: d.user?.name ?? d.user?.email ?? "Unknown",
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      source: t.source,
      note: t.note ?? "",
      date: t.createdAt.toISOString(),
      user: t.user?.name ?? t.user?.email ?? "Unknown",
    })),
    generatedAt: new Date().toISOString(),
  });
}
