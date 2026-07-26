/**
 * Legacy local capture helper for when a live ESP32-CAM dataset is available.
 *
 * The current working plan in this repo uses internet-sourced images instead,
 * so this server is no longer the primary ML data path. It remains here as a
 * convenience if you ever want to stage local captures again.
 *
 * Usage:
 *   npm run ml:collect
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";

const INBOX = path.join(process.cwd(), "ml-data", "inbox");
fs.mkdirSync(INBOX, { recursive: true });

let counter = 0;

function extractJpeg(body: Buffer, boundary: string): Buffer | null {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const doubleCRLF = Buffer.from("\r\n\r\n");

  let pos = 0;
  while (pos < body.length) {
    const bPos = body.indexOf(boundaryBuf, pos);
    if (bPos === -1) break;

    const headerStart = bPos + boundaryBuf.length + 2; // skip \r\n after boundary
    const headerEnd = body.indexOf(doubleCRLF, headerStart);
    if (headerEnd === -1) break;

    const header = body.slice(headerStart, headerEnd).toString();
    if (header.includes('name="image"') || header.includes("image/jpeg")) {
      const dataStart = headerEnd + 4; // skip \r\n\r\n
      const nextBoundary = body.indexOf(boundaryBuf, dataStart);
      if (nextBoundary === -1) return null;
      return body.slice(dataStart, nextBoundary - 2); // trim trailing \r\n
    }

    pos = bPos + 1;
  }
  return null;
}

function getLanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return "localhost";
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] ?? "";
    const match = contentType.match(/boundary=([^\s;]+)/);

    if (!match) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Missing boundary" }));
      return;
    }

    const jpeg = extractJpeg(body, match[1]);
    if (!jpeg) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "No image part found" }));
      return;
    }

    const filename = `capture_${Date.now()}_${++counter}.jpg`;
    const filepath = path.join(INBOX, filename);
    fs.writeFileSync(filepath, jpeg);
    console.log(`[${counter}] saved ml-data/inbox/${filename}  (${jpeg.length} bytes)`);

    // Return ACCEPT so the ESP32-CAM opens the gate during collection
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        decision: "ACCEPT",
        servoAction: "ACCEPT",
        classification: { materialType: "PET_BOTTLE", label: "collect-mode", confidence: 1.0 },
      })
    );
  });
});

const PORT = 3002;
const lanIp = getLanIp();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nFibott ML collect server — port ${PORT} (bridge uses 3001, collect uses 3002)`);
  console.log(`\nIn firmware/esp32-cam/config.h, set:`);
  console.log(`  #define BACKEND_HOST  "${lanIp}"`);
  console.log(`  #define BACKEND_PORT  ${PORT}  // (not 3001 — that is the bridge)`);
  console.log(`  // Revert to your Vercel hostname + 443 after collection.`);
  console.log(`\nImages land in: ml-data/inbox/`);
  console.log(`Sort them into: ml-data/PET_BOTTLE/  ml-data/ALUMINUM_CAN/  ml-data/REJECTED/`);
  console.log(`Then run:       npm run ml:train\n`);
});
