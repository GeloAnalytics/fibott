import { NextResponse } from "next/server";
import { getLeaderboardData, LeaderboardTimeframe } from "@/lib/leaderboard";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const timeframe = (searchParams.get("timeframe") as LeaderboardTimeframe) || "all";

  if (!["all", "month", "week"].includes(timeframe)) {
    return NextResponse.json({ error: "Invalid timeframe" }, { status: 400 });
  }

  const leaderboard = await getLeaderboardData(timeframe);
  return NextResponse.json({ timeframe, leaderboard });
}
