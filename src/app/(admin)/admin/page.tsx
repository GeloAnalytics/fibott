import { prisma } from "@/lib/prisma";
import { StatCard } from "@/components/shared/stat-card";

export default async function AdminDashboardPage() {
  const [totalUsers, activeUsers, totalDeposits, vouchersIssued] = await Promise.all([
    prisma.user.count({ where: { role: "USER" } }),
    prisma.user.count({ where: { role: "USER", status: "ACTIVE" } }),
    prisma.deposit.count({ where: { status: "ACCEPTED" } }),
    prisma.voucher.count({ where: { status: "ISSUED" } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total users"
          value={totalUsers}
          size="lg"
          className="col-span-2"
        />
        <StatCard label="Active users" value={activeUsers} />
        <StatCard label="Vouchers issued" value={vouchersIssued} />
        <StatCard
          label="Total recycled items"
          value={totalDeposits}
          size="lg"
          className="col-span-2 sm:col-span-4"
        />
      </div>
    </div>
  );
}
