import * as tf from "@tensorflow/tfjs";
import * as mobilenet from "@tensorflow-models/mobilenet";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import type { MaterialType } from "@/generated/prisma/enums";

const IMAGE_SIZE = 224;

/**
 * Confidence floor below which we don't trust the top prediction at all —
 * MobileNet's top-1 probability on out-of-distribution images (a kiosk
 * chute, not a clean product photo) is often low even when the label is
 * directionally right.
 */
const MIN_CONFIDENCE = 0.15;

/**
 * ImageNet-1k has no dedicated beverage-can class. "milk can" (a large
 * lidded steel can) is the closest visual proxy available zero-shot — this
 * is a bootstrap, not a reliable can detector. See docs/ml.md for why, and
 * for the fine-tuning path that replaces this mapping with a real
 * two-class head trained on your own kiosk images.
 */
const LABEL_KEYWORDS: Record<"PET_BOTTLE" | "ALUMINUM_CAN", string[]> = {
  PET_BOTTLE: [
    "water bottle",
    "pop bottle",
    "soda bottle",
    "beer bottle",
    "wine bottle",
    "pill bottle",
  ],
  ALUMINUM_CAN: ["milk can"],
};

export interface ClassificationResult {
  materialType: MaterialType;
  label: string;
  confidence: number;
}

/**
 * Where a fine-tuned classifier head (trained by scripts/ml/train.ts on
 * your own kiosk images) is expected to live. If this file doesn't exist,
 * classifyImage() falls back to the zero-shot ImageNet keyword mapping
 * below — see docs/ml.md for why you'll want to replace it.
 */
const FINE_TUNED_HEAD_PATH =
  process.env.FIBOTT_ML_HEAD_PATH ?? path.join(process.cwd(), "models", "bottle-can-head", "weights.json");

interface SerializedHead {
  inputDim: number;
  /** Present in two-layer heads trained after the hidden-layer upgrade. Absent = legacy single-layer. */
  hiddenUnits?: number;
  labels: string[];
  weights: { shape: number[]; data: number[] }[];
}

let backendReady: Promise<void> | null = null;
let modelPromise: Promise<mobilenet.MobileNet> | null = null;

function ensureBackend(): Promise<void> {
  if (!backendReady) {
    backendReady = (async () => {
      await tf.setBackend("cpu");
      await tf.ready();
    })();
  }
  return backendReady;
}

function loadModel(): Promise<mobilenet.MobileNet> {
  if (!modelPromise) {
    modelPromise = ensureBackend().then(() =>
      mobilenet.load({ version: 2, alpha: 1.0 })
    );
  }
  return modelPromise;
}

async function decodeToTensor(imageBuffer: Buffer): Promise<tf.Tensor3D> {
  const { data, info } = await sharp(imageBuffer)
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`Expected 3 color channels after decode, got ${info.channels}`);
  }

  return tf.tensor3d(new Int32Array(data), [info.height, info.width, 3], "int32");
}

function mapPrediction(
  predictions: Array<{ className: string; probability: number }>
): ClassificationResult {
  for (const { className, probability } of predictions) {
    const lower = className.toLowerCase();
    for (const [materialType, keywords] of Object.entries(LABEL_KEYWORDS) as [
      "PET_BOTTLE" | "ALUMINUM_CAN",
      string[],
    ][]) {
      if (keywords.some((keyword) => lower.includes(keyword))) {
        if (probability < MIN_CONFIDENCE) {
          return { materialType: "REJECTED", label: className, confidence: probability };
        }
        return { materialType, label: className, confidence: probability };
      }
    }
  }

  const top = predictions[0];
  return {
    materialType: "REJECTED",
    label: top?.className ?? "unknown",
    confidence: top?.probability ?? 0,
  };
}

/** Raw MobileNet embedding for a decoded image — used by scripts/ml/train.ts. */
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

let fineTunedHeadPromise: Promise<{ model: tf.LayersModel; labels: string[] } | null> | null = null;

function loadFineTunedHead(): Promise<{ model: tf.LayersModel; labels: string[] } | null> {
  if (!fineTunedHeadPromise) {
    fineTunedHeadPromise = (async () => {
      if (!fs.existsSync(FINE_TUNED_HEAD_PATH)) return null;

      const raw: SerializedHead = JSON.parse(fs.readFileSync(FINE_TUNED_HEAD_PATH, "utf-8"));
      await ensureBackend();

      const layers: tf.layers.Layer[] = raw.hiddenUnits
        ? [
            tf.layers.dense({ inputShape: [raw.inputDim], units: raw.hiddenUnits, activation: "relu" }),
            tf.layers.dropout({ rate: 0 }), // no dropout at inference
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
  head: tf.LayersModel,
  headLabels: string[],
  imageBuffer: Buffer
): Promise<ClassificationResult> {
  const model = await loadModel();
  const tensor = await decodeToTensor(imageBuffer);
  try {
    const embedding = model.infer(tensor, true) as tf.Tensor2D;
    try {
      const scores = head.predict(embedding) as tf.Tensor;
      try {
        const values = (await scores.data()) as Float32Array;
        let bestIdx = 0;
        for (let i = 1; i < values.length; i++) {
          if (values[i] > values[bestIdx]) bestIdx = i;
        }
        const confidence = values[bestIdx];
        if (confidence < MIN_CONFIDENCE) {
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

export async function classifyImage(imageBuffer: Buffer): Promise<ClassificationResult> {
  const loaded = await loadFineTunedHead();
  if (loaded) {
    return classifyWithFineTunedHead(loaded.model, loaded.labels, imageBuffer);
  }

  const model = await loadModel();
  const tensor = await decodeToTensor(imageBuffer);
  try {
    const predictions = await model.classify(tensor, 5);
    return mapPrediction(predictions);
  } finally {
    tensor.dispose();
  }
}
