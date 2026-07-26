import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateDeviceApiKey, DeviceAuthError } from "@/lib/device-auth";

const schema = z.object({ code: z.string().length(6) });

/**
 * Legacy compatibility route for the controller-era prototype.
 *
 * The mobile-first baseline should not rely on this endpoint. Keep it
 * only if you still need to activate sessions from the older workflow
 * during migration.
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

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const depositSession = await prisma.depositSession.findUnique({
    where: { code: parsed.data.code },
  });

  if (!depositSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (depositSession.status !== "PENDING" || depositSession.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "Session is no longer available" },
      { status: 409 }
    );
  }

  const updated = await prisma.depositSession.update({
    where: { id: depositSession.id },
    data: {
      status: "ACTIVE",
      deviceId: device.id,
      activatedAt: new Date(),
      // Keep the deposit window short once activated at the machine.
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
    },
  });

  return NextResponse.json({
    sessionId: updated.id,
    status: updated.status,
    userId: updated.userId,
    expiresAt: updated.expiresAt,
  });
}
