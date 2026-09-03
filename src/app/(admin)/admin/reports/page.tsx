import { AdminReportsClient } from "./reports-client";

export default function AdminReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Recycling Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Full breakdown of bottles, cans, user participation, and deposit history. Export to PDF for sharing.
        </p>
      </div>
      <AdminReportsClient />
    </div>
  );
}
