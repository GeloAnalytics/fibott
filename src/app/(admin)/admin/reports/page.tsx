import { EmptyState } from "@/components/shared/empty-state";

export default function AdminReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <EmptyState
        title="Reports coming soon"
        description="Daily reports, monthly recycling trends, and voucher redemption analytics will appear here."
      />
    </div>
  );
}
