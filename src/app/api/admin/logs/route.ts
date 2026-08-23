import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "30", 10)));
  const skip = (page - 1) * limit;

  const level = searchParams.get("level");
  const source = searchParams.get("source");
  const tag = searchParams.get("tag");
  const search = searchParams.get("search")?.trim();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (level && ["INFO", "WARN", "ERROR"].includes(level)) {
    where.level = level;
  }
  if (source && ["HARDWARE", "SYSTEM"].includes(source)) {
    where.source = source;
  }
  if (tag) {
    where.tag = { contains: tag, mode: "insensitive" };
  }
  if (search) {
    where.OR = [
      { message: { contains: search, mode: "insensitive" } },
      { details: { contains: search, mode: "insensitive" } },
      { tag: { contains: search, mode: "insensitive" } },
    ];
  }

  const [logs, total, totalErrors, totalWarnings, hardwareErrors] = await Promise.all([
    prisma.systemLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        device: {
          select: { id: true, name: true, location: true },
        },
      },
    }),
    prisma.systemLog.count({ where }),
    prisma.systemLog.count({ where: { level: "ERROR" } }),
    prisma.systemLog.count({ where: { level: "WARN" } }),
    prisma.systemLog.count({ where: { source: "HARDWARE", level: "ERROR" } }),
  ]);

  return NextResponse.json({
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    metrics: {
      totalErrors,
      totalWarnings,
      hardwareErrors,
    },
  });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete logs older than 7 days, or purge all if requested
  const { searchParams } = new URL(req.url);
  const purgeAll = searchParams.get("all") === "true";

  if (purgeAll) {
    await prisma.systemLog.deleteMany({});
  } else {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await prisma.systemLog.deleteMany({
      where: { createdAt: { lt: sevenDaysAgo } },
    });
  }

  return NextResponse.json({ success: true });
}
