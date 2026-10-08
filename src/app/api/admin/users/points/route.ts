import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logSystemEvent } from "@/lib/logger";

const grantPointsSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  amount: z.number().int().positive("Amount must be a positive integer"),
  reason: z.string().min(1, "Reason is required").max(200, "Reason is too long"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = grantPointsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid payload" },
      { status: 400 }
    );
  }

  const { userId, amount, reason } = parsed.data;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Update user points balance
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        pointsBalance: { increment: amount },
      },
    });

    // 2. Create points transaction record
    const pointsTx = await tx.pointsTransaction.create({
      data: {
        userId,
        type: "EARN",
        source: "ADMIN_ADJUSTMENT",
        amount,
        balanceAfter: updatedUser.pointsBalance,
        note: `🎁 Admin Bonus Points: ${reason}`,
      },
    });

    // 3. Create Notification for user inbox so they know where the points came from
    const notif = await tx.notification.create({
      data: {
        userId,
        title: `🎁 Free Points Received (+${amount} pts)!`,
        message: `Admin granted you ${amount} free points. Reason: "${reason}". These points have been added directly to your Points Wallet balance (no claim required).`,
        type: "SYSTEM",
      },
    });

    // 4. Record Audit Log
    await tx.auditLog.create({
      data: {
        actorId: session.user.id,
        action: "POINTS_ADMIN_GRANTED",
        targetType: "User",
        targetId: userId,
        metadata: {
          grantedToUserId: userId,
          grantedToEmail: targetUser.email,
          amount,
          reason,
          newBalance: updatedUser.pointsBalance,
        },
      },
    });

    return {
      updatedUser,
      pointsTx,
      notif,
    };
  });

  await logSystemEvent({
    source: "SYSTEM",
    level: "INFO",
    tag: "ADMIN",
    message: `Admin granted ${amount} points to user ${targetUser.email ?? targetUser.name} (${reason})`,
    details: {
      adminId: session.user.id,
      targetUserId: userId,
      amount,
      reason,
      newBalance: result.updatedUser.pointsBalance,
    },
  });

  return NextResponse.json({
    success: true,
    message: `Successfully granted ${amount} points to ${targetUser.name || targetUser.email}.`,
    pointsBalance: result.updatedUser.pointsBalance,
  });
}
