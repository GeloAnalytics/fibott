import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

const MATERIAL_LABEL: Record<string, string> = {
  PET_BOTTLE: "Plastic bottle",
  ALUMINUM_CAN: "Aluminum can",
  REJECTED: "Rejected item",
};

const VOUCHER_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  ISSUED: "default",
  PENDING: "secondary",
  REDEEMED: "secondary",
  EXPIRED: "destructive",
  FAILED: "destructive",
};

export default async function HistoryPage() {
  const session = await auth();
  const userId = session!.user.id;

  const [deposits, vouchers, transactions] = await Promise.all([
    prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { pointsTransaction: { include: { voucher: true } } },
    }),
    prisma.voucher.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { voucherRule: true },
    }),
    prisma.pointsTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { voucher: true },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity & History</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View your past bottle/can recycling deposits and WiFi vouchers (including free admin grants).
        </p>
      </div>

      {/* Section 1: WiFi Vouchers & Admin Grants */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">WiFi Vouchers & Admin Grants</h2>
          <span className="text-xs text-muted-foreground font-medium">{vouchers.length} vouchers</span>
        </div>

        {vouchers.length === 0 ? (
          <EmptyState
            title="No vouchers history"
            description="Vouchers redeemed or granted by admin will appear here."
          />
        ) : (
          <div className="rounded-xl border overflow-x-auto bg-card shadow-2xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Voucher Code</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Cost / Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers.map((voucher) => {
                  const isFreeAdminGrant = voucher.pointsCost === 0;
                  return (
                    <TableRow key={voucher.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatPHT(voucher.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">
                        {voucher.code}
                      </TableCell>
                      <TableCell className="text-xs">
                        {voucher.durationMinutes} min
                      </TableCell>
                      <TableCell className="text-xs">
                        {isFreeAdminGrant ? (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                            🎁 Free Admin Grant
                          </Badge>
                        ) : (
                          <span className="tabular-nums font-medium">{voucher.pointsCost} pts</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={VOUCHER_STATUS_VARIANT[voucher.status] ?? "secondary"}>
                          {voucher.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Section 2: Scan & Deposit History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Scan & Deposit History</h2>
          <span className="text-xs text-muted-foreground font-medium">{deposits.length} deposits</span>
        </div>

        {deposits.length === 0 ? (
          <EmptyState
            title="No deposits yet"
            description="Your bottle and can deposits will show up here once you start recycling."
          />
        ) : (
          <div className="rounded-xl border overflow-x-auto bg-card shadow-2xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Points Awarded</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deposits.map((deposit) => (
                  <TableRow key={deposit.id}>
                    <TableCell className="text-xs whitespace-nowrap">{formatPHT(deposit.createdAt)}</TableCell>
                    <TableCell className="text-xs font-medium">{MATERIAL_LABEL[deposit.materialType] ?? deposit.materialType}</TableCell>
                    <TableCell className="tabular-nums text-xs">{deposit.quantity}</TableCell>
                    <TableCell className="tabular-nums text-xs font-semibold text-emerald-600 dark:text-emerald-400">+{deposit.pointsAwarded}</TableCell>
                    <TableCell>
                      <Badge variant={deposit.status === "ACCEPTED" ? "default" : "destructive"}>
                        {deposit.status}
                      </Badge>
                    </TableCell>
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
