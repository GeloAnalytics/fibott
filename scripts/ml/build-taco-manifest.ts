/**
 * Builds a reusable manifest from a TACO annotations.json file.
 *
 * This does not download images. It extracts the candidate URLs and labels
 * from the archive so the dataset can be imported later in an environment
 * that can reach Flickr.
 *
 * Usage:
 *   npm run ml:taco-manifest -- --annotations "C:\\path\\to\\annotations.json"
 */
import fs from "fs";
import path from "path";

type Label = "PET_BOTTLE" | "ALUMINUM_CAN" | "REJECTED";

interface TacoImage {
  id: number;
  file_name: string;
  flickr_url?: string | null;
  flickr_640_url?: string | null;
}

interface TacoAnnotation {
  image_id: number;
  category_id: number;
}

interface TacoAnnotations {
  images: TacoImage[];
  annotations: TacoAnnotation[];
}

interface ManifestItem {
  url: string;
  label: Label;
  filename: string;
  source: string;
}

const DATA_DIR = path.join(process.cwd(), "ml-data");
const OUTPUT_PATH = path.join(DATA_DIR, "taco-manifest.json");
const BOTTLE_CATEGORY_IDS = new Set([4, 5]);
const CAN_CATEGORY_IDS = new Set([12]);

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
  if (!Array.isArray(parsed.images) || !Array.isArray(parsed.annotations)) {
    throw new Error("annotations.json is missing images or annotations arrays");
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

function main() {
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

  const itemsByLabel: Record<Label, ManifestItem[]> = {
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
      filename: `${sanitizeFilename(path.basename(image.file_name, path.extname(image.file_name)))}.jpg`,
      source: `TACO image ${image.file_name}`,
    });
  }

  const limit = Number.isFinite(maxPerLabel ?? NaN) && (maxPerLabel ?? 0) > 0 ? (maxPerLabel as number) : undefined;
  const items = (Object.keys(itemsByLabel) as Label[]).flatMap((label) => {
    const pool = itemsByLabel[label];
    return typeof limit === "number" ? pool.slice(0, limit) : pool;
  });

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: annotationsPath,
        counts: {
          PET_BOTTLE: itemsByLabel.PET_BOTTLE.length,
          ALUMINUM_CAN: itemsByLabel.ALUMINUM_CAN.length,
          REJECTED: itemsByLabel.REJECTED.length,
        },
        selected: items.length,
        items,
      },
      null,
      2
    )
  );

  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);
  console.log(`PET_BOTTLE: ${itemsByLabel.PET_BOTTLE.length}`);
  console.log(`ALUMINUM_CAN: ${itemsByLabel.ALUMINUM_CAN.length}`);
  console.log(`REJECTED: ${itemsByLabel.REJECTED.length}`);
  console.log(`Selected: ${items.length}`);
}

main();
