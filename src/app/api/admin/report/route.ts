import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [
    totalBottles,
    totalCans,
    totalRejected,
    totalUsers,
    usersWhoDeposited,
    byDay,
    topUsers,
    recentDeposits,
  ] = await Promise.all([
    prisma.deposit.count({ where: { materialType: "PET_BOTTLE", status: "ACCEPTED" } }),
    prisma.deposit.count({ where: { materialType: "ALUMINUM_CAN", status: "ACCEPTED" } }),
    prisma.deposit.count({ where: { status: "REJECTED" } }),
    prisma.user.count({ where: { role: "USER" } }),
    prisma.deposit.findMany({
      where: { status: "ACCEPTED" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    // Last 30 days daily breakdown
    prisma.deposit.groupBy({
      by: ["createdAt"],
      where: {
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        status: "ACCEPTED",
      },
      _count: { id: true },
      orderBy: { createdAt: "asc" },
    }),
    // Top 5 users by total accepted deposits
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
    // Recent 50 accepted deposits
    prisma.deposit.findMany({
      where: { status: "ACCEPTED" },
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
  ]);

  // Bucket by date string for daily chart
  const dailyMap: Record<string, number> = {};
  for (const entry of byDay) {
    const dateKey = entry.createdAt.toISOString().split("T")[0];
    dailyMap[dateKey] = (dailyMap[dateKey] ?? 0) + entry._count.id;
  }
  const daily = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return NextResponse.json({
    summary: {
      totalBottles,
      totalCans,
      totalRejected,
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
    generatedAt: new Date().toISOString(),
  });
}
