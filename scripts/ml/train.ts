/**
 * Fine-tunes a small classifier head on top of frozen MobileNet embeddings,
 * using your own labeled kiosk images — the fix for classifier.ts's
 * zero-shot ImageNet fallback not having a real "beverage can" class.
 *
 * Usage:
 *   1. Collect photos from the actual ESP32-CAM (same lighting/background/
 *      distance you'll see in production — that match matters far more
 *      than volume).
 *   2. Sort them into:
 *        ml-data/PET_BOTTLE/*.jpg
 *        ml-data/ALUMINUM_CAN/*.jpg
 *        ml-data/REJECTED/*.jpg      (empty chute, hands, random trash —
 *                                      anything that should NOT accept)
 *      Aim for at least ~40-50 images per class to start; more is better,
 *      and REJECTED should cover a wide variety of "not a bottle/can" cases.
 *   3. npx tsx scripts/ml/train.ts
 *   4. Output goes to models/bottle-can-head/weights.json — classifier.ts
 *      picks it up automatically next time the server starts (or set
 *      FIBOTT_ML_HEAD_PATH to point elsewhere).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import * as tf from "@tensorflow/tfjs";
import { embedImage } from "../../src/lib/classifier";

const DATA_DIR = path.join(process.cwd(), "ml-data");
const OUTPUT_PATH = path.join(process.cwd(), "models", "bottle-can-head", "weights.json");
const LABELS = ["PET_BOTTLE", "ALUMINUM_CAN", "REJECTED"] as const;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const EPOCHS = 30;

async function loadDataset(): Promise<{ embeddings: Float32Array[]; labelIndices: number[] }> {
  const embeddings: Float32Array[] = [];
  const labelIndices: number[] = [];

  for (const [labelIndex, label] of LABELS.entries()) {
    const dir = path.join(DATA_DIR, label);
    if (!fs.existsSync(dir)) {
      console.warn(`Missing ${dir} — skipping (0 images for ${label})`);
      continue;
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()));

    console.log(`${label}: ${files.length} images`);
    for (const file of files) {
      const buffer = fs.readFileSync(path.join(dir, file));
      embeddings.push(await embedImage(buffer));
      labelIndices.push(labelIndex);
    }
  }

  return { embeddings, labelIndices };
}

async function main() {
  const { embeddings, labelIndices } = await loadDataset();

  if (embeddings.length < LABELS.length * 10) {
    throw new Error(
      `Only ${embeddings.length} labeled images found under ${DATA_DIR}. ` +
        `Collect at least ~10 per class (ideally 40-50+) before training — see the ` +
        `usage note at the top of this file.`
    );
  }

  await tf.setBackend("cpu");
  await tf.ready();

  const inputDim = embeddings[0].length;
  const xs = tf.tensor2d(embeddings.map((e) => Array.from(e)));
  const ys = tf.oneHot(tf.tensor1d(labelIndices, "int32"), LABELS.length);

  const head = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [inputDim], units: LABELS.length, activation: "softmax" }),
    ],
  });
  head.compile({ optimizer: tf.train.adam(0.001), loss: "categoricalCrossentropy", metrics: ["accuracy"] });

  await head.fit(xs, ys, {
    epochs: EPOCHS,
    validationSplit: 0.2,
    shuffle: true,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        console.log(
          `epoch ${epoch + 1}/${EPOCHS} — loss ${logs?.loss?.toFixed(4)} acc ${logs?.acc?.toFixed(4)} ` +
            `val_acc ${logs?.val_acc?.toFixed(4)}`
        );
      },
    },
  });

  const [kernel, bias] = head.getWeights();
  const serialized = {
    inputDim,
    labels: LABELS,
    weights: [
      { shape: kernel.shape, data: Array.from(await kernel.data()) },
      { shape: bias.shape, data: Array.from(await bias.data()) },
    ],
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(serialized));
  console.log(`\nSaved fine-tuned head to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
