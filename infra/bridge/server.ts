/**
 * Fibott Bridge Service
 *
 * Runs on the LAN machine alongside the MikroTik router.
 * Receives authenticated requests from Vercel (via ngrok tunnel) and
 * forwards them to the RouterOS REST API.
 *
 * Usage (from project root):
 *   npm run bridge:start
 *
 * Required env vars (in .env.local or environment):
 *   BRIDGE_SECRET            - shared secret, must match BRIDGE_SECRET on Vercel
 *   MIKROTIK_HOST            - router IP, e.g. 192.168.88.1
 *   MIKROTIK_USER            - RouterOS user with rest-api access
 *   MIKROTIK_PASSWORD        - password for that user
 *   MIKROTIK_HOTSPOT_PROFILE - default hotspot user profile (e.g. 1hour)
 *   BRIDGE_PORT              - port to listen on (default: 3001)
 */

import http from "http";
import https from "https";
import crypto from "crypto";
import path from "path";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local") });

const PORT = Number(process.env.BRIDGE_PORT ?? 3001);
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "";
const MIKROTIK_HOST = process.env.MIKROTIK_HOST ?? "";
const MIKROTIK_USER = process.env.MIKROTIK_USER ?? "";
const MIKROTIK_PASSWORD = process.env.MIKROTIK_PASSWORD ?? "";
const MIKROTIK_PROTOCOL = (process.env.MIKROTIK_PROTOCOL ?? "http") as "http" | "https";
const MIKROTIK_HOTSPOT_PROFILE = process.env.MIKROTIK_HOTSPOT_PROFILE ?? "default";
const MIKROTIK_PORT = process.env.MIKROTIK_PORT ? Number(process.env.MIKROTIK_PORT) : undefined;
const MIKROTIK_INSECURE_TLS = process.env.MIKROTIK_INSECURE_TLS === "true";

const VOUCHER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateVoucherCode(): string {
  const bytes = crypto.randomBytes(12);
  let token = "";
  for (let i = 0; i < bytes.length; i++) {
    token += VOUCHER_ALPHABET[bytes[i] % VOUCHER_ALPHABET.length];
  }
  return `FBT-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}`;
}

function mikrotikRequest(
  method: string,
  routePath: string,
  body?: unknown
): Promise<{ status: number; json: unknown }> {
  const isHttps = MIKROTIK_PROTOCOL === "https";
  const port = MIKROTIK_PORT ?? (isHttps ? 443 : 80);
  const payload = body === undefined ? "" : JSON.stringify(body);
  const agent = isHttps ? new https.Agent({ rejectUnauthorized: !MIKROTIK_INSECURE_TLS }) : undefined;

  const options: http.RequestOptions = {
    protocol: `${MIKROTIK_PROTOCOL}:`,
    hostname: MIKROTIK_HOST,
    port,
    path: routePath,
    method,
    timeout: 8000,
    agent,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${MIKROTIK_USER}:${MIKROTIK_PASSWORD}`).toString("base64")}`,
      ...(body !== undefined
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        : {}),
    },
  };

  return new Promise((resolve, reject) => {
    const client = isHttps ? https : http;
    const req = client.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json: unknown = null;
        try { json = JSON.parse(raw); } catch { json = null; }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("timeout", () => req.destroy(new Error("MikroTik request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    return json(res, 200, { ok: true, host: MIKROTIK_HOST });
  }

  if (req.url !== "/voucher" || req.method !== "POST") {
    return json(res, 404, { error: "Not found" });
  }

  // Auth check
  if (!BRIDGE_SECRET || req.headers.authorization !== `Bearer ${BRIDGE_SECRET}`) {
    return json(res, 401, { error: "Unauthorized" });
  }

  // Parse body
  let body: { durationMinutes?: number; userId?: string };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  const profile = MIKROTIK_HOTSPOT_PROFILE;
  const durationMinutes = typeof body.durationMinutes === "number" && body.durationMinutes > 0
    ? body.durationMinutes
    : 60;
  const limitUptime = `${durationMinutes}m`;

  const code = generateVoucherCode();

  try {
    const result = await mikrotikRequest("PUT", "/rest/ip/hotspot/user", {
      name: code,
      password: code,
      profile,
      comment: `fibott:uid=${body.userId ?? "unknown"}`,
      "limit-uptime": limitUptime,
    });

    if (result.status < 200 || result.status >= 300) {
      const msg = (result.json as Record<string, string> | null)?.detail
        ?? (result.json as Record<string, string> | null)?.message
        ?? `RouterOS HTTP ${result.status}`;
      console.error(`[bridge] MikroTik error ${result.status}: ${msg}`);
      return json(res, 502, { error: msg });
    }

    console.log(`[bridge] Created voucher ${code} (profile: ${profile}, user: ${body.userId ?? "unknown"})`);
    return json(res, 200, { success: true, code });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Bridge error";
    console.error(`[bridge] ${msg}`);
    return json(res, 502, { error: msg });
  }
});

server.listen(PORT, () => {
  if (!BRIDGE_SECRET) console.warn("[bridge] WARNING: BRIDGE_SECRET is not set — all requests will be rejected");
  if (!MIKROTIK_HOST) console.warn("[bridge] WARNING: MIKROTIK_HOST is not set");
  console.log(`[bridge] Fibott bridge listening on http://localhost:${PORT}`);
  console.log(`[bridge] → MikroTik: ${MIKROTIK_PROTOCOL}://${MIKROTIK_HOST}`);
});
