import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { expireStaleVouchers } from "@/lib/voucher";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPHT } from "@/lib/date-utils";
import { RedeemSection } from "./redeem-section";
import { VoucherActions } from "@/components/user/voucher-actions";

const VOUCHER_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  ISSUED: "default",
  PENDING: "secondary",
  REDEEMED: "secondary",
  EXPIRED: "destructive",
  FAILED: "destructive",
};

export default async function WalletPage() {
  const session = await auth();
  const userId = session!.user.id;

  await expireStaleVouchers();

  const [user, transactions, voucherRules, vouchers] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.pointsTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.voucherRule.findMany({
      where: { isActive: true },
      orderBy: { pointsCost: "asc" },
    }),
    prisma.voucher.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const earned = transactions
    .filter(
      (t) =>
        t.type === "EARN" ||
        (t.type === "ADJUSTMENT" && t.source === "ADMIN_ADJUSTMENT")
    )
    .reduce((sum, t) => sum + t.amount, 0);

  // ADJUSTMENT transactions with source VOUCHER_REDEMPTION are refunds for spends whose voucher issuance
  // failed (see refundPoints in src/lib/points.ts) — net them out so a
  // failed-then-refunded redemption doesn't look like points were spent.
  const refunded = transactions
    .filter((t) => t.type === "ADJUSTMENT" && t.source === "VOUCHER_REDEMPTION")
    .reduce((sum, t) => sum + t.amount, 0);

  const spent = Math.max(
    0,
    transactions
      .filter((t) => t.type === "SPEND")
      .reduce((sum, t) => sum + t.amount, 0) - refunded
  );

  return (
    <div className="space-y-5">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Points Wallet</h1>

      {/* Unified Wallet Balance Card */}
      <div className="rounded-2xl border bg-gradient-to-br from-card to-secondary/30 p-4 sm:p-6 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current Balance</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-primary tabular-nums">
            {user.pointsBalance}
          </span>
          <span className="text-xs sm:text-sm font-semibold text-muted-foreground">points</span>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-border/60">
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-muted-foreground">Total Earned</span>
            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">+{earned} pts</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-muted-foreground">Total Spent</span>
            <span className="text-sm font-bold text-foreground tabular-nums">-{spent} pts</span>
          </div>
        </div>
      </div>

      <RedeemSection rules={voucherRules} pointsBalance={user.pointsBalance} />

      <div>
        <h2 className="mb-3 text-base sm:text-lg font-medium">My vouchers</h2>
        {vouchers.length === 0 ? (
          <EmptyState
            title="No vouchers yet"
            description="Redeem points above to get your first WiFi voucher."
          />
        ) : (
          <div className="space-y-3">
            {vouchers.map((voucher) => (
              <div
                key={voucher.id}
                className="rounded-lg border bg-card p-3.5 sm:p-4 space-y-2.5"
              >
                {/* Top row: code + status */}
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <p className="font-mono text-sm font-semibold tracking-wider break-all">
                    {voucher.code}
                  </p>
                  <Badge variant={VOUCHER_STATUS_VARIANT[voucher.status] ?? "secondary"}>
                    {voucher.status}
                  </Badge>
                </div>

                {/* Meta row: duration + issued date */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  <span>{voucher.durationMinutes} min</span>
                  {voucher.issuedAt && (
                    <span>Issued {formatPHT(voucher.issuedAt)}</span>
                  )}
                </div>

                {/* Actions */}
                {voucher.status !== "FAILED" && voucher.status !== "EXPIRED" && (
                  <div className="pt-1 border-t border-border/50">
                    <VoucherActions code={voucher.code} variant="compact" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-base sm:text-lg font-medium">Transaction history</h2>
        {transactions.length === 0 ? (
          <EmptyState title="No transactions yet" />
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Source</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Balance after</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-xs whitespace-nowrap">{formatPHT(tx.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={tx.type === "EARN" ? "default" : "secondary"} className="text-[11px] px-1.5 py-0.5">
                        {tx.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{tx.source.replace(/_/g, " ")}</TableCell>
                    <TableCell className="tabular-nums text-xs font-semibold">
                      {tx.type === "SPEND" ? "-" : "+"}
                      {tx.amount}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">{tx.balanceAfter}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
