import { NextResponse } from "next/server";
import { validateDeviceApiKey, DeviceAuthError } from "@/lib/device-auth";
import { classifyImage } from "@/lib/classifier";
import { processDeposit } from "@/lib/deposit";
import type { MaterialType } from "@/generated/prisma/enums";

// sharp (used by classifyImage) needs the Node.js runtime, not edge.
export const runtime = "nodejs";

// Allow up to 60 seconds on Vercel for ML model initialization / inference
export const maxDuration = 60;

// Generous headroom over a typical ESP32-CAM JPEG (tens to low hundreds of KB).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// materialType values the ESP32's on-device TFLite Micro model can report as
// an accepted item (it never uploads a REJECTED capture — a locally-rejected
// item never reaches this route).
const LOCAL_MATERIAL_TYPES = new Set<string>(["PET_BOTTLE", "ALUMINUM_CAN"]);

/**
 * ESP32-CAM's normal deposit path: upload the raw captured frame, get back
 * an accept/reject decision plus which way to drive the gate servo.
 *
 * The ESP32 already runs real on-device TFLite Micro inference and makes the
 * physical gate decision *before* this request is even sent (see the .ino) —
 * so its `localMaterialType`/`localConfidence` fields, when present, are the
 * authoritative decision for points/recording too. This route used to always
 * re-classify the frame with the much weaker zero-shot cloud model
 * (classifier.ts) and use THAT for points, independently of what the ESP32
 * had already decided and physically acted on — the two could (and did)
 * disagree, and the customer's points reflected whichever one won, not what
 * actually happened at the kiosk. Firmware built before this change doesn't
 * send `localMaterialType`; for that older firmware, and only that firmware,
 * this falls back to the cloud classifier so it doesn't break outright.
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

    // The ESP32 already ran real on-device TFLite Micro inference and made
    // the physical gate decision before sending this request — see the big
    // comment above. When it's present, it's authoritative.
    const localMaterialTypeRaw = form.get("localMaterialType");
    const localConfidenceRaw = form.get("localConfidence");
    const localMaterialType =
      typeof localMaterialTypeRaw === "string" && LOCAL_MATERIAL_TYPES.has(localMaterialTypeRaw)
        ? (localMaterialTypeRaw as MaterialType)
        : null;
    const localConfidence =
      typeof localConfidenceRaw === "string" && Number.isFinite(parseFloat(localConfidenceRaw))
        ? Math.max(0, Math.min(1, parseFloat(localConfidenceRaw)))
        : null;

    const imageBuffer = Buffer.from(await image.arrayBuffer());

    // Persist every real captured frame as a data URL in Deposit.imageUrl (the
    // column already existed but was never populated — the image was being
    // classified in memory and thrown away). This is what actually builds a
    // real-world training set over time: every deposit, whatever the lighting
    // or angle happened to be, becomes a labeled example instead of vanishing.
    // Storing inline in Postgres rather than a separate blob store — no new
    // infra/credentials required. Revisit if Deposit table growth becomes a
    // problem (unlikely at kiosk scale: QVGA JPEGs are tens of KB each).
    const imageDataUrl = `data:${image.type || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;

    let classification;
    if (localMaterialType && localConfidence !== null) {
      // Trust the ESP32's real on-device decision. Skip the slow, unreliable
      // zero-shot cloud call entirely on the hot path — it was never a real
      // material classifier (see classifier.ts's own comments: ImageNet has
      // no beverage-can class, it falls back to a pixel color-variance guess
      // for anything that doesn't match a keyword). Only fire it in the
      // background, non-blocking, when FIBOTT_ML_MODE=compare is explicitly
      // set, purely to log disagreement for later review.
      classification = {
        materialType: localMaterialType,
        label: "esp32-tinyml",
        confidence: localConfidence,
      };

      if (process.env.FIBOTT_ML_MODE === "compare") {
        classifyImage(imageBuffer)
          .then((cloudRes) => {
            if (cloudRes.materialType !== localMaterialType) {
              console.warn("[DEVICE/DEPOSIT-IMAGE] ESP32/cloud disagreement", {
                sessionId,
                sessionCode,
                esp32: { materialType: localMaterialType, confidence: localConfidence },
                cloud: { materialType: cloudRes.materialType, label: cloudRes.label, confidence: cloudRes.confidence },
              });
            }
          })
          .catch(() => {});
      }
    } else {
      // Backward compatibility only: firmware older than this change doesn't
      // send localMaterialType/localConfidence. Falls back to the old,
      // weaker cloud classification so those devices don't break outright —
      // reflash them with the current firmware when you get a chance.
      try {
        classification = await classifyImage(imageBuffer);
      } catch (err) {
        console.error("[DEVICE/DEPOSIT-IMAGE] classifyImage failed", {
          sessionId,
          sessionCode,
          error: err instanceof Error ? err.message : String(err),
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
    }

    const result = await processDeposit({
      deviceId: device.id,
      sessionId,
      sessionCode,
      materialType: classification.materialType,
      classificationLabel: classification.label,
      confidence: classification.confidence,
      imageUrl: imageDataUrl,
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
