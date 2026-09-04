"use client";

import { useEffect, useState, useCallback } from "react";
import { FileDown, Loader2, RefreshCw, Users, Recycle, BarChart3, Trophy } from "lucide-react";

interface Summary {
  totalBottles: number;
  totalCans: number;
  totalRejected: number;
  totalAccepted: number;
  totalUsers: number;
  activeUsers: number;
}

interface DailyEntry {
  date: string;
  count: number;
}

interface TopUser {
  name: string;
  email: string;
  points: number;
  deposits: number;
}

interface RecentDeposit {
  id: string;
  material: string;
  points: number;
  label: string;
  date: string;
  user: string;
}

interface ReportData {
  summary: Summary;
  daily: DailyEntry[];
  topUsers: TopUser[];
  recentDeposits: RecentDeposit[];
  generatedAt: string;
}

function StatBadge({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: number | string;
  sub?: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border bg-card p-5 shadow-sm`}>
      <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${color}`}>
        {icon}
      </div>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value.toLocaleString()}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function AdminReportsClient() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/report");
      if (!res.ok) throw new Error("Failed to load report data");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      fetchData();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchData]);

  const exportPDF = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const now = new Date(data.generatedAt).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "long",
        timeStyle: "short",
      });

      // ── Header ─────────────────────────────────────────────────────────
      doc.setFillColor(16, 185, 129); // emerald-500
      doc.rect(0, 0, pageW, 28, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Fibott Recycling Kiosk Report", 14, 13);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated: ${now}`, 14, 22);

      // ── Summary Stats ──────────────────────────────────────────────────
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("Summary", 14, 38);

      autoTable(doc, {
        startY: 42,
        head: [["Metric", "Value"]],
        body: [
          ["Total Plastic Bottles Recycled", data.summary.totalBottles.toLocaleString()],
          ["Total Aluminum Cans Recycled", data.summary.totalCans.toLocaleString()],
          ["Total Accepted Deposits", data.summary.totalAccepted.toLocaleString()],
          ["Total Rejected Items", data.summary.totalRejected.toLocaleString()],
          ["Total Registered Users", data.summary.totalUsers.toLocaleString()],
          ["Users Who Have Deposited", data.summary.activeUsers.toLocaleString()],
        ],
        headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [240, 253, 244] },
        margin: { left: 14, right: 14 },
      });

      // ── Top Users ──────────────────────────────────────────────────────
      const afterSummary = (doc as InstanceType<typeof jsPDF> & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("Top Users by Points", 14, afterSummary);

      autoTable(doc, {
        startY: afterSummary + 4,
        head: [["#", "Name / Email", "Points Balance", "Total Deposits"]],
        body: data.topUsers.map((u, i) => [
          `#${i + 1}`,
          u.name !== u.email ? `${u.name}\n${u.email}` : u.email,
          u.points.toLocaleString(),
          u.deposits.toString(),
        ]),
        headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [238, 242, 255] },
        margin: { left: 14, right: 14 },
      });

      // ── Recent Deposits ────────────────────────────────────────────────
      const afterTop = (doc as InstanceType<typeof jsPDF> & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("Recent Deposits (Last 50)", 14, afterTop);

      const MATERIAL_LABEL: Record<string, string> = {
        PET_BOTTLE: "Plastic Bottle",
        ALUMINUM_CAN: "Aluminum Can",
        REJECTED: "Rejected",
      };

      autoTable(doc, {
        startY: afterTop + 4,
        head: [["Date (PHT)", "User", "Material", "Points"]],
        body: data.recentDeposits.map((d) => [
          new Date(d.date).toLocaleString("en-PH", {
            timeZone: "Asia/Manila",
            dateStyle: "short",
            timeStyle: "short",
          }),
          d.user,
          MATERIAL_LABEL[d.material] ?? d.material,
          `+${d.points}`,
        ]),
        headStyles: { fillColor: [245, 158, 11], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [255, 251, 235] },
        margin: { left: 14, right: 14 },
      });

      // ── Footer ─────────────────────────────────────────────────────────
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(160, 160, 160);
        doc.text(
          `Fibott Recycling Kiosk System — Page ${i} of ${pageCount}`,
          pageW / 2,
          doc.internal.pageSize.getHeight() - 8,
          { align: "center" }
        );
      }

      doc.save(`fibott-report-${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (err) {
      console.error("PDF export error", err);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">{error ?? "No data available."}</p>
        <button
          onClick={fetchData}
          className="mt-3 text-sm text-primary underline-offset-4 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  const { summary, daily, topUsers, recentDeposits } = data;
  const maxDaily = Math.max(...daily.map((d) => d.count), 1);

  const MATERIAL_LABEL: Record<string, string> = {
    PET_BOTTLE: "🍾 Plastic Bottle",
    ALUMINUM_CAN: "🥤 Aluminum Can",
    REJECTED: "❌ Rejected",
  };

  return (
    <div className="space-y-8">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            Generated:{" "}
            {new Date(data.generatedAt).toLocaleString("en-PH", {
              timeZone: "Asia/Manila",
              dateStyle: "long",
              timeStyle: "short",
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={exportPDF}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            Download PDF Report
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatBadge
          label="Plastic Bottles Recycled"
          value={summary.totalBottles.toLocaleString()}
          color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          icon={<span className="text-base">🍾</span>}
        />
        <StatBadge
          label="Aluminum Cans Recycled"
          value={summary.totalCans.toLocaleString()}
          color="bg-sky-500/10 text-sky-600 dark:text-sky-400"
          icon={<span className="text-base">🥤</span>}
        />
        <StatBadge
          label="Total Accepted Deposits"
          value={summary.totalAccepted.toLocaleString()}
          color="bg-violet-500/10 text-violet-600 dark:text-violet-400"
          icon={<Recycle className="h-5 w-5" />}
        />
        <StatBadge
          label="Rejected Items"
          value={summary.totalRejected.toLocaleString()}
          sub="Did not meet classification threshold"
          color="bg-rose-500/10 text-rose-600 dark:text-rose-400"
          icon={<BarChart3 className="h-5 w-5" />}
        />
        <StatBadge
          label="Registered Users"
          value={summary.totalUsers.toLocaleString()}
          color="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          icon={<Users className="h-5 w-5" />}
        />
        <StatBadge
          label="Users Who Have Deposited"
          value={summary.activeUsers.toLocaleString()}
          sub={`${summary.totalUsers > 0 ? Math.round((summary.activeUsers / summary.totalUsers) * 100) : 0}% of all registered users`}
          color="bg-teal-500/10 text-teal-600 dark:text-teal-400"
          icon={<Trophy className="h-5 w-5" />}
        />
      </div>

      {/* Material Breakdown Bar Chart */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-5 font-semibold">Material Breakdown</h2>
        <div className="space-y-4">
          <BarRow
            label="🍾 Plastic Bottles (PET)"
            value={summary.totalBottles}
            max={summary.totalAccepted}
            color="bg-emerald-500"
          />
          <BarRow
            label="🥤 Aluminum Cans"
            value={summary.totalCans}
            max={summary.totalAccepted}
            color="bg-sky-500"
          />
          <BarRow
            label="❌ Rejected Items"
            value={summary.totalRejected}
            max={summary.totalAccepted + summary.totalRejected}
            color="bg-rose-400"
          />
        </div>
      </div>

      {/* Daily Activity (last 30 days) */}
      {daily.length > 0 && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-5 font-semibold">Daily Activity — Last 30 Days</h2>
          <div className="flex h-40 items-end gap-0.5 overflow-x-auto pb-1">
            {daily.map((d) => {
              const h = maxDaily > 0 ? Math.max(4, Math.round((d.count / maxDaily) * 148)) : 4;
              return (
                <div key={d.date} className="group relative flex flex-1 flex-col items-center">
                  <div
                    className="w-full min-w-[6px] rounded-t bg-emerald-500 opacity-80 transition-opacity group-hover:opacity-100"
                    style={{ height: `${h}px` }}
                  />
                  <span className="absolute -top-5 hidden text-[10px] tabular-nums text-muted-foreground group-hover:block">
                    {d.count}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>{daily[0]?.date}</span>
            <span>{daily[daily.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Top Users */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">Top Users by Points</h2>
        {topUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No user data yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-4">#</th>
                <th className="pb-2 pr-4">User</th>
                <th className="pb-2 pr-4 text-right">Deposits</th>
                <th className="pb-2 text-right">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {topUsers.map((u, i) => (
                <tr key={u.email} className="group">
                  <td className="py-2.5 pr-4 font-bold text-muted-foreground">#{i + 1}</td>
                  <td className="py-2.5 pr-4">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{u.deposits}</td>
                  <td className="py-2.5 text-right font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {u.points.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent Deposits */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">Recent Deposits</h2>
        {recentDeposits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deposits yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">User</th>
                  <th className="pb-2 pr-4">Material</th>
                  <th className="pb-2 text-right">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentDeposits.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">
                      {new Date(d.date).toLocaleString("en-PH", {
                        timeZone: "Asia/Manila",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-2 pr-4">{d.user}</td>
                    <td className="py-2 pr-4">{MATERIAL_LABEL[d.material] ?? d.material}</td>
                    <td className="py-2 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{d.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
