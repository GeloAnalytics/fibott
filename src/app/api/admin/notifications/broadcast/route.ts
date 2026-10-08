import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logSystemEvent } from "@/lib/logger";

const broadcastSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title is too long"),
  message: z.string().min(1, "Message is required").max(500, "Message is too long"),
  target: z.enum(["ALL_USERS", "RECYCLERS_ONLY"]).default("ALL_USERS"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = broadcastSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { title, message, target } = parsed.data;

  // Find target users
  const whereClause: {
    status: "ACTIVE";
    role: "USER";
    deposits?: { some: {} };
  } = {
    status: "ACTIVE",
    role: "USER",
  };

  if (target === "RECYCLERS_ONLY") {
    whereClause.deposits = { some: {} };
  }

  const targetUsers = await prisma.user.findMany({
    where: whereClause,
    select: { id: true, email: true },
  });

  if (targetUsers.length === 0) {
    return NextResponse.json(
      { error: "No target users found for broadcast." },
      { status: 400 }
    );
  }

  // Create notifications for all target users
  await prisma.notification.createMany({
    data: targetUsers.map((u) => ({
      userId: u.id,
      title: `📢 ${title}`,
      message,
      type: "ADMIN_BROADCAST",
    })),
  });

  // Record audit log
  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: "ADMIN_NOTIFICATION_BROADCAST",
      targetType: "Notification",
      metadata: {
        title,
        message,
        target,
        recipientsCount: targetUsers.length,
      },
    },
  });

  await logSystemEvent({
    source: "SYSTEM",
    level: "INFO",
    tag: "ADMIN",
    message: `Admin broadcast sent: "${title}" to ${targetUsers.length} users`,
    details: { adminId: session.user.id, target, recipientsCount: targetUsers.length },
  });

  return NextResponse.json({
    success: true,
    message: `Broadcast successfully sent to ${targetUsers.length} user${targetUsers.length > 1 ? "s" : ""}!`,
    recipientsCount: targetUsers.length,
  });
}
