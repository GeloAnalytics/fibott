import crypto from "crypto";
import http from "http";
import https from "https";

export interface CreateHotspotVoucherParams {
  durationMinutes: number;
  label: string;
}

export interface CreateHotspotVoucherResult {
  success: boolean;
  voucherRef?: string;
  code?: string;
  expiresAt?: Date;
  errorMessage?: string;
}

export interface MikrotikConfig {
  host: string;
  user: string;
  password: string;
  hotspotProfile: string;
  protocol?: "http" | "https";
  port?: number;
  insecureTls?: boolean;
}

const VOUCHER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateVoucherCode(): string {
  const bytes = crypto.randomBytes(12);
  let token = "";
  for (let i = 0; i < bytes.length; i++) {
    token += VOUCHER_ALPHABET[bytes[i] % VOUCHER_ALPHABET.length];
  }

  return `FBT-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}`;
}

function buildBaseUrl(config: MikrotikConfig): URL {
  if (!config.host.trim()) {
    throw new Error("MIKROTIK_HOST is not configured");
  }

  const base = /^https?:\/\//i.test(config.host)
    ? new URL(config.host)
    : new URL(`${config.protocol ?? "https"}://${config.host}`);

  if (config.port && !base.port) {
    base.port = String(config.port);
  } else if (!base.port && config.port) {
    base.port = String(config.port);
  }

  return base;
}

function requestJson(
  config: MikrotikConfig,
  method: "PUT" | "POST" | "PATCH" | "DELETE" | "GET",
  path: string,
  body?: unknown
): Promise<{ statusCode: number; rawBody: string; json: unknown | null }> {
  const baseUrl = buildBaseUrl(config);
  const payload = body === undefined ? "" : JSON.stringify(body);
  const isHttps = baseUrl.protocol === "https:";
  const agent = isHttps
    ? new https.Agent({ rejectUnauthorized: !config.insecureTls })
    : undefined;

  const options: https.RequestOptions = {
    protocol: baseUrl.protocol,
    hostname: baseUrl.hostname,
    port: baseUrl.port ? Number(baseUrl.port) : isHttps ? 443 : 80,
    path,
    method,
    timeout: 8000,
    agent,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${config.user}:${config.password}`).toString("base64")}`,
      ...(body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          }),
    },
  };

  return new Promise((resolve, reject) => {
    const client = isHttps ? https : http;
    const req = client.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        let json: unknown | null = null;
        if (rawBody.trim().length) {
          try {
            json = JSON.parse(rawBody);
          } catch {
            json = null;
          }
        }
        resolve({
          statusCode: res.statusCode ?? 0,
          rawBody,
          json,
        });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("MikroTik request timed out (8 s) — is the www service enabled?"));
    });
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function getErrorMessage(rawBody: string, fallback: string): string {
  if (!rawBody.trim()) return fallback;

  try {
    const parsed = JSON.parse(rawBody) as { message?: string; error?: string; detail?: string };
    return parsed.detail || parsed.message || parsed.error || fallback;
  } catch {
    return rawBody.slice(0, 500) || fallback;
  }
}

export class MikrotikClient {
  constructor(private config: MikrotikConfig) {}

  /**
   * Creates a one-time hotspot user via the RouterOS REST API.
   *
   * This is the real implementation. It does not mock a voucher when the
   * router is misconfigured; instead, it fails loudly so the redeem flow can
   * surface the setup problem.
   */
  async createHotspotVoucher(
    params: CreateHotspotVoucherParams
  ): Promise<CreateHotspotVoucherResult> {
    try {
      const code = generateVoucherCode();
      const response = await requestJson(
        this.config,
        "PUT",
        "/rest/ip/hotspot/user",
        {
          name: code,
          password: code,
          profile: this.config.hotspotProfile,
          comment: params.label,
          "limit-uptime": `${params.durationMinutes}m`,
        }
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        return {
          success: false,
          errorMessage: getErrorMessage(
            response.rawBody,
            `RouterOS returned HTTP ${response.statusCode}`
          ),
        };
      }

      const created = (response.json as Record<string, unknown> | null) ?? null;
      const voucherRef =
        typeof created?.[".id"] === "string"
          ? created[".id"]
          : typeof created?.name === "string"
            ? created.name
            : code;

      return {
        success: true,
        voucherRef,
        code,
        expiresAt: new Date(Date.now() + params.durationMinutes * 60_000),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to reach MikroTik router";
      return {
        success: false,
        errorMessage: message,
      };
    }
  }
}

class BridgeClient {
  constructor(private url: string, private secret: string) {}

  async createHotspotVoucher(
    params: CreateHotspotVoucherParams
  ): Promise<CreateHotspotVoucherResult> {
    try {
      const res = await fetch(`${this.url}/voucher`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.secret}`,
        },
        body: JSON.stringify({
          durationMinutes: params.durationMinutes,
          userId: params.label,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const json = (await res.json()) as { success?: boolean; code?: string; error?: string };

      if (!res.ok || !json.success || !json.code) {
        return { success: false, errorMessage: json.error ?? `Bridge returned HTTP ${res.status}` };
      }

      return {
        success: true,
        code: json.code,
        voucherRef: json.code,
        expiresAt: new Date(Date.now() + params.durationMinutes * 60_000),
      };
    } catch (err) {
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : "Bridge unreachable",
      };
    }
  }
}

export function getMikrotikClient(): MikrotikClient | BridgeClient {
  const bridgeUrl = process.env.BRIDGE_URL?.trim();
  const bridgeSecret = process.env.BRIDGE_SECRET?.trim();
  if (bridgeUrl && bridgeSecret) {
    return new BridgeClient(bridgeUrl, bridgeSecret);
  }
  return new MikrotikClient({
    host: process.env.MIKROTIK_HOST ?? "",
    user: process.env.MIKROTIK_USER ?? "",
    password: process.env.MIKROTIK_PASSWORD ?? "",
    hotspotProfile: process.env.MIKROTIK_HOTSPOT_PROFILE ?? "default",
    protocol: (process.env.MIKROTIK_PROTOCOL as "http" | "https" | undefined) ?? "https",
    port: process.env.MIKROTIK_PORT ? Number(process.env.MIKROTIK_PORT) : undefined,
    insecureTls: process.env.MIKROTIK_INSECURE_TLS === "true",
  });
}
