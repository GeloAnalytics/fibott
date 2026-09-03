import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateDeviceApiKey, DeviceAuthError } from "@/lib/device-auth";

const SESSION_TTL_MS = 1 * 60 * 1000; // 1 minute — users must deposit within this window

async function expireStale() {
  await prisma.depositSession.updateMany({
    where: { status: { in: ["PENDING", "ACTIVE"] }, expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
}

// POST — authenticated user starts a recycling session
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await expireStale();

  const busy = await prisma.depositSession.findFirst({
    where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
  });
  if (busy) {
    return NextResponse.json({ error: "Kiosk is busy" }, { status: 409 });
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const depositSession = await prisma.depositSession.create({
    data: {
      code: `K${Date.now()}`,
      userId: session.user.id,
      status: "ACTIVE",
      activatedAt: new Date(),
      expiresAt,
    },
  });

  return NextResponse.json(
    { sessionId: depositSession.id, expiresAt: depositSession.expiresAt },
    { status: 201 }
  );
}

// GET — two callers:
//   Device (API key): returns the active kiosk session (for ESP32 polling)
//   User  (session cookie, ?id=<sessionId>): returns session status (for frontend polling)
//   User  (session cookie, no ?id): returns user's current active session
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("id");

  // --- Device auth path ---
  try {
    const device = await validateDeviceApiKey(req, "ESP32_CAM");

    await prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    await expireStale();

    const active = await prisma.depositSession.findFirst({
      where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
    });

    if (!active) return NextResponse.json({ active: false });

    return NextResponse.json({
      active: true,
      sessionId: active.id,
      userId: active.userId,
      expiresAt: active.expiresAt,
    });
  } catch (err) {
    if (!(err instanceof DeviceAuthError)) throw err;
    // Not device auth — fall through to user auth
  }

  // --- User auth path ---
  const userSession = await auth();
  if (!userSession?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // With ?id: return status of a specific session (completion polling)
  if (sessionId) {
    const record = await prisma.depositSession.findFirst({
      where: { id: sessionId, userId: userSession.user.id },
      include: {
        deposits: {
          where: { status: "ACCEPTED" },
          select: { pointsAwarded: true },
        },
      },
    });

    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const pointsAwarded = record.deposits.reduce((s, d) => s + d.pointsAwarded, 0);

    return NextResponse.json({
      status: record.status,
      expiresAt: record.expiresAt,
      pointsAwarded,
    });
  }

  // Without ?id: return user's active session (page-load check)
  await expireStale();
  const active = await prisma.depositSession.findFirst({
    where: {
      userId: userSession.user.id,
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!active) return NextResponse.json({ active: false });

  return NextResponse.json({
    active: true,
    sessionId: active.id,
    expiresAt: active.expiresAt,
  });
}

// DELETE — authenticated user voluntarily ends their active session
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("id");

  const userSession = await auth();
  if (!userSession?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session id" }, { status: 400 });
  }

  const record = await prisma.depositSession.findFirst({
    where: { id: sessionId, userId: userSession.user.id, status: "ACTIVE" },
  });

  if (!record) {
    return NextResponse.json({ error: "Session not found or already ended" }, { status: 404 });
  }

  await prisma.depositSession.update({
    where: { id: sessionId },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  return NextResponse.json({ success: true, status: "CANCELLED" });
}
