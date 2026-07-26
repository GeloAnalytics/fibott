/**
 * Imports internet-sourced images into the labeled ML dataset folders.
 *
 * Expected manifest format:
 *
 * {
 *   "items": [
 *     { "url": "https://...", "label": "PET_BOTTLE", "filename": "bottle-001.jpg" },
 *     { "url": "https://...", "label": "REJECTED" }
 *   ]
 * }
 *
 * or a plain array of the same objects.
 *
 * Usage:
 *   npm run ml:import -- --manifest path/to/manifest.json
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";

type Label = "PET_BOTTLE" | "ALUMINUM_CAN" | "REJECTED";

interface ImportEntry {
  url: string;
  label: Label;
  filename?: string;
  source?: string;
  note?: string;
}

interface ImportManifest {
  items: ImportEntry[];
}

const VALID_LABELS = new Set<Label>(["PET_BOTTLE", "ALUMINUM_CAN", "REJECTED"]);
const DATA_DIR = path.join(process.cwd(), "ml-data");
const LOG_PATH = path.join(DATA_DIR, "import-log.jsonl");

function parseArgs(argv: string[]) {
  const result: { manifest?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest") {
      result.manifest = argv[i + 1];
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

function loadManifest(manifestPath: string): ImportManifest {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as ImportManifest | ImportEntry[];
  const items = Array.isArray(parsed) ? parsed : parsed.items;

  if (!Array.isArray(items)) {
    throw new Error("Manifest must be an array or an object with an items array");
  }

  return { items: items as ImportEntry[] };
}

async function downloadImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // A normal browser-like UA helps some public image hosts.
        "user-agent": "Fibott/1.0 (dataset importer)",
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
  const { manifest } = parseArgs(process.argv.slice(2));
  if (!manifest) {
    throw new Error("Missing --manifest path/to/manifest.json");
  }

  const manifestPath = path.resolve(process.cwd(), manifest);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const { items } = loadManifest(manifestPath);
  if (!items.length) {
    throw new Error("Manifest contains no items");
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  let imported = 0;
  for (const [index, item] of items.entries()) {
    if (!VALID_LABELS.has(item.label)) {
      throw new Error(`Invalid label at item ${index + 1}: ${String(item.label)}`);
    }
    if (!item.url) {
      throw new Error(`Missing url at item ${index + 1}`);
    }

    new URL(item.url);
    const original = await downloadImage(item.url);
    const normalized = await sharp(original)
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();

    const labelDir = path.join(DATA_DIR, item.label);
    fs.mkdirSync(labelDir, { recursive: true });

    const baseName = item.filename
      ? sanitizeFilename(item.filename)
      : sanitizeFilename(path.basename(new URL(item.url).pathname) || "image");
    const hash = crypto.createHash("sha1").update(item.url).digest("hex").slice(0, 8);
    const filename = `${baseName}-${hash}.jpg`;
    const outPath = path.join(labelDir, filename);

    fs.writeFileSync(outPath, normalized);
    fs.appendFileSync(
      LOG_PATH,
      JSON.stringify({
        url: item.url,
        label: item.label,
        filename: path.relative(DATA_DIR, outPath),
        source: item.source ?? null,
        note: item.note ?? null,
        importedAt: new Date().toISOString(),
      }) + "\n"
    );

    imported++;
    console.log(`[${imported}/${items.length}] ${item.label} -> ${path.relative(process.cwd(), outPath)}`);
  }

  console.log(`\nImported ${imported} image(s) into ml-data/.`);
  console.log(`Next: inspect the labeled folders, then run npm run ml:train`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
