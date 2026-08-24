import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/shared/empty-state";
import { RowCountNotice } from "@/components/shared/row-count-notice";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { AdminResetPasswordDialog } from "@/components/admin/admin-reset-password-dialog";

const PAGE_SIZE = 100;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.user.count({ where }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">User Directory</h1>
        <p className="text-sm text-muted-foreground">
          Search and manage recycler accounts and perform admin-assisted password resets.
        </p>
      </div>

      <form method="GET" className="max-w-sm">
        <Input name="q" defaultValue={q} placeholder="Search by name or email" />
      </form>

      {users.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.name ?? "—"}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{user.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.status === "ACTIVE" ? "default" : "destructive"}>
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{user.pointsBalance}</TableCell>
                    <TableCell className="text-right">
                      <AdminResetPasswordDialog user={user} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <RowCountNotice shown={users.length} total={total} />
        </div>
      )}
    </div>
  );
}
