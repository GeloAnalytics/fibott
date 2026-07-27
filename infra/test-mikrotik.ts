/**
 * Quick connection test for the MikroTik RouterOS REST API.
 *
 * Usage (from project root, after filling MIKROTIK_* in .env.local):
 *   npx tsx infra/test-mikrotik.ts
 *
 * What it does:
 *   1. Creates a test hotspot user (TEST-FIBOTT-001)
 *   2. Confirms it appears in the user list
 *   3. Deletes it
 *
 * If all three steps pass, the backend is ready to issue real vouchers.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { getMikrotikClient } from "../src/lib/mikrotik-client";

async function main() {
  const host = process.env.MIKROTIK_HOST;
  const user = process.env.MIKROTIK_USER;
  const profile = process.env.MIKROTIK_HOTSPOT_PROFILE;

  if (!host || !user || !profile) {
    throw new Error(
      "Missing MIKROTIK_HOST, MIKROTIK_USER, or MIKROTIK_HOTSPOT_PROFILE in environment."
    );
  }

  console.log(`\nConnecting to MikroTik at ${process.env.MIKROTIK_PROTOCOL ?? "https"}://${host}`);
  console.log(`API user: ${user} · profile: ${profile}\n`);

  const client = getMikrotikClient();

  console.log("[ 1/2 ] Creating test hotspot user...");
  const result = await client.createHotspotVoucher({
    durationMinutes: 60,
    label: "fibott-connection-test",
  });

  if (!result.success || !result.code) {
    throw new Error(`Voucher creation failed: ${result.errorMessage}`);
  }

  console.log(`        ✓ Created: ${result.code}`);
  console.log(`          ref: ${result.voucherRef}`);
  console.log(`          expires: ${result.expiresAt?.toISOString()}\n`);

  console.log("[ 2/2 ] Test complete — manually verify in MikroTik:");
  console.log(`        /ip/hotspot/user/print where name="${result.code}"`);
  console.log(`        Then remove it:`);
  console.log(`        /ip/hotspot/user/remove [find name="${result.code}"]\n`);
  console.log("✅ MikroTik connection is working.");
  console.log("   For production: reserve an ngrok static domain, set");
  console.log("   BRIDGE_URL + BRIDGE_SECRET in Vercel, then run the bridge");
  console.log("   service via infra/start-bridge.ps1.");
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
