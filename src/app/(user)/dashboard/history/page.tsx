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
import { format } from "date-fns";

const MATERIAL_LABEL: Record<string, string> = {
  PET_BOTTLE: "Plastic bottle",
  ALUMINUM_CAN: "Aluminum can",
  REJECTED: "Rejected item",
};

export default async function HistoryPage() {
  const session = await auth();
  const userId = session!.user.id;

  const deposits = await prisma.deposit.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { pointsTransaction: { include: { voucher: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Scan & Deposit History</h1>

      {deposits.length === 0 ? (
        <EmptyState
          title="No deposits yet"
          description="Your bottle and can deposits will show up here once you start recycling."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Points</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposits.map((deposit) => (
                <TableRow key={deposit.id}>
                  <TableCell>{format(deposit.createdAt, "MMM d, yyyy h:mm a")}</TableCell>
                  <TableCell>{MATERIAL_LABEL[deposit.materialType]}</TableCell>
                  <TableCell className="tabular-nums">{deposit.quantity}</TableCell>
                  <TableCell className="tabular-nums">{deposit.pointsAwarded}</TableCell>
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
  );
}
