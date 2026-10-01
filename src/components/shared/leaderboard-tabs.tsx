import Link from "next/link";
import { LeaderboardTimeframe } from "@/lib/leaderboard";

interface LeaderboardTabsProps {
  current: LeaderboardTimeframe;
  baseUrl?: string;
}

export function LeaderboardTabs({ current, baseUrl = "" }: LeaderboardTabsProps) {
  const tabs: { id: LeaderboardTimeframe; label: string }[] = [
    { id: "all", label: "All-Time" },
    { id: "month", label: "This Month" },
    { id: "week", label: "This Week" },
  ];

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-muted/60 p-1 text-xs font-medium w-fit">
      {tabs.map((tab) => {
        const isActive = current === tab.id;
        const href = `${baseUrl}?timeframe=${tab.id}`;

        return (
          <Link
            key={tab.id}
            href={href}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              isActive
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
