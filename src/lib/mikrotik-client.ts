import crypto from "crypto";
import http from "http";
import https from "https";

export interface CreateHotspotVoucherParams {
  durationMinutes: number;
  label: string;
}

export type MikrotikErrorCategory =
  | "MIKROTIK_HOST_NOT_CONFIGURED"
  | "MIKROTIK_DNS_FAILED"
  | "MIKROTIK_CONNECTION_TIMEOUT"
  | "MIKROTIK_CONNECTION_REFUSED"
  | "MIKROTIK_HOST_UNREACHABLE"
  | "MIKROTIK_AUTH_FAILED"
  | "MIKROTIK_PERMISSION_DENIED"
  | "MIKROTIK_PROFILE_NOT_FOUND"
  | "MIKROTIK_VALIDATION_ERROR"
  | "MIKROTIK_REQUEST_FAILED";

export interface CreateHotspotVoucherResult {
  success: boolean;
  voucherRef?: string;
  code?: string;
  expiresAt?: Date;
  errorMessage?: string;
  errorCategory?: MikrotikErrorCategory;
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

export function generateVoucherCode(): string {
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

    const host = baseUrl.hostname;
    const port = options.port as number;

    req.on("timeout", () => {
      const err = new Error(
        `MikroTik request to ${host}:${port} timed out after 8s with no response. Either this machine can't reach the router's network (not on its LAN/WiFi, or MIKROTIK_HOST IP/DDNS is unreachable), or the router's REST API (www/www-ssl service) isn't responding on port ${port}.`
      );
      (err as unknown as { code: string }).code = "ETIMEDOUT";
      req.destroy(err);
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      reject(error);
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function classifyErrorCategory(error: unknown, statusCode?: number, rawBody?: string): MikrotikErrorCategory {
  if (statusCode === 401) {
    return "MIKROTIK_AUTH_FAILED";
  }
  if (statusCode === 403) {
    return "MIKROTIK_PERMISSION_DENIED";
  }
  if (rawBody && /profile/i.test(rawBody) && /no such|unknown|not found|invalid/i.test(rawBody)) {
    return "MIKROTIK_PROFILE_NOT_FOUND";
  }
  if (statusCode === 400 || statusCode === 422) {
    if (rawBody && /profile/i.test(rawBody)) {
      return "MIKROTIK_PROFILE_NOT_FOUND";
    }
    return "MIKROTIK_VALIDATION_ERROR";
  }
  if (error instanceof Error) {
    if (error.message.includes("MIKROTIK_HOST is not configured")) {
      return "MIKROTIK_HOST_NOT_CONFIGURED";
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT" || error.message.includes("timed out")) return "MIKROTIK_CONNECTION_TIMEOUT";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "MIKROTIK_DNS_FAILED";
    if (code === "ECONNREFUSED") return "MIKROTIK_CONNECTION_REFUSED";
    if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return "MIKROTIK_HOST_UNREACHABLE";
  }
  return "MIKROTIK_REQUEST_FAILED";
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
   * If host is "mock" or ALLOW_MOCK_VOUCHER="true", generates a mock voucher code for testing.
   */
  async createHotspotVoucher(
    params: CreateHotspotVoucherParams
  ): Promise<CreateHotspotVoucherResult> {
    const code = generateVoucherCode();

    if (this.config.host === "mock" || process.env.ALLOW_MOCK_VOUCHER === "true") {
      return {
        success: true,
        voucherRef: `MOCK-${Date.now()}`,
        code,
        expiresAt: new Date(Date.now() + params.durationMinutes * 60_000),
      };
    }

    try {
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
        const errorMsg = getErrorMessage(
          response.rawBody,
          `RouterOS returned HTTP ${response.statusCode}`
        );
        return {
          success: false,
          errorMessage: errorMsg,
          errorCategory: classifyErrorCategory(null, response.statusCode, response.rawBody),
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
        errorCategory: classifyErrorCategory(error),
      };
    }
  }
}

export function getMikrotikClient(): MikrotikClient {
  return new MikrotikClient({
    host: process.env.MIKROTIK_HOST ?? "",
    user: process.env.MIKROTIK_USER ?? "",
    password: process.env.MIKROTIK_PASSWORD ?? "",
    hotspotProfile: process.env.MIKROTIK_HOTSPOT_PROFILE ?? "1hour",
    protocol: (process.env.MIKROTIK_PROTOCOL as "http" | "https" | undefined) ?? "https",
    port: process.env.MIKROTIK_PORT ? Number(process.env.MIKROTIK_PORT) : undefined,
    insecureTls: process.env.MIKROTIK_INSECURE_TLS === "true",
  });
}

