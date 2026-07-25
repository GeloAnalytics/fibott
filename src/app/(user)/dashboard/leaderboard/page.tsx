import { EmptyState } from "@/components/shared/empty-state";

export default function LeaderboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Leaderboard</h1>
      <EmptyState
        title="Leaderboard coming soon"
        description="Weekly and monthly top-recycler rankings will appear here in a future update."
      />
    </div>
  );
}
