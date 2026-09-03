import { NextResponse } from "next/server";
import { validateDeviceApiKey, DeviceAuthError } from "@/lib/device-auth";
import { classifyImage, ClassifierError } from "@/lib/classifier";
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

  console.log("[DEVICE/DEPOSIT-IMAGE] HANDLER ENTERED");

  try {
    let device;
    try {
      device = await validateDeviceApiKey(req, "ESP32_CAM");
      console.log("[DEVICE/DEPOSIT-IMAGE] DEVICE AUTH OK", { deviceId: device.id });
    } catch (err) {
      if (err instanceof DeviceAuthError) {
        console.warn("[DEVICE/DEPOSIT-IMAGE] DEVICE AUTH ERROR", { error: err.message });
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
      console.warn("[DEVICE/DEPOSIT-IMAGE] BAD REQUEST - expected multipart/form-data");
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
    console.log("[DEVICE/DEPOSIT-IMAGE] REQUEST BODY PARSED");

    const image = form.get("image");
    if (!(image instanceof Blob)) {
      console.warn("[DEVICE/DEPOSIT-IMAGE] BAD REQUEST - missing image file field");
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
      console.warn("[DEVICE/DEPOSIT-IMAGE] PAYLOAD TOO LARGE", { size: image.size });
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

    console.log("[DEVICE/DEPOSIT-IMAGE] IMAGE RECEIVED", { size: image.size, sessionId, sessionCode });

    const imageBuffer = Buffer.from(await image.arrayBuffer());

    let classification;
    try {
      console.log("[DEVICE/DEPOSIT-IMAGE] CLASSIFIER START", { sessionId });
      classification = await classifyImage(imageBuffer);
      console.log("[DEVICE/DEPOSIT-IMAGE] CLASSIFIER SUCCESS", {
        sessionId,
        materialType: classification.materialType,
        label: classification.label,
        confidence: classification.confidence,
      });
    } catch (err) {
      console.error("[DEVICE/DEPOSIT-IMAGE] CLASSIFIER ERROR", {
        sessionId,
        sessionCode,
        error: err instanceof Error ? err.message : String(err),
        code: err instanceof ClassifierError ? err.code : "UNKNOWN",
      });
      return NextResponse.json(
        {
          decision: "REJECT",
          reason: "SERVER_ERROR",
          error: "Classifier engine unavailable",
          servoAction: "REJECT",
        },
        { status: 500 }
      );
    }

    console.log("[DEVICE/DEPOSIT-IMAGE] DEPOSIT PROCESSING START", { sessionId, deviceId: device.id });
    const result = await processDeposit({
      deviceId: device.id,
      sessionId,
      sessionCode,
      materialType: classification.materialType,
      classificationLabel: classification.label,
      confidence: classification.confidence,
    });
    console.log("[DEVICE/DEPOSIT-IMAGE] DEPOSIT PROCESSING SUCCESS", {
      sessionId,
      decision: result.decision,
    });

    return NextResponse.json({
      ...result,
      servoAction: result.decision === "ACCEPT" ? "ACCEPT" : "REJECT",
      classification,
    });
  } catch (error) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    console.error("[DEVICE/DEPOSIT-IMAGE] UNHANDLED ERROR", {
      sessionId,
      sessionCode,
      error: errObj.message,
      stack: errObj.stack,
    });
    return NextResponse.json(
      {
        decision: "REJECT",
        reason: "SERVER_ERROR",
        error: "Internal server error",
        servoAction: "REJECT",
      },
      { status: 500 }
    );
  }
}
