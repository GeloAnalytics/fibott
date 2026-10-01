import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLeaderboardData } from "@/lib/leaderboard";

const awardSchema = z.object({
  year: z.number().int().min(2020).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  force: z.boolean().optional().default(false),
});

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = awardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  const now = new Date();
  const year = parsed.data.year ?? now.getFullYear();
  const month = parsed.data.month ?? (now.getMonth() + 1);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const monthName = MONTH_NAMES[month - 1];

  // 1. Check if award already exists for this month
  const existingAward = await prisma.monthlyLeaderboardAward.findUnique({
    where: { monthKey },
  });

  if (existingAward && !parsed.data.force) {
    return NextResponse.json(
      {
        error: "ALREADY_AWARDED",
        message: `Monthly rewards for ${monthName} ${year} have already been distributed.`,
        award: existingAward,
      },
      { status: 409 }
    );
  }

  // 2. Fetch configured reward amounts
  let settings = await prisma.leaderboardRewardSetting.findUnique({
    where: { id: "default" },
  });
  if (!settings) {
    settings = await prisma.leaderboardRewardSetting.create({
      data: { id: "default", rank1Points: 500, rank2Points: 300, rank3Points: 100 },
    });
  }

  // 3. Fetch top 3 leaderboard users for the specified month
  const leaderboard = await getLeaderboardData("month", { year, month });
  const top3 = leaderboard.slice(0, 3);

  if (top3.length === 0) {
    return NextResponse.json(
      { error: "NO_RECYCLERS", message: `No recycling activity found for ${monthName} ${year}.` },
      { status: 400 }
    );
  }

  const rankPointsMap: Record<number, number> = {
    1: settings.rank1Points,
    2: settings.rank2Points,
    3: settings.rank3Points,
  };

  const awardedWinners: Array<{
    rank: number;
    userId: string;
    userName: string | null;
    email: string | null;
    itemsRecycled: number;
    pointsAwarded: number;
  }> = [];

  // Execute database updates for top winners
  await prisma.$transaction(async (tx) => {
    for (const winner of top3) {
      const pointsToAward = rankPointsMap[winner.rank] ?? 0;
      if (pointsToAward <= 0) continue;

      // Update user points balance
      const updatedUser = await tx.user.update({
        where: { id: winner.userId },
        data: {
          pointsBalance: { increment: pointsToAward },
        },
      });

      // Create PointsTransaction
      await tx.pointsTransaction.create({
        data: {
          userId: winner.userId,
          type: "EARN",
          source: "ADMIN_ADJUSTMENT",
          amount: pointsToAward,
          balanceAfter: updatedUser.pointsBalance,
          note: `🏆 Monthly Leaderboard Award - Rank #${winner.rank} (${monthName} ${year})`,
        },
      });

      // Create Notification
      await tx.notification.create({
        data: {
          userId: winner.userId,
          title: `🏆 Leaderboard Reward: Rank #${winner.rank}!`,
          message: `Congratulations! You achieved Rank #${winner.rank} in the ${monthName} ${year} monthly recycling leaderboard and received ${pointsToAward} free points!`,
          type: "SYSTEM",
        },
      });

      awardedWinners.push({
        rank: winner.rank,
        userId: winner.userId,
        userName: winner.name,
        email: winner.email,
        itemsRecycled: winner.totalItems,
        pointsAwarded: pointsToAward,
      });
    }

    // Record or update award history record
    await tx.monthlyLeaderboardAward.upsert({
      where: { monthKey },
      update: {
        awardedAt: new Date(),
        awardedBy: session.user.id,
        details: awardedWinners as any,
      },
      create: {
        monthKey,
        year,
        month,
        awardedBy: session.user.id,
        details: awardedWinners as any,
      },
    });

    // Record Audit Log
    await tx.auditLog.create({
      data: {
        actorId: session.user.id,
        action: "MONTHLY_LEADERBOARD_REWARDS_AWARDED",
        targetType: "MonthlyLeaderboardAward",
        targetId: monthKey,
        metadata: { monthKey, year, month, winnersCount: awardedWinners.length, awardedWinners },
      },
    });
  });

  return NextResponse.json({
    message: `Successfully awarded free points to Top ${awardedWinners.length} recyclers for ${monthName} ${year}!`,
    monthKey,
    monthName,
    year,
    winners: awardedWinners,
  });
}
