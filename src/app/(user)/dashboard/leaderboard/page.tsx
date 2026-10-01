import { auth } from "@/lib/auth";
import { getLeaderboardData, LeaderboardTimeframe } from "@/lib/leaderboard";
import { prisma } from "@/lib/prisma";
import { HeroStat } from "@/components/shared/hero-stat";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { LeaderboardTabs } from "@/components/shared/leaderboard-tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trophy, Gift, Sparkles } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPHT } from "@/lib/date-utils";

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

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ timeframe?: string }>;
}) {
  const session = await auth();
  const currentUserId = session?.user.id;

  const resolvedParams = await searchParams;
  const timeframe: LeaderboardTimeframe =
    resolvedParams.timeframe === "week" || resolvedParams.timeframe === "month"
      ? resolvedParams.timeframe
      : "all";

  const [leaderboard, settingsData] = await Promise.all([
    getLeaderboardData(timeframe),
    prisma.leaderboardRewardSetting.findUnique({ where: { id: "default" } }),
  ]);

  const settings = settingsData ?? {
    rank1Points: 500,
    rank2Points: 300,
    rank3Points: 100,
  };

  const myEntry = leaderboard.find((entry) => entry.userId === currentUserId);
  const totalRecycledInTimeframe = leaderboard.reduce(
    (sum, item) => sum + item.totalItems,
    0
  );

  let qualifier = "Top recyclers earning points by recycling bottles and cans.";
  if (myEntry) {
    qualifier = `You are currently ranked #${myEntry.rank} with ${myEntry.totalItems} items recycled!`;
  } else if (currentUserId) {
    qualifier = "Recycle a bottle or can to claim your spot on the leaderboard!";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leaderboard</h1>
          <p className="text-sm text-muted-foreground">
            Top recycler rankings based on accepted deposit activity.
          </p>
        </div>
        <LeaderboardTabs current={timeframe} baseUrl="/dashboard/leaderboard" />
      </div>

      {/* Monthly Rewards Announcement Banner */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-emerald-500/10 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-500/20 p-2.5 text-amber-600 dark:text-amber-400 shrink-0">
              <Trophy className="size-6" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-foreground">Monthly Top 3 Recycler Rewards</h2>
                <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-xs">
                  <Sparkles className="size-3 mr-1" /> Free Bonus Points
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Recycle bottles & cans to climb the monthly leaderboard! The top 3 recyclers each month earn free reward points set by Admin.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 bg-background/80 backdrop-blur-xs rounded-xl p-2.5 border shrink-0 justify-around sm:justify-start">
            <div className="text-center px-2">
              <span className="text-xs block text-amber-600 dark:text-amber-400 font-bold">🥇 1st</span>
              <span className="font-mono text-sm font-extrabold text-foreground">+{settings.rank1Points} pts</span>
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="text-center px-2">
              <span className="text-xs block text-slate-500 dark:text-slate-400 font-bold">🥈 2nd</span>
              <span className="font-mono text-sm font-extrabold text-foreground">+{settings.rank2Points} pts</span>
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="text-center px-2">
              <span className="text-xs block text-amber-700 dark:text-amber-500 font-bold">🥉 3rd</span>
              <span className="font-mono text-sm font-extrabold text-foreground">+{settings.rank3Points} pts</span>
            </div>
          </div>
        </div>
      </div>

      <HeroStat
        value={myEntry?.rank ?? 0}
        label={myEntry ? `Your current rank (#${myEntry.rank})` : "Your current rank (Unranked)"}
        qualifier={qualifier}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Active recyclers" value={leaderboard.length} />
        <StatCard label="Total items recycled" value={totalRecycledInTimeframe} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">Rankings</h2>
        {leaderboard.length === 0 ? (
          <EmptyState
            title="No recycling rankings yet"
            description="No accepted deposits recorded for this timeframe. Be the first to recycle!"
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
                  <TableHead className="text-right hidden sm:table-cell">Last Deposit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.map((entry) => {
                  const isCurrentUser = entry.userId === currentUserId;
                  const displayName =
                    entry.name || (entry.email ? entry.email.split("@")[0] : "Recycler");

                  return (
                    <TableRow
                      key={entry.userId}
                      className={isCurrentUser ? "bg-primary/5 font-medium" : undefined}
                    >
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
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">
                                {displayName}
                              </span>
                              {isCurrentUser && (
                                <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                                  You
                                </Badge>
                              )}
                              {entry.rank <= 3 && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                                  Top {entry.rank} Winner Candidate
                                </Badge>
                              )}
                            </div>
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
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums hidden sm:table-cell">
                        {entry.lastRecycledAt ? formatPHT(entry.lastRecycledAt) : "—"}
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
