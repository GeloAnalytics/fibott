import { NextResponse } from "next/server";
import { validateDeviceApiKey, DeviceAuthError } from "@/lib/device-auth";
import { classifyImage } from "@/lib/classifier";
import { processDeposit } from "@/lib/deposit";

// sharp (used by classifyImage) needs the Node.js runtime, not edge.
export const runtime = "nodejs";

// Generous headroom over a typical ESP32-CAM JPEG (tens to low hundreds of KB).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * ESP32-CAM's normal deposit path: upload the raw captured frame, get back
 * an accept/reject decision plus which way to drive the gate servo. Runs
 * classifier.ts then the same processDeposit() logic /api/device/scan uses.
 */
export async function POST(req: Request) {
  let device;
  try {
    device = await validateDeviceApiKey(req, "ESP32_CAM");
  } catch (err) {
    if (err instanceof DeviceAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const image = form.get("image");
  if (!(image instanceof Blob)) {
    return NextResponse.json({ error: "Missing 'image' file field" }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 });
  }

  const sessionCodeRaw = form.get("sessionCode");
  const sessionCode =
    typeof sessionCodeRaw === "string" && sessionCodeRaw.length === 6
      ? sessionCodeRaw
      : undefined;

  const imageBuffer = Buffer.from(await image.arrayBuffer());

  let classification;
  try {
    classification = await classifyImage(imageBuffer);
  } catch (err) {
    console.error("classifyImage failed", err);
    return NextResponse.json({ error: "Classification failed" }, { status: 502 });
  }

  const result = await processDeposit({
    deviceId: device.id,
    sessionCode,
    materialType: classification.materialType,
    classificationLabel: classification.label,
    confidence: classification.confidence,
  });

  return NextResponse.json({
    ...result,
    servoAction: result.decision === "ACCEPT" ? "ACCEPT" : "REJECT",
    classification,
  });
}
