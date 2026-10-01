"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trophy, Gift, Settings, CheckCircle2, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface LeaderboardRewardSetting {
  rank1Points: number;
  rank2Points: number;
  rank3Points: number;
}

interface MonthlyLeaderboardAward {
  id: string;
  monthKey: string;
  year: number;
  month: number;
  awardedAt: string;
  details: any;
}

interface Props {
  initialSettings: LeaderboardRewardSetting;
  initialAwards: MonthlyLeaderboardAward[];
  currentMonthKey: string;
  currentMonthName: string;
  currentYear: number;
}

export function AdminLeaderboardRewardsManager({
  initialSettings,
  initialAwards,
  currentMonthKey,
  currentMonthName,
  currentYear,
}: Props) {
  const router = useRouter();
  const [rank1Points, setRank1Points] = useState(initialSettings.rank1Points);
  const [rank2Points, setRank2Points] = useState(initialSettings.rank2Points);
  const [rank3Points, setRank3Points] = useState(initialSettings.rank3Points);

  const [savingSettings, setSavingSettings] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const [awards, setAwards] = useState<MonthlyLeaderboardAward[]>(initialAwards);

  const currentAward = awards.find((a) => a.monthKey === currentMonthKey);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch("/api/admin/leaderboard/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rank1Points: Number(rank1Points),
          rank2Points: Number(rank2Points),
          rank3Points: Number(rank3Points),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update settings");

      toast.success("Leaderboard reward settings saved successfully!");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAwardMonthlyRewards = async (force: boolean = false) => {
    if (!confirm(`Are you sure you want to award free points to the Top 3 recyclers for ${currentMonthName} ${currentYear}?`)) {
      return;
    }

    setAwarding(true);
    try {
      const res = await fetch("/api/admin/leaderboard/award", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: currentYear,
          force,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.error === "ALREADY_AWARDED" && !force) {
          if (confirm(`${data.message}\n\nDo you want to re-distribute/force award rewards anyway?`)) {
            handleAwardMonthlyRewards(true);
            return;
          }
        }
        throw new Error(data.message || data.error || "Failed to award rewards");
      }

      toast.success(`🎉 ${data.message}`);
      // Refresh state
      const rewardsRes = await fetch("/api/admin/leaderboard/rewards");
      if (rewardsRes.ok) {
        const rewardsData = await rewardsRes.json();
        setAwards(rewardsData.pastAwards || []);
      }
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to distribute awards");
    } finally {
      setAwarding(false);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Card 1: Admin Configuration for Top 3 Monthly Points */}
      <div className="rounded-xl border bg-card p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
            <Settings className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold">Monthly Top 3 Reward Settings</h3>
            <p className="text-xs text-muted-foreground">
              Set the free points given to Top 1, Top 2, and Top 3 recyclers each month.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveSettings} className="space-y-3.5 pt-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                🥇 Rank 1 (Top 1)
              </label>
              <Input
                type="number"
                min="0"
                value={rank1Points}
                onChange={(e) => setRank1Points(Number(e.target.value))}
                className="font-mono text-sm"
                required
              />
              <span className="text-[11px] text-muted-foreground">free points</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1">
                🥈 Rank 2 (Top 2)
              </label>
              <Input
                type="number"
                min="0"
                value={rank2Points}
                onChange={(e) => setRank2Points(Number(e.target.value))}
                className="font-mono text-sm"
                required
              />
              <span className="text-[11px] text-muted-foreground">free points</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-amber-800 dark:text-amber-600 flex items-center gap-1">
                🥉 Rank 3 (Top 3)
              </label>
              <Input
                type="number"
                min="0"
                value={rank3Points}
                onChange={(e) => setRank3Points(Number(e.target.value))}
                className="font-mono text-sm"
                required
              />
              <span className="text-[11px] text-muted-foreground">free points</span>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={savingSettings} size="sm" className="gap-1.5">
              {savingSettings && <Loader2 className="size-3.5 animate-spin" />}
              Save Reward Config
            </Button>
          </div>
        </form>
      </div>

      {/* Card 2: Award Action & Status for Current Month */}
      <div className="rounded-xl border bg-card p-5 shadow-xs space-y-4 flex flex-col justify-between">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
                <Trophy className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold">Award Monthly Leaderboard</h3>
                <p className="text-xs text-muted-foreground">
                  Distribute free points to {currentMonthName} {currentYear}&apos;s Top 3 recyclers.
                </p>
              </div>
            </div>
            {currentAward ? (
              <Badge variant="default" className="bg-emerald-600 text-white gap-1">
                <CheckCircle2 className="size-3" /> Awarded
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <AlertCircle className="size-3 text-amber-500" /> Pending
              </Badge>
            )}
          </div>

          <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-2 border">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Target Period:</span>
              <span className="font-semibold text-foreground">{currentMonthName} {currentYear}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Configured Distribution:</span>
              <span className="font-mono font-medium text-foreground">
                🥇 {rank1Points} pts | 🥈 {rank2Points} pts | 🥉 {rank3Points} pts
              </span>
            </div>
            {currentAward && (
              <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 font-medium pt-1 border-t border-border/60">
                <span>Awarded Date:</span>
                <span>{new Date(currentAward.awardedAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button
            onClick={() => handleAwardMonthlyRewards(false)}
            disabled={awarding}
            className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold gap-2"
          >
            {awarding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {currentAward ? "Re-Award Top 3 Recyclers" : `Award Top 3 Recyclers (${currentMonthName})`}
          </Button>
        </div>
      </div>
    </div>
  );
}
