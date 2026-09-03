import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logSystemEvent } from "@/lib/logger";
import { z } from "zod";

const alertSchema = z.object({
  level: z.enum(["INFO", "WARN", "ERROR"]),
  tag: z.string().min(1).max(32),
  message: z.string().min(1).max(500),
  details: z.string().max(2000).optional(),
  deviceId: z.string().optional(),
});

// GET — Return device health summary for the admin panel
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch all devices with recent error counts
  const devices = await prisma.device.findMany({
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      location: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });

  // For each device, get recent error count (last 24 hours)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const deviceIds = devices.map((d) => d.id);

  const [recentErrors, recentWarnings] = await Promise.all([
    prisma.systemLog.groupBy({
      by: ["deviceId"],
      where: {
        deviceId: { in: deviceIds },
        level: "ERROR",
        createdAt: { gte: since24h },
      },
      _count: { id: true },
    }),
    prisma.systemLog.groupBy({
      by: ["deviceId"],
      where: {
        deviceId: { in: deviceIds },
        level: "WARN",
        createdAt: { gte: since24h },
      },
      _count: { id: true },
    }),
  ]);

  const errorMap = Object.fromEntries(recentErrors.map((r) => [r.deviceId, r._count.id]));
  const warnMap  = Object.fromEntries(recentWarnings.map((r) => [r.deviceId, r._count.id]));

  const health = devices.map((device) => {
    const lastSeenMs = device.lastSeenAt ? Date.now() - device.lastSeenAt.getTime() : null;
    // Health signal: green <5 min, yellow 5-30 min, red >30 min or never seen
    let connectivity: "online" | "stale" | "offline" | "unknown";
    if (lastSeenMs === null) {
      connectivity = "unknown";
    } else if (lastSeenMs < 5 * 60 * 1000) {
      connectivity = "online";
    } else if (lastSeenMs < 30 * 60 * 1000) {
      connectivity = "stale";
    } else {
      connectivity = "offline";
    }

    return {
      ...device,
      connectivity,
      recentErrors:   errorMap[device.id]  ?? 0,
      recentWarnings: warnMap[device.id]   ?? 0,
    };
  });

  return NextResponse.json({ devices: health });
}

// POST — Admin posts a manual hardware alert into the system log
export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = alertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid alert payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { level, tag, message, details, deviceId } = parsed.data;

  // Verify device exists if provided
  if (deviceId) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }
  }

  const log = await logSystemEvent({
    source: "SYSTEM",
    level,
    tag: `ADMIN/${tag}`,
    message,
    details: details ?? `Manually filed by admin: ${session.user.email ?? session.user.id}`,
    deviceId,
  });

  return NextResponse.json({ success: true, logId: log?.id });
}
