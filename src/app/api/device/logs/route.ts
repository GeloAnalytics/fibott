import { NextResponse } from "next/server";
import { z } from "zod";
import { validateDeviceApiKey } from "@/lib/device-auth";
import { logSystemEvent } from "@/lib/logger";

const schema = z.object({
  level: z.enum(["INFO", "WARN", "ERROR"]).default("INFO"),
  tag: z.string().min(1).default("ESP32-CAM"),
  message: z.string().min(1),
  details: z.string().optional(),
});

export async function POST(req: Request) {
  let deviceId: string | undefined;

  try {
    const device = await validateDeviceApiKey(req);
    deviceId = device.id;
  } catch {
    // Device key missing or invalid — still accept log for debug, marked as SYSTEM/unregistered
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid log payload" }, { status: 400 });
  }

  const { level, tag, message, details } = parsed.data;

  const createdLog = await logSystemEvent({
    source: deviceId ? "HARDWARE" : "SYSTEM",
    level,
    tag,
    message,
    details,
    deviceId,
  });

  return NextResponse.json({
    success: true,
    logId: createdLog?.id,
  });
}
