import { prisma } from "@/lib/prisma";
import { AdminNotificationsManager } from "@/components/admin/admin-notifications-manager";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  const [notifications, totalRecipients] = await Promise.all([
    prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.user.count({
      where: {
        role: "USER",
        status: "ACTIVE",
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Notification Center</h1>
        <p className="text-sm text-muted-foreground">
          Broadcast system notifications to recyclers, manage announcements, and review dispatched award notices.
        </p>
      </div>

      <AdminNotificationsManager
        initialNotifications={notifications}
        totalRecipients={totalRecipients}
      />
    </div>
  );
}
