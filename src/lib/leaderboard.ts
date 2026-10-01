import { prisma } from "@/lib/prisma";

export type LeaderboardTimeframe = "all" | "month" | "week";

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  totalItems: number;
  totalPoints: number;
  depositCount: number;
  lastRecycledAt: Date | null;
}

export async function getLeaderboardData(
  timeframe: LeaderboardTimeframe = "all"
): Promise<LeaderboardEntry[]> {
  let startDate: Date | undefined;
  const now = new Date();
  if (timeframe === "week") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (timeframe === "month") {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const depositsGrouped = await prisma.deposit.groupBy({
    by: ["userId"],
    where: {
      status: "ACCEPTED",
      userId: { not: null },
      ...(startDate ? { createdAt: { gte: startDate } } : {}),
    },
    _sum: {
      quantity: true,
      pointsAwarded: true,
    },
    _count: {
      id: true,
    },
    _max: {
      createdAt: true,
    },
  });

  const userIds = depositsGrouped
    .map((d) => d.userId)
    .filter((id): id is string => id !== null);

  if (userIds.length === 0) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
    },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));

  const sorted = depositsGrouped
    .map((item) => {
      const user = userMap.get(item.userId!);
      return {
        userId: item.userId!,
        name: user?.name ?? null,
        email: user?.email ?? null,
        image: user?.image ?? null,
        totalItems: item._sum.quantity ?? 0,
        totalPoints: item._sum.pointsAwarded ?? 0,
        depositCount: item._count.id ?? 0,
        lastRecycledAt: item._max.createdAt ?? null,
      };
    })
    .sort((a, b) => {
      if (b.totalItems !== a.totalItems) {
        return b.totalItems - a.totalItems;
      }
      return b.totalPoints - a.totalPoints;
    });

  return sorted.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}
