import Link from "next/link";
import { getLeaderboardData, LeaderboardTimeframe } from "@/lib/leaderboard";
import { prisma } from "@/lib/prisma";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { LeaderboardTabs } from "@/components/shared/leaderboard-tabs";
import { AdminLeaderboardRewardsManager } from "@/components/admin/admin-leaderboard-rewards-manager";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPHT } from "@/lib/date-utils";
import { UserCheck } from "lucide-react";

function getRankBadge(rank: number) {
  if (rank === 1) {
    return (
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-amber-400/20 text-amber-600 dark:text-amber-400 font-bold text-xs ring-1 ring-amber-400/50">
        🥇 1
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-slate-300/30 text-slate-700 dark:text-slate-300 font-bold text-xs ring-1 ring-slate-400/40">
        🥈 2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-amber-700/20 text-amber-800 dark:text-amber-500 font-bold text-xs ring-1 ring-amber-700/40">
        🥉 3
      </span>
    );
  }
  return (
    <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted font-mono font-medium text-xs text-muted-foreground">
      #{rank}
    </span>
  );
}

function getInitials(name?: string | null, email?: string | null) {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) {
    return email.slice(0, 2).toUpperCase();
  }
  return "U";
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default async function AdminLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ timeframe?: string }>;
}) {
  const resolvedParams = await searchParams;
  const timeframe: LeaderboardTimeframe =
    resolvedParams.timeframe === "week" || resolvedParams.timeframe === "month"
      ? resolvedParams.timeframe
      : "all";

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;
  const currentMonthKey = `${currentYear}-${String(currentMonthNum).padStart(2, "0")}`;
  const currentMonthName = MONTH_NAMES[now.getMonth()];

  const [leaderboard, settingsData, pastAwards] = await Promise.all([
    getLeaderboardData(timeframe),
    prisma.leaderboardRewardSetting.findUnique({ where: { id: "default" } }),
    prisma.monthlyLeaderboardAward.findMany({ orderBy: { awardedAt: "desc" }, take: 20 }),
  ]);

  const settings = settingsData ?? {
    rank1Points: 500,
    rank2Points: 300,
    rank3Points: 100,
  };

  const topRecycler = leaderboard[0];
  const totalRecycledInTimeframe = leaderboard.reduce(
    (sum, item) => sum + item.totalItems,
    0
  );
  const totalPointsInTimeframe = leaderboard.reduce(
    (sum, item) => sum + item.totalPoints,
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leaderboard Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Monitor top recyclers, configure monthly rewards, and distribute free points to Top 3 winners.
          </p>
        </div>
        <LeaderboardTabs current={timeframe} baseUrl="/admin/leaderboard" />
      </div>

      {/* Admin Monthly Leaderboard Rewards Management Component */}
      <AdminLeaderboardRewardsManager
        initialSettings={settings}
        initialAwards={pastAwards as any}
        currentMonthKey={currentMonthKey}
        currentMonthName={currentMonthName}
        currentYear={currentYear}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Active recyclers" value={leaderboard.length} />
        <StatCard
          label="Top recycler"
          value={topRecycler ? topRecycler.name || topRecycler.email || "User" : "—"}
        />
        <StatCard label="Total items recycled" value={totalRecycledInTimeframe} />
        <StatCard label="Points awarded" value={totalPointsInTimeframe} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">Recycler Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <EmptyState
            title="No leaderboard data"
            description="No accepted recycling deposits were found for this timeframe."
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">Rank</TableHead>
                  <TableHead>Recycler</TableHead>
                  <TableHead className="text-right">Items Recycled</TableHead>
                  <TableHead className="text-right">Points Earned</TableHead>
                  <TableHead className="text-right">Deposits</TableHead>
                  <TableHead className="text-right">Last Activity</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.map((entry) => {
                  const displayName =
                    entry.name || (entry.email ? entry.email.split("@")[0] : "Recycler");

                  return (
                    <TableRow key={entry.userId}>
                      <TableCell className="text-center font-medium">
                        {getRankBadge(entry.rank)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar size="default">
                            {entry.image && (
                              <AvatarImage src={entry.image} alt={displayName} />
                            )}
                            <AvatarFallback>
                              {getInitials(entry.name, entry.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-foreground">
                              {displayName}
                            </span>
                            {entry.email && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {entry.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {entry.totalItems}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
                        +{entry.totalPoints}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {entry.depositCount}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                        {entry.lastRecycledAt ? formatPHT(entry.lastRecycledAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.email && (
                          <Link href={`/admin/users?q=${encodeURIComponent(entry.email)}`}>
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                              <UserCheck className="size-3 text-muted-foreground" />
                              View User
                            </Button>
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
