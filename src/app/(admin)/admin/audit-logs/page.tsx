import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/shared/empty-state";
import { RowCountNotice } from "@/components/shared/row-count-notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

export default async function AdminAuditLogsPage() {
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { actor: true },
    }),
    prisma.auditLog.count(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Audit Logs</h1>

      {logs.length === 0 ? (
        <EmptyState
          title="No audit log entries yet"
          description="Admin actions like editing reward rules will be recorded here."
        />
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{format(log.createdAt, "MMM d, yyyy h:mm a")}</TableCell>
                    <TableCell>{log.actor.name ?? log.actor.email}</TableCell>
                    <TableCell>{log.action.replace(/_/g, " ")}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.targetType}
                      {log.targetId ? ` · ${log.targetId}` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <RowCountNotice shown={logs.length} total={total} />
        </div>
      )}
    </div>
  );
}
