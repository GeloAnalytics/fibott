import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

const schema = z.object({
  userId: z.string().min(1, "User ID is required"),
  newPassword: z.string().min(6, "Password must be at least 6 characters").optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { userId, newPassword: customPassword } = parsed.data;

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Use custom password if provided, or default to temporary password
  const newPassword = customPassword && customPassword.trim().length >= 6
    ? customPassword.trim()
    : "Fibott2026!";

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: "ADMIN_USER_PASSWORD_RESET",
      targetType: "User",
      targetId: targetUser.id,
      metadata: {
        targetUserEmail: targetUser.email,
        targetUserName: targetUser.name,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    userId: targetUser.id,
    userEmail: targetUser.email,
    userName: targetUser.name,
    newPassword,
  });
}
