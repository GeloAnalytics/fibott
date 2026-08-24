import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { expireStaleVouchers } from "@/lib/voucher";
import { HeroStat } from "@/components/shared/hero-stat";
import { StatCard } from "@/components/shared/stat-card";
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
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Points Wallet</h1>

      <HeroStat
        value={user.pointsBalance}
        label="Current balance"
        qualifier={`${earned} points earned overall, ${spent} spent on vouchers so far.`}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Points earned" value={earned} />
        <StatCard label="Points spent" value={spent} />
      </div>

      <RedeemSection rules={voucherRules} pointsBalance={user.pointsBalance} />

      <div>
        <h2 className="mb-3 text-lg font-medium">My vouchers</h2>
        {vouchers.length === 0 ? (
          <EmptyState
            title="No vouchers yet"
            description="Redeem points above to get your first WiFi voucher."
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers.map((voucher) => (
                  <TableRow key={voucher.id}>
                    <TableCell className="font-mono">{voucher.code}</TableCell>
                    <TableCell className="tabular-nums">{voucher.durationMinutes} min</TableCell>
                    <TableCell>
                      <Badge variant={VOUCHER_STATUS_VARIANT[voucher.status] ?? "secondary"}>
                        {voucher.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {voucher.issuedAt
                        ? formatPHT(voucher.issuedAt)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">Transaction history</h2>
        {transactions.length === 0 ? (
          <EmptyState title="No transactions yet" />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Balance after</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>{formatPHT(tx.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={tx.type === "EARN" ? "default" : "secondary"}>
                        {tx.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{tx.source.replace(/_/g, " ")}</TableCell>
                    <TableCell className="tabular-nums">
                      {tx.type === "SPEND" ? "-" : "+"}
                      {tx.amount}
                    </TableCell>
                    <TableCell className="tabular-nums">{tx.balanceAfter}</TableCell>
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
