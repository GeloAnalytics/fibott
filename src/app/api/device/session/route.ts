import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateDeviceApiKey, DeviceAuthError } from "@/lib/device-auth";

/**
 * ESP32-CAM session polling endpoint.
 *
 * The device calls this every 1-2 seconds. When a user starts a deposit from
 * the mobile app, this endpoint claims the session for this kiosk and returns
 * the session code so the device can submit an image via /api/device/deposit-image.
 */
export async function GET(req: Request) {
  let device;
  try {
    device = await validateDeviceApiKey(req, "ESP32_CAM");
  } catch (err) {
    if (err instanceof DeviceAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  await prisma.device.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });

  const existing = await prisma.depositSession.findFirst({
    where: {
      deviceId: device.id,
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
    },
  });

  if (existing) {
    return NextResponse.json({
      active: true,
      sessionId: existing.id,
      sessionCode: existing.code,
    });
  }

  const claimed = await prisma.$transaction(async (tx) => {
    const pending = await tx.depositSession.findFirst({
      where: {
        status: "PENDING",
        expiresAt: { gt: new Date() },
        deviceId: null,
      },
      orderBy: { createdAt: "asc" },
    });

    if (!pending) return null;

    return tx.depositSession.update({
      where: { id: pending.id },
      data: {
        status: "ACTIVE",
        deviceId: device.id,
        activatedAt: new Date(),
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      },
    });
  });

  if (!claimed) {
    return NextResponse.json({ active: false });
  }

  return NextResponse.json({
    active: true,
    sessionId: claimed.id,
    sessionCode: claimed.code,
  });
}
