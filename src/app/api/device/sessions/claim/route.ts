import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateDeviceApiKey, DeviceAuthError } from "@/lib/device-auth";

/**
 * Legacy controller-era compatibility route.
 *
 * The mobile-first baseline starts sessions in the app and keeps the
 * controller board out of the active kiosk flow. This endpoint is still
 * retained so the older prototype can be migrated safely, but it is not
 * the primary version 1 path.
 */
export async function POST(req: Request) {
  let device;
  try {
    device = await validateDeviceApiKey(req, "KIOSK_CONTROLLER");
  } catch (err) {
    if (err instanceof DeviceAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const pending = await prisma.depositSession.findFirst({
    where: {
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!pending) {
    return NextResponse.json(
      { error: "No pending session available — ask the user to start a deposit in the app first" },
      { status: 404 }
    );
  }

  const activated = await prisma.depositSession.update({
    where: { id: pending.id },
    data: {
      status: "ACTIVE",
      deviceId: device.id,
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
    },
  });

  return NextResponse.json({
    sessionCode: activated.code,
    sessionId: activated.id,
    userId: activated.userId,
    expiresAt: activated.expiresAt,
  });
}
