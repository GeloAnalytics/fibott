import { prisma } from "@/lib/prisma";
import { expireStaleVouchers } from "@/lib/voucher";
import { EmptyState } from "@/components/shared/empty-state";
import { RowCountNotice } from "@/components/shared/row-count-notice";
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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  ISSUED: "default",
  PENDING: "secondary",
  REDEEMED: "secondary",
  EXPIRED: "destructive",
  FAILED: "destructive",
};

export default async function AdminVouchersPage() {
  await expireStaleVouchers();

  const [vouchers, total] = await Promise.all([
    prisma.voucher.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: true },
    }),
    prisma.voucher.count(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Voucher Management</h1>

      {vouchers.length === 0 ? (
        <EmptyState
          title="No vouchers yet"
          description="Vouchers appear here once users redeem points for WiFi access."
        />
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Points cost</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers.map((voucher) => (
                  <TableRow key={voucher.id}>
                    <TableCell>{voucher.user?.name ?? voucher.user?.email ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{voucher.code}</TableCell>
                    <TableCell className="tabular-nums">{voucher.pointsCost}</TableCell>
                    <TableCell className="tabular-nums">{voucher.durationMinutes} min</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[voucher.status] ?? "secondary"}>
                        {voucher.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {voucher.issuedAt ? formatPHT(voucher.issuedAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <RowCountNotice shown={vouchers.length} total={total} />
        </div>
      )}
    </div>
  );
}
