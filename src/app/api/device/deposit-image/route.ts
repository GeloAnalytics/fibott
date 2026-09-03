import { NextResponse } from "next/server";
import { validateDeviceApiKey, DeviceAuthError } from "@/lib/device-auth";
import { classifyImage } from "@/lib/classifier";
import { processDeposit } from "@/lib/deposit";

// sharp (used by classifyImage) needs the Node.js runtime, not edge.
export const runtime = "nodejs";

// Allow up to 60 seconds on Vercel for ML model initialization / inference
export const maxDuration = 60;

// Generous headroom over a typical ESP32-CAM JPEG (tens to low hundreds of KB).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * ESP32-CAM's normal deposit path: upload the raw captured frame, get back
 * an accept/reject decision plus which way to drive the gate servo. Runs
 * classifier.ts then the same processDeposit() logic /api/device/scan uses.
 */
export async function POST(req: Request) {
  let sessionId: string | undefined;
  let sessionCode: string | undefined;

  try {
    let device;
    try {
      device = await validateDeviceApiKey(req, "ESP32_CAM");
    } catch (err) {
      if (err instanceof DeviceAuthError) {
        return NextResponse.json(
          {
            decision: "REJECT",
            reason: "UNAUTHORIZED",
            error: err.message,
            servoAction: "REJECT",
          },
          { status: err.status }
        );
      }
      throw err;
    }

    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json(
        {
          decision: "REJECT",
          reason: "BAD_REQUEST",
          error: "Expected multipart/form-data",
          servoAction: "REJECT",
        },
        { status: 400 }
      );
    }

    const image = form.get("image");
    if (!(image instanceof Blob)) {
      return NextResponse.json(
        {
          decision: "REJECT",
          reason: "BAD_REQUEST",
          error: "Missing 'image' file field",
          servoAction: "REJECT",
        },
        { status: 400 }
      );
    }
    if (image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        {
          decision: "REJECT",
          reason: "PAYLOAD_TOO_LARGE",
          error: "Image too large",
          servoAction: "REJECT",
        },
        { status: 413 }
      );
    }

    const sessionCodeRaw = form.get("sessionCode");
    sessionCode =
      typeof sessionCodeRaw === "string" && sessionCodeRaw.length === 6
        ? sessionCodeRaw
        : undefined;

    const sessionIdRaw = form.get("sessionId");
    sessionId =
      typeof sessionIdRaw === "string" && sessionIdRaw.length > 0
        ? sessionIdRaw
        : undefined;

    const imageBuffer = Buffer.from(await image.arrayBuffer());

    let classification;
    try {
      classification = await classifyImage(imageBuffer);
    } catch (err) {
      console.error("classifyImage failed", { sessionId, sessionCode, err });
      return NextResponse.json(
        {
          decision: "REJECT",
          reason: "CLASSIFICATION_FAILED",
          error: "Classification failed",
          servoAction: "REJECT",
        },
        { status: 502 }
      );
    }

    const result = await processDeposit({
      deviceId: device.id,
      sessionId,
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
  } catch (error) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    console.error("Unhandled error in deposit-image route:", {
      sessionId,
      sessionCode,
      error: errObj.message,
      stack: errObj.stack,
    });
    return NextResponse.json(
      {
        decision: "REJECT",
        reason: "SERVER_ERROR",
        servoAction: "REJECT",
      },
      { status: 500 }
    );
  }
}
