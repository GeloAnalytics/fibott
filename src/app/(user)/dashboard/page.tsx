import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HeroStat } from "@/components/shared/hero-stat";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { RecyclingSession } from "@/components/user/recycling-session";
import { formatDistanceToNow } from "date-fns";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;

  const [user, itemsSubmitted, activeVouchers, recentActivity, cheapestVoucherRule] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.deposit.count({ where: { userId, status: "ACCEPTED" } }),
      prisma.voucher.count({ where: { userId, status: "ISSUED" } }),
      prisma.pointsTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.voucherRule.findFirst({
        where: { isActive: true },
        orderBy: { pointsCost: "asc" },
      }),
    ]);

  let qualifier = "Deposit a bottle or can to start earning points.";
  if (cheapestVoucherRule) {
    const remaining = cheapestVoucherRule.pointsCost - user.pointsBalance;
    qualifier =
      remaining <= 0
        ? `Enough for a ${cheapestVoucherRule.label} voucher right now.`
        : `${remaining} more points until your next ${cheapestVoucherRule.label} voucher.`;
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {/* Primary actions — shown first so they are visible without scrolling on mobile */}
      <div className="space-y-4">
        <div>
          <h2 className="mb-3 text-lg font-medium">Recycle</h2>
          <RecyclingSession />
        </div>

        {activeVouchers === 0 && user.pointsBalance > 0 && (
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard/wallet" className="font-medium text-primary hover:underline">
              Redeem your points for a WiFi voucher →
            </Link>
          </p>
        )}
      </div>

      <HeroStat value={user.pointsBalance} label="Points balance" qualifier={qualifier} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Items recycled" value={itemsSubmitted} />
        <StatCard label="Active vouchers" value={activeVouchers} />
        <StatCard label="Recent transactions" value={recentActivity.length} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">Recent activity</h2>
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
