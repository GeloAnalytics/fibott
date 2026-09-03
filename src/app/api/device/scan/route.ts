import { NextResponse } from "next/server";
import { z } from "zod";
import { validateDeviceApiKey, DeviceAuthError } from "@/lib/device-auth";
import { processDeposit } from "@/lib/deposit";

const schema = z.object({
  sessionCode: z.string().length(6).optional(),
  sessionId: z.string().optional(),
  classificationLabel: z.string().min(1),
  materialType: z.enum(["PET_BOTTLE", "ALUMINUM_CAN", "REJECTED"]),
  confidence: z.number().min(0).max(1),
  imageUrl: z.string().url().optional().nullable(),
});

/**
 * For devices/tests that already know the classification result. The
 * ESP32-CAM's normal path is `/api/device/deposit-image`, which runs
 * classifier.ts itself and calls the same processDeposit() helper.
 */
export async function POST(req: Request) {
  try {
    let device;
    try {
      device = await validateDeviceApiKey(req, "ESP32_CAM");
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

    const result = await processDeposit({
      deviceId: device.id,
      sessionId: parsed.data.sessionId,
      sessionCode: parsed.data.sessionCode,
      materialType: parsed.data.materialType,
      classificationLabel: parsed.data.classificationLabel,
      confidence: parsed.data.confidence,
      imageUrl: parsed.data.imageUrl,
    });

    const servoAction = result.decision === "ACCEPT" ? "ACCEPT" : "REJECT";
    return NextResponse.json({ ...result, servoAction });
  } catch (err) {
    console.error("[DEVICE/SCAN] Error in scan route:", err);
    return NextResponse.json(
      { decision: "REJECT", reason: "SERVER_ERROR", servoAction: "REJECT" },
      { status: 500 }
    );
  }
}
