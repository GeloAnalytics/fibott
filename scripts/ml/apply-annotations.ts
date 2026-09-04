/**
 * Reads ml-data/review/manifest.csv (after you've filled in the
 * `correctedLabel` column -- see export-deposits.ts) and sorts each reviewed
 * photo into the labeled ml-data/ folders that scripts/ml/train.ts and
 * retrain_esp32_model_v3.py already read from.
 *
 *   correctedLabel blank                       -> keep currentLabel
 *   correctedLabel = SKIP                       -> excluded entirely
 *   correctedLabel = PET_BOTTLE / ALUMINUM_CAN / REJECTED -> use that instead
 *
 * Source detection for the retrain scripts is purely by file size (see
 * retrain_esp32_model_v3.py -- under ~50KB counts as a real photo), so real
 * kiosk captures exported here are picked up correctly with no special
 * naming needed. Files are prefixed "real-deposit-<depositId>" so they stay
 * traceable back to the original Deposit row.
 *
 * Usage:
 *   npm run ml:apply-annotations
 */
import fs from "fs";
import path from "path";

const REVIEW_DIR = path.join(process.cwd(), "ml-data", "review");
const MANIFEST_PATH = path.join(REVIEW_DIR, "manifest.csv");
const DATA_DIR = path.join(process.cwd(), "ml-data");
const LOG_PATH = path.join(DATA_DIR, "import-log.jsonl");
const VALID_LABELS = new Set(["PET_BOTTLE", "ALUMINUM_CAN", "REJECTED"]);

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`No manifest found at ${MANIFEST_PATH} -- run "npm run ml:export-deposits" first.`);
  }

  const lines = fs
    .readFileSync(MANIFEST_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  const header = parseCsvLine(lines[0]);
  const col = (name: string) => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`manifest.csv is missing expected column "${name}"`);
    return idx;
  };

  const idxId = col("id");
  const idxCurrent = col("currentLabel");
  const idxFilename = col("filename");
  const idxCorrected = col("correctedLabel");

  let sorted = 0;
  let skippedMissing = 0;
  let skippedByUser = 0;
  let unchanged = 0;
  let corrected = 0;

  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const id = fields[idxId];
    const currentLabel = fields[idxCurrent];
    const filename = fields[idxFilename];
    const correctedRaw = (fields[idxCorrected] ?? "").trim();

    const srcPath = path.join(REVIEW_DIR, filename);
    if (!fs.existsSync(srcPath)) {
      console.warn(`  skip ${id} -- ${filename} not found in ml-data/review/ (already processed?)`);
      skippedMissing++;
      continue;
    }

    if (correctedRaw.toUpperCase() === "SKIP") {
      skippedByUser++;
      continue;
    }

    let finalLabel = currentLabel;
    if (correctedRaw.length > 0) {
      if (!VALID_LABELS.has(correctedRaw)) {
        console.warn(
          `  skip ${id} -- invalid correctedLabel "${correctedRaw}" ` +
            `(expected PET_BOTTLE, ALUMINUM_CAN, REJECTED, or SKIP)`
        );
        continue;
      }
      finalLabel = correctedRaw;
      corrected++;
    } else {
      unchanged++;
    }

    const destDir = path.join(DATA_DIR, finalLabel);
    fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(filename) || ".jpg";
    const destFilename = `real-deposit-${id}${ext}`;
    const destPath = path.join(destDir, destFilename);

    fs.copyFileSync(srcPath, destPath);
    fs.appendFileSync(
      LOG_PATH,
      JSON.stringify({
        source: "live-deposit",
        depositId: id,
        originalGuess: currentLabel,
        finalLabel,
        wasCorrected: finalLabel !== currentLabel,
        filename: path.relative(DATA_DIR, destPath),
        importedAt: new Date().toISOString(),
      }) + "\n"
    );
    fs.unlinkSync(srcPath); // done with this one -- remove from the review inbox
    sorted++;
    console.log(
      `[${sorted}] ${id} -> ${finalLabel}/${destFilename}${finalLabel !== currentLabel ? "  (corrected)" : ""}`
    );
  }

  console.log(
    `\nSorted ${sorted} photo(s) into ml-data/ (${corrected} corrected, ${unchanged} kept as-is), ` +
      `skipped ${skippedByUser} by request, ${skippedMissing} missing.`
  );
  console.log(`\nNext: python scripts/ml/retrain_esp32_model_v3.py   (the on-device ESP32 model)`);
  console.log(`      then: python scripts/ml/finalize_esp32_model_v3.py`);
}

main();
