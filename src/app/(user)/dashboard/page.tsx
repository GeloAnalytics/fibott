import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { RecyclingSession } from "@/components/user/recycling-session";
import { ExchangeRatesCard } from "@/components/user/exchange-rates-card";
import { VoucherActions } from "@/components/user/voucher-actions";
import { formatDistanceToNow } from "date-fns";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;

  const [user, itemsSubmitted, activeVouchersList, recentActivity, cheapestVoucherRule, rewardRules, voucherRules] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.deposit.count({ where: { userId, status: "ACCEPTED" } }),
      prisma.voucher.findMany({
        where: { userId, status: { in: ["ISSUED", "PENDING"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.pointsTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.voucherRule.findFirst({
        where: { isActive: true },
        orderBy: { pointsCost: "asc" },
      }),
      prisma.rewardRule.findMany({
        where: { isActive: true },
        orderBy: { materialType: "asc" },
      }),
      prisma.voucherRule.findMany({
        where: { isActive: true },
        orderBy: { pointsCost: "asc" },
      }),
    ]);

  const activeVouchers = activeVouchersList.length;

  let qualifier = "Deposit a bottle or can to start earning points.";
  if (cheapestVoucherRule) {
    const remaining = cheapestVoucherRule.pointsCost - user.pointsBalance;
    qualifier =
      remaining <= 0
        ? `Enough for a ${cheapestVoucherRule.label} voucher right now.`
        : `${remaining} more points until your next ${cheapestVoucherRule.label} voucher.`;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-semibold">Dashboard</h1>

      {/* Live Exchange Rates */}
      <ExchangeRatesCard rewardRules={rewardRules} voucherRules={voucherRules} />

      {/* Active vouchers — shown prominently if user has any */}
      {activeVouchersList.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base sm:text-lg font-medium">Your Active Vouchers</h2>
          {activeVouchersList.map((voucher) => (
            <div key={voucher.id} className="rounded-lg border bg-card p-3.5 sm:p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-mono text-sm font-semibold tracking-wider break-all">
                  {voucher.code}
                </p>
                <Badge variant={voucher.status === "ISSUED" ? "default" : "secondary"}>
                  {voucher.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{voucher.durationMinutes} min WiFi</p>
              {voucher.status === "ISSUED" && (
                <div className="pt-1 border-t border-border/50">
                  <VoucherActions code={voucher.code} variant="compact" />
                </div>
              )}
              {voucher.status === "PENDING" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  ⏳ Being activated on the router — will be ready shortly.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Primary actions — shown first so they are visible without scrolling on mobile */}
      <div className="space-y-3">
        <div>
          <h2 className="mb-2.5 text-base sm:text-lg font-medium">Recycle</h2>
          <RecyclingSession />
        </div>

        {activeVouchers === 0 && user.pointsBalance > 0 && (
          <p className="text-xs sm:text-sm text-muted-foreground">
            <Link href="/dashboard/wallet" className="font-medium text-primary hover:underline">
              Redeem your points for a WiFi voucher →
            </Link>
          </p>
        )}
      </div>

      {/* Balance & Quick Stats Card */}
      <div className="rounded-2xl border bg-gradient-to-br from-card to-secondary/30 p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Points Balance</span>
          <span className="text-xs font-medium text-muted-foreground">{qualifier}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-primary tabular-nums">
            {user.pointsBalance}
          </span>
          <span className="text-xs sm:text-sm font-semibold text-muted-foreground">points</span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-border/60 text-center">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground">Recycled</span>
            <span className="text-sm font-bold tabular-nums text-foreground">{itemsSubmitted}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground">Vouchers</span>
            <span className="text-sm font-bold tabular-nums text-foreground">{activeVouchers}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground">Activity</span>
            <span className="text-sm font-bold tabular-nums text-foreground">{recentActivity.length}</span>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base sm:text-lg font-medium">Recent activity</h2>
        {recentActivity.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Deposit a bottle or can at a Fibott machine to start earning points."
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {recentActivity.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p
                    className={
                      tx.type === "EARN"
                        ? "text-sm font-semibold text-reward-foreground tabular-nums"
                        : "text-sm font-medium tabular-nums"
                    }
                  >
                    {tx.type === "EARN" ? "+" : tx.type === "SPEND" ? "-" : "±"}
                    {tx.amount} points
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(tx.createdAt, { addSuffix: true })}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground tabular-nums">
                  Balance: {tx.balanceAfter}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
