"use client";

import { useEffect, useState, useCallback } from "react";
import {
  FileDown,
  Loader2,
  RefreshCw,
  Users,
  Recycle,
  BarChart3,
  Trophy,
  ArrowUpRight,
  ArrowDownLeft,
  SlidersHorizontal,
} from "lucide-react";
import type { jsPDF } from "jspdf";

type Period = "day" | "week" | "month";

interface Summary {
  totalBottles: number;
  totalCans: number;
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

interface Transaction {
  id: string;
  type: "EARN" | "SPEND" | "ADJUSTMENT";
  amount: number;
  balanceAfter: number;
  source: "DEPOSIT" | "VOUCHER_REDEMPTION" | "ADMIN_ADJUSTMENT";
  note: string;
  date: string;
  user: string;
}

interface ReportData {
  period: Period;
  summary: Summary;
  daily: DailyEntry[];
  topUsers: TopUser[];
  recentDeposits: RecentDeposit[];
  transactions: Transaction[];
  generatedAt: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "short",
    timeStyle: "short",
  });
}

const MATERIAL_LABEL: Record<string, string> = {
  PET_BOTTLE: "Plastic Bottle",
  ALUMINUM_CAN: "Aluminum Can",
};

const SOURCE_LABEL: Record<string, string> = {
  DEPOSIT: "Deposit",
  VOUCHER_REDEMPTION: "Voucher",
  ADMIN_ADJUSTMENT: "Admin",
};

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
    <div className="rounded-xl border bg-card p-3.5 sm:p-5 shadow-sm">
      <div className={`mb-2 flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg ${color}`}>
        {icon}
      </div>
      <p className="text-2xl sm:text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs sm:text-sm font-medium text-foreground">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] sm:text-xs text-muted-foreground">{sub}</p>}
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

function PrintButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void;
  loading: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-muted disabled:opacity-60 transition-colors"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

export function AdminReportsClient() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [exportingSummary, setExportingSummary] = useState(false);
  const [exportingDeposits, setExportingDeposits] = useState(false);
  const [exportingTransactions, setExportingTransactions] = useState(false);
  const [exportingTopUsers, setExportingTopUsers] = useState(false);

  const fetchData = useCallback(
    async (p: Period = period) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/report?period=${p}`);
        if (!res.ok) throw new Error("Failed to load report data");
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [period]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => fetchData(period), 0);
    return () => window.clearTimeout(timeout);
  }, [period, fetchData]);

  const makePDF = async () => {
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    return { doc, pageW, autoTable };
  };

  const addHeader = (doc: jsPDF, pageW: number, title: string, subtitle: string) => {
    doc.setFillColor(16, 185, 129);
    doc.rect(0, 0, pageW, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text(title, 14, 13);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(subtitle, 14, 22);
  };

  const addFooter = (doc: jsPDF, pageW: number) => {
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
  };

  const periodLabel = period === "day" ? "Last 24 Hours" : period === "week" ? "Last 7 Days" : "Last 30 Days";
  const genNow = (iso: string) =>
    new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" });

  const exportSummaryPDF = async () => {
    if (!data) return;
    setExportingSummary(true);
    try {
      const { doc, pageW, autoTable } = await makePDF();
      addHeader(doc, pageW, "Fibott - Summary Report", `Generated: ${genNow(data.generatedAt)} | Period: ${periodLabel}`);
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("Summary Statistics", 14, 38);
      autoTable(doc, {
        startY: 42,
        head: [["Metric", "Value"]],
        body: [
          ["Total Plastic Bottles Recycled", data.summary.totalBottles.toLocaleString()],
          ["Total Aluminum Cans Recycled", data.summary.totalCans.toLocaleString()],
          ["Total Accepted Deposits", data.summary.totalAccepted.toLocaleString()],
          ["Registered Users", data.summary.totalUsers.toLocaleString()],
          ["Active Recyclers (period)", data.summary.activeUsers.toLocaleString()],
        ],
        headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [240, 253, 244] },
        margin: { left: 14, right: 14 },
      });
      addFooter(doc, pageW);
      doc.save(`fibott-summary-${period}-${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (err) {
      console.error("PDF export error", err);
    } finally {
      setExportingSummary(false);
    }
  };

  const exportTopUsersPDF = async () => {
    if (!data) return;
    setExportingTopUsers(true);
    try {
      const { doc, pageW, autoTable } = await makePDF();
      addHeader(doc, pageW, "Fibott - Top Users Report", `Generated: ${genNow(data.generatedAt)}`);
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("Top Users by Points", 14, 38);
      autoTable(doc, {
        startY: 42,
        head: [["#", "Name / Email", "Points Balance", "Total Deposits"]],
        body:
          data.topUsers.length > 0
            ? data.topUsers.map((u, i) => [
                `#${i + 1}`,
                u.name !== u.email ? `${u.name}\n${u.email}` : u.email,
                u.points.toLocaleString(),
                u.deposits.toString(),
              ])
            : [["-", "No top user data recorded", "-", "-"]],
        headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [238, 242, 255] },
        margin: { left: 14, right: 14 },
      });
      addFooter(doc, pageW);
      doc.save(`fibott-top-users-${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (err) {
      console.error("PDF export error", err);
    } finally {
      setExportingTopUsers(false);
    }
  };

  const exportDepositsPDF = async () => {
    if (!data) return;
    setExportingDeposits(true);
    try {
      const { doc, pageW, autoTable } = await makePDF();
      addHeader(doc, pageW, "Fibott - Deposits Report", `Generated: ${genNow(data.generatedAt)} | Period: ${periodLabel}`);
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text(`Recent Deposits (${periodLabel})`, 14, 38);
      autoTable(doc, {
        startY: 42,
        head: [["Date (PHT)", "User", "Material", "Points"]],
        body:
          data.recentDeposits.length > 0
            ? data.recentDeposits.map((d) => [
                fmtDate(d.date),
                d.user,
                MATERIAL_LABEL[d.material] ?? d.material,
                `+${d.points}`,
              ])
            : [["-", "No deposits recorded in this period", "-", "-"]],
        headStyles: { fillColor: [245, 158, 11], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [255, 251, 235] },
        margin: { left: 14, right: 14 },
      });
      addFooter(doc, pageW);
      doc.save(`fibott-deposits-${period}-${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (err) {
      console.error("PDF export error", err);
    } finally {
      setExportingDeposits(false);
    }
  };

  const exportTransactionsPDF = async () => {
    if (!data) return;
    setExportingTransactions(true);
    try {
      const { doc, pageW, autoTable } = await makePDF();
      addHeader(doc, pageW, "Fibott - Transaction History", `Generated: ${genNow(data.generatedAt)} | Period: ${periodLabel}`);
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text(`Transaction History (${periodLabel})`, 14, 38);
      autoTable(doc, {
        startY: 42,
        head: [["Date (PHT)", "User", "Type", "Source", "Amount", "Balance After", "Note"]],
        body:
          data.transactions.length > 0
            ? data.transactions.map((t) => [
                fmtDate(t.date),
                t.user,
                t.type,
                SOURCE_LABEL[t.source] ?? t.source,
                t.type === "EARN" ? `+${t.amount}` : `-${t.amount}`,
                t.balanceAfter.toLocaleString(),
                t.note || "-",
              ])
            : [["-", "No transactions recorded in this period", "-", "-", "-", "-", "-"]],
        headStyles: { fillColor: [20, 184, 166], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [240, 253, 250] },
        margin: { left: 14, right: 14 },
        styles: { fontSize: 8 },
        columnStyles: { 6: { cellWidth: 40 } },
      });
      addFooter(doc, pageW);
      doc.save(`fibott-transactions-${period}-${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (err) {
      console.error("PDF export error", err);
    } finally {
      setExportingTransactions(false);
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
          onClick={() => fetchData(period)}
          className="mt-3 text-sm text-primary underline-offset-4 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  const { summary, daily, topUsers, recentDeposits, transactions } = data;
  const maxDaily = Math.max(...daily.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Generated:{" "}
          {new Date(data.generatedAt).toLocaleString("en-PH", {
            timeZone: "Asia/Manila",
            dateStyle: "long",
            timeStyle: "short",
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-sm">
            <SlidersHorizontal className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" />
            {(["day", "week", "month"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                  period === p
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "day" ? "Today" : p === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
          <button
            onClick={() => fetchData(period)}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs sm:text-sm font-medium shadow-sm hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
          <h2 className="font-semibold text-base sm:text-lg">Summary</h2>
          <PrintButton onClick={exportSummaryPDF} loading={exportingSummary} label="Export PDF" />
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatBadge
              label="Plastic Bottles"
              value={summary.totalBottles.toLocaleString()}
              color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              icon={<span className="text-base">🍾</span>}
            />
            <StatBadge
              label="Aluminum Cans"
              value={summary.totalCans.toLocaleString()}
              color="bg-sky-500/10 text-sky-600 dark:text-sky-400"
              icon={<span className="text-base">🥤</span>}
            />
            <StatBadge
              label="Accepted Deposits"
              value={summary.totalAccepted.toLocaleString()}
              color="bg-violet-500/10 text-violet-600 dark:text-violet-400"
              icon={<Recycle className="h-5 w-5" />}
            />
            <StatBadge
              label="Registered Users"
              value={summary.totalUsers.toLocaleString()}
              color="bg-amber-500/10 text-amber-600 dark:text-amber-400"
              icon={<Users className="h-5 w-5" />}
            />
          </div>
          <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Material Breakdown</h3>
            <BarRow label="Plastic Bottles (PET)" value={summary.totalBottles} max={summary.totalAccepted} color="bg-emerald-500" />
            <BarRow label="Aluminum Cans" value={summary.totalCans} max={summary.totalAccepted} color="bg-sky-500" />
          </div>
          <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{summary.activeUsers.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">
                Active Recyclers this period -{" "}
                {summary.totalUsers > 0 ? Math.round((summary.activeUsers / summary.totalUsers) * 100) : 0}% of registered users
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Chart */}
      {daily.length > 0 && (
        <div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
          <h2 className="mb-4 font-semibold text-base sm:text-lg">
            Activity - {period === "day" ? "Last 24 Hours" : period === "week" ? "Last 7 Days" : "Last 30 Days"}
          </h2>
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
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
          <h2 className="font-semibold">Top Users by Points</h2>
          <PrintButton onClick={exportTopUsersPDF} loading={exportingTopUsers} label="Export PDF" />
        </div>
        <div className="p-4 sm:p-6">
          {topUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No user data yet.</p>
          ) : (
            <div className="overflow-x-auto">
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
                    <tr key={u.email}>
                      <td className="py-2.5 pr-4 font-bold text-muted-foreground">#{i + 1}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
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
            </div>
          )}
        </div>
      </div>

      {/* Recent Deposits */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
          <h2 className="font-semibold">
            Recent Deposits
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({period === "day" ? "Last 24h" : period === "week" ? "Last 7 days" : "Last 30 days"})
            </span>
          </h2>
          <PrintButton onClick={exportDepositsPDF} loading={exportingDeposits} label="Export PDF" />
        </div>
        <div className="p-4 sm:p-6">
          {recentDeposits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deposits in this period.</p>
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
                      <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(d.date)}</td>
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

      {/* Transaction History */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
          <h2 className="font-semibold">
            Transaction History
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({period === "day" ? "Last 24h" : period === "week" ? "Last 7 days" : "Last 30 days"})
            </span>
          </h2>
          <PrintButton onClick={exportTransactionsPDF} loading={exportingTransactions} label="Export PDF" />
        </div>
        <div className="p-4 sm:p-6">
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">User</th>
                    <th className="pb-2 pr-4">Source</th>
                    <th className="pb-2 pr-4 text-right">Amount</th>
                    <th className="pb-2 pr-4 text-right">Balance After</th>
                    <th className="pb-2">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(t.date)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{t.user}</td>
                      <td className="py-2 pr-4">
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                          {SOURCE_LABEL[t.source] ?? t.source}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                        <span
                          className={`flex items-center justify-end gap-1 ${
                            t.type === "EARN"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : t.type === "SPEND"
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {t.type === "EARN" ? (
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          ) : t.type === "SPEND" ? (
                            <ArrowDownLeft className="h-3.5 w-3.5" />
                          ) : (
                            <BarChart3 className="h-3.5 w-3.5" />
                          )}
                          {t.type === "EARN" ? "+" : t.type === "SPEND" ? "-" : ""}
                          {t.amount.toLocaleString()}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        {t.balanceAfter.toLocaleString()}
                      </td>
                      <td className="py-2 max-w-[160px] truncate text-xs text-muted-foreground">
                        {t.note || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
