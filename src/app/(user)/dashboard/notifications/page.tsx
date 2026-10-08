import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NotificationsManager } from "@/components/user/notifications-manager";

export default async function UserNotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.notification.count({
      where: {
        userId: session.user.id,
        isRead: false,
      },
    }),
  ]);

  return (
    <NotificationsManager
      initialNotifications={notifications}
      initialUnreadCount={unreadCount}
    />
  );
}
