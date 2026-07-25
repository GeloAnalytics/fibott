import { EmptyState } from "@/components/shared/empty-state";

export default function AdminNotificationsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <EmptyState
        title="Notification management coming soon"
        description="Broadcasting announcements and per-user notifications will be available in a future update."
      />
    </div>
  );
}
