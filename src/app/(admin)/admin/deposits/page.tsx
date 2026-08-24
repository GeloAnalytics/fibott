import { prisma } from "@/lib/prisma";
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

const MATERIAL_LABEL: Record<string, string> = {
  PET_BOTTLE: "Plastic bottle",
  ALUMINUM_CAN: "Aluminum can",
  REJECTED: "Rejected item",
};

export default async function AdminDepositsPage() {
  const [deposits, total] = await Promise.all([
    prisma.deposit.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: true },
    }),
    prisma.deposit.count(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Deposit History</h1>

      {deposits.length === 0 ? (
        <EmptyState title="No deposits yet" />
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transaction ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deposits.map((deposit) => (
                  <TableRow key={deposit.id}>
                    <TableCell>{deposit.user?.name ?? deposit.user?.email ?? "—"}</TableCell>
                    <TableCell>{formatPHT(deposit.createdAt)}</TableCell>
                    <TableCell>{MATERIAL_LABEL[deposit.materialType]}</TableCell>
                    <TableCell className="tabular-nums">{deposit.quantity}</TableCell>
                    <TableCell className="tabular-nums">{deposit.pointsAwarded}</TableCell>
                    <TableCell>
                      <Badge variant={deposit.status === "ACCEPTED" ? "default" : "destructive"}>
                        {deposit.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{deposit.id}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <RowCountNotice shown={deposits.length} total={total} />
        </div>
      )}
    </div>
  );
}
