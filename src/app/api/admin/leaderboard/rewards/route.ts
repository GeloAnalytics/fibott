import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  rank1Points: z.number().int().min(0),
  rank2Points: z.number().int().min(0),
  rank3Points: z.number().int().min(0),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let settings = await prisma.leaderboardRewardSetting.findUnique({
    where: { id: "default" },
  });

  if (!settings) {
    settings = await prisma.leaderboardRewardSetting.create({
      data: {
        id: "default",
        rank1Points: 500,
        rank2Points: 300,
        rank3Points: 100,
      },
    });
  }

  const pastAwards = await prisma.monthlyLeaderboardAward.findMany({
    orderBy: { awardedAt: "desc" },
    take: 24,
  });

  return NextResponse.json({ settings, pastAwards });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.format() }, { status: 400 });
  }

  const { rank1Points, rank2Points, rank3Points } = parsed.data;

  const settings = await prisma.leaderboardRewardSetting.upsert({
    where: { id: "default" },
    update: { rank1Points, rank2Points, rank3Points },
    create: { id: "default", rank1Points, rank2Points, rank3Points },
  });

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: "LEADERBOARD_REWARD_SETTINGS_UPDATED",
      targetType: "LeaderboardRewardSetting",
      targetId: "default",
      metadata: { rank1Points, rank2Points, rank3Points },
    },
  });

  return NextResponse.json({ message: "Leaderboard reward settings updated successfully", settings });
}
