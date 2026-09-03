import "dotenv/config";
import fs from "fs";
import path from "path";
import { classifyImage } from "../../src/lib/classifier";

const DATA_DIR = path.join(process.cwd(), "ml-data");
const LABELS = ["PET_BOTTLE", "ALUMINUM_CAN"] as const;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

async function evaluate() {
  console.log("=================================================");
  console.log(" Fibott ML Classifier Side-by-Side Evaluation   ");
  console.log("=================================================\n");

  let totalImages = 0;
  let correctZeroShot = 0;
  let correctHead = 0;

  const resultsByClass: Record<
    string,
    { total: number; zeroShotCorrect: number; headCorrect: number }
  > = {};

  for (const label of LABELS) {
    resultsByClass[label] = { total: 0, zeroShotCorrect: 0, headCorrect: 0 };
    const dir = path.join(DATA_DIR, label);
    if (!fs.existsSync(dir)) continue;

    const files = fs
      .readdirSync(dir)
      .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()));

    console.log(`Evaluating class: ${label} (${files.length} images)...`);

    for (const file of files) {
      totalImages++;
      resultsByClass[label].total++;

      const imagePath = path.join(dir, file);
      const buffer = fs.readFileSync(imagePath);

      // Force zero-shot mode
      process.env.FIBOTT_ML_MODE = "zero-shot";
      const zeroShotRes = await classifyImage(buffer);

      // Force experimental head mode
      process.env.FIBOTT_ML_MODE = "experimental_head";
      const headRes = await classifyImage(buffer);

      const zeroShotMatch = zeroShotRes.materialType === label;
      const headMatch = headRes.materialType === label;

      if (zeroShotMatch) {
        correctZeroShot++;
        resultsByClass[label].zeroShotCorrect++;
      }
      if (headMatch) {
        correctHead++;
        resultsByClass[label].headCorrect++;
      }
    }
  }

  console.log("\n=================================================");
  console.log(" Evaluation Results Summary                     ");
  console.log("=================================================");
  console.log(`Total Images Evaluated: ${totalImages}`);
  if (totalImages > 0) {
    console.log(
      `Zero-Shot MobileNet Accuracy : ${(
        (correctZeroShot / totalImages) *
        100
      ).toFixed(2)}% (${correctZeroShot}/${totalImages})`
    );
    console.log(
      `Fine-Tuned Head Accuracy     : ${(
        (correctHead / totalImages) *
        100
      ).toFixed(2)}% (${correctHead}/${totalImages})`
    );
    console.log("-------------------------------------------------");
    for (const [label, stats] of Object.entries(resultsByClass)) {
      console.log(
        `Class ${label.padEnd(14)}: Zero-Shot ${(
          (stats.zeroShotCorrect / stats.total) *
          100
        ).toFixed(1)}% | Fine-Tuned ${
          ((stats.headCorrect / stats.total) * 100).toFixed(1)
        }%`
      );
    }
  }
  console.log("=================================================\n");
}

evaluate().catch(console.error);
