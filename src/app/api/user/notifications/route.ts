import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  id: z.string().optional(),
  all: z.boolean().optional(),
});

const deleteSchema = z.object({
  id: z.string().optional(),
  clearRead: z.boolean().optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 50)));
  const unreadOnly = searchParams.get("unreadOnly") === "true";

  const whereClause: {
    userId: string;
    isRead?: boolean;
  } = {
    userId: session.user.id,
  };

  if (unreadOnly) {
    whereClause.isRead = false;
  }

  const [notifications, unreadCount, totalCount] = await Promise.all([
    prisma.notification.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({
      where: {
        userId: session.user.id,
        isRead: false,
      },
    }),
    prisma.notification.count({
      where: {
        userId: session.user.id,
      },
    }),
  ]);

  return NextResponse.json({
    notifications,
    unreadCount,
    totalCount,
  });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (parsed.data.all) {
    const result = await prisma.notification.updateMany({
      where: {
        userId: session.user.id,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    return NextResponse.json({
      success: true,
      updatedCount: result.count,
    });
  }

  if (parsed.data.id) {
    const updated = await prisma.notification.updateMany({
      where: {
        id: parsed.data.id,
        userId: session.user.id,
      },
      data: {
        isRead: true,
      },
    });

    return NextResponse.json({
      success: true,
      updatedCount: updated.count,
    });
  }

  return NextResponse.json({ error: "Missing id or all parameter" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (parsed.data.clearRead) {
    const result = await prisma.notification.deleteMany({
      where: {
        userId: session.user.id,
        isRead: true,
      },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
    });
  }

  if (parsed.data.id) {
    const result = await prisma.notification.deleteMany({
      where: {
        id: parsed.data.id,
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
    });
  }

  return NextResponse.json({ error: "Missing id or clearRead parameter" }, { status: 400 });
}
