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
}

export class MikrotikClient {
  constructor(private config: MikrotikConfig) {}

  /**
   * Creates a one-time hotspot user via the RouterOS API (/ip/hotspot/user/add).
   * STUBBED for the foundation pass — no physical router is connected yet.
   * TODO(phase 2): implement via RouterOS REST API once hardware is available.
   */
  async createHotspotVoucher(
    params: CreateHotspotVoucherParams
  ): Promise<CreateHotspotVoucherResult> {
    void this.config;
    const code = `WIFI-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    return {
      success: true,
      voucherRef: `mock-${Date.now()}`,
      code,
      expiresAt: new Date(Date.now() + params.durationMinutes * 60_000),
    };
  }
}

export function getMikrotikClient(): MikrotikClient {
  return new MikrotikClient({
    host: process.env.MIKROTIK_HOST ?? "",
    user: process.env.MIKROTIK_USER ?? "",
    password: process.env.MIKROTIK_PASSWORD ?? "",
    hotspotProfile: process.env.MIKROTIK_HOTSPOT_PROFILE ?? "default",
  });
}
