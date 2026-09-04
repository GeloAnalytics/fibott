/**
 * Exports real kiosk-captured deposit photos out of Postgres for manual
 * review/annotation, ahead of the next model retrain.
 *
 * Every Deposit row with a stored imageUrl (today: accepted deposits, plus
 * any deposit created through the full image-upload path -- see
 * deposit-image/route.ts's comment above where imageUrl is built) gets
 * written out as a real .jpg file under ml-data/review/, plus one row in
 * ml-data/review/manifest.csv.
 *
 * IMPORTANT: manifest.csv's `currentLabel` column is the model's own guess
 * at capture time -- NOT verified ground truth. Open the photos next to the
 * manifest and fill in `correctedLabel` for any row you know is wrong
 * before running apply-annotations.ts. Leave it blank if the guess was
 * actually right, or write SKIP to drop a photo entirely (blurry, empty
 * chute, unusable, etc).
 *
 * Usage:
 *   npm run ml:export-deposits
 *   npm run ml:export-deposits -- --since 2026-09-01   (optional cutoff date)
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import fs from "fs";
import path from "path";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
// Relative import, not the "@/..." alias -- matches the existing scripts/ml/*
// convention (see train.ts) since tsx doesn't reliably resolve tsconfig path
// aliases for real (non type-only) runtime imports.
import { PrismaClient } from "../../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const OUT_DIR = path.join(process.cwd(), "ml-data", "review");
const MANIFEST_PATH = path.join(OUT_DIR, "manifest.csv");

function parseArgs(argv: string[]) {
  const result: { since?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since") result.since = argv[++i];
  }
  return result;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not found in .env / .env.local -- can't reach the database.");
  }

  const { since } = parseArgs(process.argv.slice(2));
  const sinceDate = since ? new Date(since) : undefined;
  if (since && (!sinceDate || Number.isNaN(sinceDate.getTime()))) {
    throw new Error(`Invalid --since date: "${since}" (expected e.g. 2026-09-01)`);
  }

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const deposits = await prisma.deposit.findMany({
    where: {
      imageUrl: { not: null },
      ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      status: true,
      materialType: true,
      classificationLabel: true,
      classificationConfidence: true,
      imageUrl: true,
    },
  });

  await prisma.$disconnect();

  if (deposits.length === 0) {
    console.log("No deposits with a stored image were found. Nothing to export.");
    return;
  }

  const rows: string[] = [
    "id,createdAt,status,currentLabel,classificationLabel,confidence,filename,correctedLabel",
  ];

  let written = 0;
  let skipped = 0;

  for (const dep of deposits) {
    const url = dep.imageUrl ?? "";
    const match = url.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!match) {
      console.warn(`  skip ${dep.id} -- imageUrl isn't a base64 data URL (unexpected format)`);
      skipped++;
      continue;
    }

    const [, mimeType, base64Data] = match;
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const filename = `deposit-${dep.createdAt.toISOString().slice(0, 10)}-${dep.id}.${ext}`;
    const buffer = Buffer.from(base64Data, "base64");
    fs.writeFileSync(path.join(OUT_DIR, filename), buffer);

    rows.push(
      [
        dep.id,
        dep.createdAt.toISOString(),
        dep.status,
        dep.materialType,
        csvEscape(dep.classificationLabel),
        dep.classificationConfidence.toFixed(4),
        filename,
        "", // correctedLabel: PET_BOTTLE / ALUMINUM_CAN / REJECTED / SKIP / (blank = currentLabel is correct)
      ].join(",")
    );
    written++;
    console.log(`[${written}/${deposits.length}] ${dep.materialType} (${dep.status}, ${buffer.length}B) -> ${filename}`);
  }

  fs.writeFileSync(MANIFEST_PATH, rows.join("\n") + "\n");

  console.log(`\nExported ${written} photo(s) to ml-data/review/`);
  if (skipped > 0) console.log(`Skipped ${skipped} row(s) with an unexpected imageUrl format.`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open ml-data/review/ and look at each photo alongside manifest.csv`);
  console.log(`     (any spreadsheet app or text editor works for the CSV).`);
  console.log(`  2. Where currentLabel is WRONG, set correctedLabel to the true value:`);
  console.log(`     PET_BOTTLE, ALUMINUM_CAN, or REJECTED. Leave it blank if currentLabel`);
  console.log(`     is already correct. Use SKIP to exclude an unusable photo entirely.`);
  console.log(`  3. npm run ml:apply-annotations`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
