import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import type { MaterialType } from "@/generated/prisma/enums";
import type * as tfTypes from "@tensorflow/tfjs";
import type * as mobilenetTypes from "@tensorflow-models/mobilenet";

const IMAGE_SIZE = 224;

/**
 * Lazy import helpers to prevent heavy native C++ binaries (Sharp) and TensorFlow.js
 * from throwing uncaught module evaluation exceptions at route file import time.
 */
let tfModulePromise: Promise<typeof import("@tensorflow/tfjs")> | null = null;
function getTf() {
  if (!tfModulePromise) {
    tfModulePromise = import("@tensorflow/tfjs");
  }
  return tfModulePromise;
}

let mobilenetModulePromise: Promise<typeof import("@tensorflow-models/mobilenet")> | null = null;
function getMobilenet() {
  if (!mobilenetModulePromise) {
    mobilenetModulePromise = import("@tensorflow-models/mobilenet");
  }
  return mobilenetModulePromise;
}

async function getSharp() {
  const mod = await import("sharp");
  return mod.default || mod;
}

/**
 * Confidence floor below which we don't trust the top prediction at all.
 */
const MIN_CONFIDENCE = 0.20;

const LABEL_KEYWORDS: Record<"PET_BOTTLE" | "ALUMINUM_CAN", string[]> = {
  PET_BOTTLE: [
    "bottle",
    "water bottle",
    "pop bottle",
    "soda bottle",
    "beer bottle",
    "wine bottle",
    "plastic bottle",
    "pill bottle",
  ],
  ALUMINUM_CAN: [
    "beer can",
    "soda can",
    "tin can",
    "milk can",
    "beverage can",
    "aluminum can",
    "can",
  ],
};

const NON_RECYCLABLE_KEYWORDS = [
  "paper",
  "tissue",
  "envelope",
  "towel",
  "carton",
  "cardboard",
  "hand",
  "finger",
  "glove",
  "skin",
  "cloth",
  "jersey",
  "sock",
  "shoe",
  "book",
  "comic",
  "newspaper",
  "cup",
  "mug",
  "plate",
  "trash",
  "garbage",
  "plastic bag",
  "bag",
  "wallet",
  "cellphone",
  "phone",
  "remote",
  "screen",
  "keyboard",
  "food",
  "fruit",
  "banana",
  "apple",
  "bread",
];

export interface ClassificationResult {
  materialType: MaterialType;
  label: string;
  confidence: number;
}

const FINE_TUNED_HEAD_PATH =
  process.env.FIBOTT_ML_HEAD_PATH ?? path.join(process.cwd(), "models", "bottle-can-head", "weights.json");

interface SerializedHead {
  inputDim: number;
  hiddenUnits?: number;
  labels: string[];
  weights: { shape: number[]; data: number[] }[];
}

let backendReady: Promise<void> | null = null;
let modelPromise: Promise<mobilenetTypes.MobileNet> | null = null;

function ensureBackend(): Promise<void> {
  if (!backendReady) {
    backendReady = (async () => {
      const tf = await getTf();
      await tf.setBackend("cpu");
      await tf.ready();
    })();
  }
  return backendReady;
}

function loadModel(): Promise<mobilenetTypes.MobileNet> {
  if (!modelPromise) {
    modelPromise = (async () => {
      await ensureBackend();
      const mobilenet = await getMobilenet();
      return await mobilenet.load({ version: 2, alpha: 1.0 });
    })();
  }
  return modelPromise;
}

async function decodeToTensor(imageBuffer: Buffer): Promise<tfTypes.Tensor3D> {
  const tf = await getTf();

  try {
    const sharp = await getSharp();
    const { data, info } = await sharp(imageBuffer)
      .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels === 3) {
      return tf.tensor3d(new Int32Array(data), [info.height, info.width, 3], "int32");
    }
  } catch (sharpErr) {
    console.warn("[CLASSIFIER] Sharp decode failed, falling back to pure-JS jpeg-js decoder:", {
      error: sharpErr instanceof Error ? sharpErr.message : String(sharpErr),
    });
  }

  const rawDecoded = jpeg.decode(imageBuffer, { useTArray: true, formatAsRGBA: false });

  const srcWidth = rawDecoded.width;
  const srcHeight = rawDecoded.height;
  const srcData = rawDecoded.data;
  const isRGBA = srcData.length === srcWidth * srcHeight * 4;
  const step = isRGBA ? 4 : 3;

  const targetData = new Int32Array(IMAGE_SIZE * IMAGE_SIZE * 3);

  for (let y = 0; y < IMAGE_SIZE; y++) {
    const srcY = Math.floor((y * srcHeight) / IMAGE_SIZE);
    for (let x = 0; x < IMAGE_SIZE; x++) {
      const srcX = Math.floor((x * srcWidth) / IMAGE_SIZE);
      const srcIdx = (srcY * srcWidth + srcX) * step;
      const targetIdx = (y * IMAGE_SIZE + x) * 3;

      targetData[targetIdx] = srcData[srcIdx];
      targetData[targetIdx + 1] = srcData[srcIdx + 1];
      targetData[targetIdx + 2] = srcData[srcIdx + 2];
    }
  }

  return tf.tensor3d(targetData, [IMAGE_SIZE, IMAGE_SIZE, 3], "int32");
}

function mapPrediction(
  predictions: Array<{ className: string; probability: number }>,
  imageBuffer?: Buffer
): ClassificationResult {
  const top = predictions[0];
  const topLower = (top?.className ?? "").toLowerCase();

  // 1. Explicit non-recyclable reject check (paper, hand, cup, clothing, etc.)
  for (const rejKey of NON_RECYCLABLE_KEYWORDS) {
    if (topLower.includes(rejKey)) {
      return {
        materialType: "REJECTED",
        label: `rejected:${top?.className ?? "non-recyclable"}`,
        confidence: top?.probability ?? 0.9,
      };
    }
  }

  // 2. Strict keyword check for genuine bottles and cans
  for (const { className, probability } of predictions) {
    const lower = className.toLowerCase();
    for (const [materialType, keywords] of Object.entries(LABEL_KEYWORDS) as [
      "PET_BOTTLE" | "ALUMINUM_CAN",
      string[],
    ][]) {
      if (keywords.some((keyword) => lower.includes(keyword)) && probability >= MIN_CONFIDENCE) {
        return { materialType, label: className, confidence: Math.max(probability, 0.85) };
      }
    }
  }

  // 3. Fallback: Reject any unrecognized item (hands, paper, background, random trash)
  const topLabel = top?.className ?? "unrecognized_item";
  const confidence = top?.probability ?? 0.0;

  return {
    materialType: "REJECTED",
    label: `rejected:${topLabel}`,
    confidence,
  };
}

export async function embedImage(imageBuffer: Buffer): Promise<Float32Array> {
  const model = await loadModel();
  const tensor = await decodeToTensor(imageBuffer);
  try {
    const embedding = model.infer(tensor, true);
    try {
      return (await embedding.data()) as Float32Array;
    } finally {
      embedding.dispose();
    }
  } finally {
    tensor.dispose();
  }
}

let fineTunedHeadPromise: Promise<{ model: tfTypes.LayersModel; labels: string[] } | null> | null = null;

function loadFineTunedHead(): Promise<{ model: tfTypes.LayersModel; labels: string[] } | null> {
  if (!fineTunedHeadPromise) {
    fineTunedHeadPromise = (async () => {
      if (!fs.existsSync(FINE_TUNED_HEAD_PATH)) return null;

      const raw: SerializedHead = JSON.parse(fs.readFileSync(FINE_TUNED_HEAD_PATH, "utf-8"));
      await ensureBackend();
      const tf = await getTf();

      const layers: tfTypes.layers.Layer[] = raw.hiddenUnits
        ? [
            tf.layers.dense({ inputShape: [raw.inputDim], units: raw.hiddenUnits, activation: "relu" }),
            tf.layers.dropout({ rate: 0 }),
            tf.layers.dense({ units: raw.labels.length, activation: "softmax" }),
          ]
        : [
            tf.layers.dense({ inputShape: [raw.inputDim], units: raw.labels.length, activation: "softmax" }),
          ];
      const head = tf.sequential({ layers });
      head.setWeights(raw.weights.map((w) => tf.tensor(w.data, w.shape)));
      return { model: head, labels: raw.labels };
    })();
  }
  return fineTunedHeadPromise;
}

async function classifyWithFineTunedHead(
  head: tfTypes.LayersModel,
  headLabels: string[],
  imageBuffer: Buffer
): Promise<ClassificationResult> {
  const model = await loadModel();
  const tensor = await decodeToTensor(imageBuffer);
  try {
    const embedding = model.infer(tensor, true) as tfTypes.Tensor2D;
    try {
      const scores = head.predict(embedding) as tfTypes.Tensor;
      try {
        const values = (await scores.data()) as Float32Array;
        let bestIdx = 0;
        for (let i = 1; i < values.length; i++) {
          if (values[i] > values[bestIdx]) bestIdx = i;
        }
        const confidence = values[bestIdx];
        if (confidence < 0.70) {
          return { materialType: "REJECTED", label: `fine-tuned:low-confidence`, confidence };
        }
        const label = headLabels[bestIdx] as MaterialType;
        return {
          materialType: label === "REJECTED" ? "REJECTED" : label,
          label: `fine-tuned:${label}`,
          confidence,
        };
      } finally {
        scores.dispose();
      }
    } finally {
      embedding.dispose();
    }
  } finally {
    tensor.dispose();
  }
}

export class ClassifierError extends Error {
  code: "CLASSIFIER_UNAVAILABLE" | "IMAGE_PROCESSING_ERROR";
  constructor(
    code: "CLASSIFIER_UNAVAILABLE" | "IMAGE_PROCESSING_ERROR",
    message: string,
    public override cause?: unknown
  ) {
    super(message);
    this.name = "ClassifierError";
    this.code = code;
  }
}

export function prewarmClassifier(): void {
  loadModel().catch(() => {});
}

export async function classifyImage(imageBuffer: Buffer): Promise<ClassificationResult> {
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new ClassifierError("IMAGE_PROCESSING_ERROR", "Empty image buffer provided");
  }

  const mode = process.env.FIBOTT_ML_MODE ?? "zero-shot";

  try {
    if (mode === "experimental_head") {
      const loaded = await loadFineTunedHead();
      if (loaded) {
        return await classifyWithFineTunedHead(loaded.model, loaded.labels, imageBuffer);
      }
    }

    if (mode === "compare") {
      const model = await loadModel();
      const tensor = await decodeToTensor(imageBuffer);
      let zeroShotRes: ClassificationResult;
      try {
        const predictions = await model.classify(tensor, 5);
        zeroShotRes = mapPrediction(predictions, imageBuffer);
      } finally {
        tensor.dispose();
      }

      const loaded = await loadFineTunedHead();
      if (loaded) {
        classifyWithFineTunedHead(loaded.model, loaded.labels, imageBuffer)
          .then((headRes) => {
            console.log("[CLASSIFIER/COMPARE]", {
              zeroShot: { material: zeroShotRes.materialType, label: zeroShotRes.label, confidence: zeroShotRes.confidence },
              experimentalHead: { material: headRes.materialType, label: headRes.label, confidence: headRes.confidence },
              match: zeroShotRes.materialType === headRes.materialType,
            });
          })
          .catch(() => {});
      }
      return zeroShotRes;
    }

    // Default zero-shot path with strict bottle/can verification
    const model = await loadModel();
    const tensor = await decodeToTensor(imageBuffer);
    try {
      const predictions = await model.classify(tensor, 5);
      return mapPrediction(predictions, imageBuffer);
    } finally {
      tensor.dispose();
    }
  } catch (err) {
    console.error("[CLASSIFIER] TensorFlow/Sharp processing error:", {
      bufferLength: imageBuffer.length,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (err instanceof ClassifierError) throw err;
    throw new ClassifierError(
      "CLASSIFIER_UNAVAILABLE",
      "Classification engine failed to process image",
      err
    );
  }
}
