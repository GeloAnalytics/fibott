/**
 * Fine-tunes a small classifier head on top of frozen MobileNet embeddings.
 *
 * The active dataset plan uses internet-sourced images rather than live
 * ESP32-CAM captures. Keep the labels and the train/validation split clean:
 *
 *   ml-data/PET_BOTTLE/*.jpg
 *   ml-data/ALUMINUM_CAN/*.jpg
 *   ml-data/REJECTED/*.jpg
 *
 * Output goes to models/bottle-can-head/weights.json and is picked up by
 * classifier.ts automatically on the next server start.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import * as tf from "@tensorflow/tfjs";
import { embedImage } from "../../src/lib/classifier";

const DATA_DIR = path.join(process.cwd(), "ml-data");
const OUTPUT_PATH = path.join(process.cwd(), "models", "bottle-can-head", "weights.json");
const ALL_LABELS = ["PET_BOTTLE", "ALUMINUM_CAN", "REJECTED"] as const;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const EPOCHS = 60;
const PATIENCE = 10;

function getActiveLabels(): string[] {
  return ALL_LABELS.filter((label) => {
    const dir = path.join(DATA_DIR, label);
    if (!fs.existsSync(dir)) return false;
    const count = fs.readdirSync(dir).filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase())).length;
    if (count === 0) return false;
    return true;
  });
}

async function loadDataset(labels: string[]): Promise<{ embeddings: Float32Array[]; labelIndices: number[] }> {
  const embeddings: Float32Array[] = [];
  const labelIndices: number[] = [];

  for (const [labelIndex, label] of labels.entries()) {
    const dir = path.join(DATA_DIR, label);
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
  const labels = getActiveLabels();
  if (labels.length < 2) {
    throw new Error(
      `Need at least 2 label directories with images under ${DATA_DIR}. ` +
        `Found: [${labels.join(", ")}]. Populate ml-data/ and retry.`
    );
  }
  console.log(`Training on ${labels.length} classes: ${labels.join(", ")}`);

  const { embeddings, labelIndices } = await loadDataset(labels);

  if (embeddings.length < labels.length * 10) {
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
  const ys = tf.oneHot(tf.tensor1d(labelIndices, "int32"), labels.length);

  // Compute class weights to handle imbalanced datasets (e.g. more bottles than cans).
  const classCounts = new Array(labels.length).fill(0) as number[];
  for (const idx of labelIndices) classCounts[idx]++;
  const maxCount = Math.max(...classCounts);
  const classWeight: Record<number, number> = {};
  for (let i = 0; i < labels.length; i++) {
    classWeight[i] = classCounts[i] > 0 ? maxCount / classCounts[i] : 1;
  }
  console.log("Class weights:", Object.fromEntries(labels.map((l, i) => [l, classWeight[i].toFixed(2)])));

  // Two-layer head: MobileNet features → 128 ReLU → softmax.
  // A single linear layer is logistic regression over the embeddings and
  // underfits when the bottle/can boundary is non-linear in feature space.
  const head = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [inputDim], units: 128, activation: "relu",
        kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 }) }),
      tf.layers.dropout({ rate: 0.4 }),
      tf.layers.dense({ units: labels.length, activation: "softmax" }),
    ],
  });
  head.compile({ optimizer: tf.train.adam(0.001), loss: "categoricalCrossentropy", metrics: ["accuracy"] });

  let bestValAcc = 0;
  let epochsSinceImprovement = 0;
  // Typed as unknown[] so TF generic variance doesn't confuse the narrowing.
  let bestWeights: { dispose(): void }[] | null = null;

  await head.fit(xs, ys, {
    epochs: EPOCHS,
    validationSplit: 0.2,
    shuffle: true,
    classWeight,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        const valAcc = logs?.val_acc ?? 0;
        const marker = valAcc > bestValAcc ? " ✓" : "";
        console.log(
          `epoch ${String(epoch + 1).padStart(2)}/${EPOCHS} — ` +
          `loss ${logs?.loss?.toFixed(4)} acc ${logs?.acc?.toFixed(4)} ` +
          `val_loss ${logs?.val_loss?.toFixed(4)} val_acc ${valAcc.toFixed(4)}${marker}`
        );
        if (valAcc > bestValAcc) {
          bestValAcc = valAcc;
          epochsSinceImprovement = 0;
          bestWeights = head.getWeights().map((w) => w.clone()) as { dispose(): void }[];
        } else {
          epochsSinceImprovement++;
          if (epochsSinceImprovement >= PATIENCE) {
            console.log(`\nEarly stopping at epoch ${epoch + 1} (no val_acc improvement for ${PATIENCE} epochs)`);
            head.stopTraining = true;
          }
        }
      },
    },
  });

  // Restore the best weights before saving.
  // Don't dispose here — weightTensors.forEach(dispose) below handles cleanup
  // after serialization (setWeights keeps a reference to the same tensors).
  if (bestWeights !== null) {
    head.setWeights(bestWeights as unknown as tf.Tensor[]);
  }
  console.log(`\nBest val_acc: ${bestValAcc.toFixed(4)}`);

  const weightTensors = head.getWeights();
  const serialized = {
    inputDim,
    hiddenUnits: 128,
    labels,
    weights: await Promise.all(
      weightTensors.map(async (w) => ({ shape: w.shape, data: Array.from(await w.data()) }))
    ),
  };
  weightTensors.forEach((w) => w.dispose());

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(serialized));
  console.log(`\nSaved fine-tuned head to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
