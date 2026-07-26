/**
 * Imports the TACO dataset directly from an annotations.json file.
 *
 * This is the practical path for the archive the user provided:
 * - PET_BOTTLE: clear/other plastic bottles
 * - ALUMINUM_CAN: drink cans
 * - REJECTED: images that do not contain either target class
 *
 * Usage:
 *   npm run ml:import:taco -- --annotations "C:\\path\\to\\annotations.json"
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";

type Label = "PET_BOTTLE" | "ALUMINUM_CAN" | "REJECTED";

interface TacoImage {
  id: number;
  file_name: string;
  flickr_url?: string | null;
  flickr_640_url?: string | null;
}

interface TacoCategory {
  id: number;
  name: string;
}

interface TacoAnnotation {
  image_id: number;
  category_id: number;
}

interface TacoAnnotations {
  images: TacoImage[];
  categories: TacoCategory[];
  annotations: TacoAnnotation[];
}

interface DatasetItem {
  url: string;
  label: Label;
  filename: string;
  source: string;
}

const DATA_DIR = path.join(process.cwd(), "ml-data");
const LOG_PATH = path.join(DATA_DIR, "import-log.jsonl");
const VALID_LABELS = new Set<Label>(["PET_BOTTLE", "ALUMINUM_CAN", "REJECTED"]);

const BOTTLE_CATEGORY_IDS = new Set([4, 5]);
// 10 = Food Can (same cylindrical shape; useful for gate sorting even though tin, not aluminium)
const CAN_CATEGORY_IDS = new Set([10, 12]);

function parseArgs(argv: string[]) {
  const result: { annotations?: string; maxPerLabel?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--annotations") {
      result.annotations = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--max-per-label") {
      result.maxPerLabel = Number(argv[i + 1]);
      i++;
    }
  }
  return result;
}

function sanitizeFilename(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80) || "image";
}

function loadAnnotations(annotationsPath: string): TacoAnnotations {
  const raw = fs.readFileSync(annotationsPath, "utf8");
  const parsed = JSON.parse(raw) as TacoAnnotations;
  if (!Array.isArray(parsed.images) || !Array.isArray(parsed.categories) || !Array.isArray(parsed.annotations)) {
    throw new Error("annotations.json is missing images, categories, or annotations arrays");
  }
  return parsed;
}

function chooseLabel(categoryIds: Set<number>): Label | null {
  const hasBottle = [...categoryIds].some((id) => BOTTLE_CATEGORY_IDS.has(id));
  const hasCan = [...categoryIds].some((id) => CAN_CATEGORY_IDS.has(id));

  if (hasBottle && hasCan) return null;
  if (hasBottle) return "PET_BOTTLE";
  if (hasCan) return "ALUMINUM_CAN";
  return "REJECTED";
}

async function downloadImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Fibott/1.0 (TACO importer)",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.startsWith("image/")) {
      throw new Error(`Unexpected content-type: ${contentType}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const { annotations, maxPerLabel } = parseArgs(process.argv.slice(2));
  if (!annotations) {
    throw new Error("Missing --annotations path/to/annotations.json");
  }

  const annotationsPath = path.resolve(process.cwd(), annotations);
  if (!fs.existsSync(annotationsPath)) {
    throw new Error(`annotations.json not found: ${annotationsPath}`);
  }

  const data = loadAnnotations(annotationsPath);
  const imageById = new Map<number, TacoImage>();
  for (const image of data.images) {
    imageById.set(image.id, image);
  }

  const annotationGroups = new Map<number, Set<number>>();
  for (const annotation of data.annotations) {
    if (!annotationGroups.has(annotation.image_id)) {
      annotationGroups.set(annotation.image_id, new Set());
    }
    annotationGroups.get(annotation.image_id)!.add(annotation.category_id);
  }

  const itemsByLabel: Record<Label, DatasetItem[]> = {
    PET_BOTTLE: [],
    ALUMINUM_CAN: [],
    REJECTED: [],
  };

  for (const image of data.images) {
    const categoryIds = annotationGroups.get(image.id) ?? new Set<number>();
    const label = chooseLabel(categoryIds);
    if (!label) continue;

    const url = image.flickr_640_url || image.flickr_url;
    if (!url) continue;

    itemsByLabel[label].push({
      url,
      label,
      source: `TACO image ${image.file_name}`,
      filename: `${sanitizeFilename(path.basename(image.file_name, path.extname(image.file_name)))}.jpg`,
    });
  }

  const limit = Number.isFinite(maxPerLabel ?? NaN) && (maxPerLabel ?? 0) > 0 ? (maxPerLabel as number) : 100;
  const selected: DatasetItem[] = [];
  for (const label of Object.keys(itemsByLabel) as Label[]) {
    const sample = itemsByLabel[label].slice(0, limit);
    console.log(`${label}: ${itemsByLabel[label].length} available, importing ${sample.length}`);
    selected.push(...sample);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  let imported = 0;
  let failed = 0;
  for (const [index, item] of selected.entries()) {
    if (!VALID_LABELS.has(item.label)) {
      throw new Error(`Invalid label at item ${index + 1}: ${item.label}`);
    }

    let original: Buffer;
    try {
      original = await downloadImage(item.url);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[skip] ${item.source}: ${msg}`);
      continue;
    }

    let normalized: Buffer;
    try {
      normalized = await sharp(original)
        .rotate()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toBuffer();
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[skip] ${item.source} (sharp failed): ${msg}`);
      continue;
    }

    const labelDir = path.join(DATA_DIR, item.label);
    fs.mkdirSync(labelDir, { recursive: true });

    const hash = crypto.createHash("sha1").update(item.url).digest("hex").slice(0, 8);
    const outPath = path.join(labelDir, `${item.filename.replace(/\.jpg$/i, "")}-${hash}.jpg`);
    fs.writeFileSync(outPath, normalized);

    fs.appendFileSync(
      LOG_PATH,
      JSON.stringify({
        url: item.url,
        label: item.label,
        filename: path.relative(DATA_DIR, outPath),
        source: item.source,
        importedAt: new Date().toISOString(),
        dataset: "TACO",
      }) + "\n"
    );

    imported++;
    if (imported % 10 === 0 || imported === selected.length) {
      console.log(`[${imported}/${selected.length - failed}] imported (${failed} skipped)`);
    }
  }

  console.log(`\nImported ${imported} image(s), skipped ${failed} — ml-data/ is ready.`);
  if (imported > 0) console.log(`Next: review the folders, then run npm run ml:train`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
