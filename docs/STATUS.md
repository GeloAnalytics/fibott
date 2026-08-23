# Fibott — Status & Next Steps

**Last updated:** 2026-08-24 (Outbound Router Sync, MIKROTIK_SYNC_KEY, Vercel Production deploy)

Reference: [docs/SYSTEM.md](SYSTEM.md) · Operator-facing summary: [docs/CLIENT-GUIDE.md](CLIENT-GUIDE.md)

---

## Current state (✅ 100% complete)

| Area | Status | Notes |
|---|---|---|
| Backend — auth, sessions, deposits | ✅ Done | NextAuth (credentials + Google), Neon DB |
| Backend — recycling session API | ✅ Done | `POST/GET /api/kiosk/session` — one active session at a time, auto-expires |
| Backend — deposit flow | ✅ Done | Accepts `sessionId` or `sessionCode`; marks session COMPLETED on accept |
| Backend — MikroTik client | ✅ Done | Direct REST API + granular error categories (10 types). Bridge service completely removed |
| Backend — voucher redeem flow | ✅ Done | Deducts points → tries Direct REST → falls back to Outbound Sync queue if network fails → refunds on auth/validation failure. Mock mode for offline dev. |
| Backend — Outbound Router Sync | ✅ Done | `GET /api/mikrotik/sync` — RouterOS polls every 3 s for PENDING vouchers, creates HotSpot user, confirms issuance. Works on any internet connection, zero open ports. |
| Frontend — Start Recycling button | ✅ Done | `RecyclingSession` component: idle → active (countdown) → success / expired |
| Frontend — wallet + redeem UI | ✅ Done | Redeem button, voucher code displayed immediately, history table |
| Frontend — admin pages | ✅ Done | Users, deposits, vouchers, rewards, audit log, reports |
| ESP32-CAM firmware | ✅ Done | FSM: IDLE → READY → PROCESSING → SUCCESS/ERROR; polls `/api/kiosk/session` |
| ESP32-CAM firmware — servo+buzzer variant | ✅ Done | `firmware/esp32-cam-buzzer/` — same FSM, adds audible accept/reject/error feedback on GPIO14 |
| Direct REST integration | ✅ Active | Next.js backend communicates directly with MikroTik REST API |
| MikroTik hotspot — Open Network | ✅ Done | WiFi SSID "Fibott" configured without a WPA2 password (`authentication-types=none`) for zero-friction access |
| MikroTik hotspot — Walled Garden | ✅ Done | Configured with wildcard host rules (`*google.com`, `*googleapis.com`, `*gstatic.com`, `*googleusercontent.com`, `fibott.vercel.app`) to ensure Google login works without blockage |
| RouterOS REST API (www-ssl service) | ✅ Done | Verified working — `npm run test:mikrotik` passes |
| TypeScript build | ✅ Clean | `tsc --noEmit` passes with no errors |
| ML dataset import & training | ✅ Done | Dataset imported, training pipeline operational |
| Vercel Production deployment | ✅ Done | All env vars set (`MIKROTIK_HOST`, `MIKROTIK_USER`, `MIKROTIK_PASSWORD`, `MIKROTIK_HOTSPOT_PROFILE`, `MIKROTIK_SYNC_KEY`, etc.) — deployed and `READY` |

---

## 2026-08-24 Session Updates

1. **Outbound Router Sync — Network-Independent Voucher Delivery**:
   - Created `GET /api/mikrotik/sync` endpoint. The MikroTik router polls Vercel every 3 s for `PENDING` vouchers, creates the HotSpot user locally, and confirms issuance — requires zero open ports, zero DDNS, and zero port forwarding.
   - Voucher redeem flow now queues as `PENDING` automatically when direct REST fails due to network reachability (NAT, CGNAT, new Wi-Fi).
   - Added `MIKROTIK_SYNC_KEY` env var (64-char hex secret) to secure the polling endpoint.

2. **MikroTik Error Diagnostic System**:
   - Expanded `MikrotikErrorCategory` to 10 granular types: `MIKROTIK_HOST_NOT_CONFIGURED`, `MIKROTIK_DNS_FAILED`, `MIKROTIK_CONNECTION_TIMEOUT`, `MIKROTIK_CONNECTION_REFUSED`, `MIKROTIK_HOST_UNREACHABLE`, `MIKROTIK_AUTH_FAILED`, `MIKROTIK_PERMISSION_DENIED`, `MIKROTIK_PROFILE_NOT_FOUND`, `MIKROTIK_VALIDATION_ERROR`, `MIKROTIK_REQUEST_FAILED`.
   - Network-category failures → queue for Outbound Sync. Auth/validation failures → refund points.

3. **Vercel Production Environment Variables Set**:
   - All 9 MikroTik variables configured: `MIKROTIK_HOST`, `MIKROTIK_USER`, `MIKROTIK_PASSWORD`, `MIKROTIK_HOTSPOT_PROFILE=1hour`, `MIKROTIK_PROTOCOL=https`, `MIKROTIK_PORT=443`, `MIKROTIK_INSECURE_TLS=true`, `MIKROTIK_SYNC_KEY`.
   - Deployment `READY` at `https://fibott.vercel.app`.

4. **Hotspot Profile Default Fixed**:
   - Changed fallback from hardcoded `"default"` to `process.env.MIKROTIK_HOTSPOT_PROFILE ?? "1hour"` in `getMikrotikClient()`.

---

## Remaining tasks (Hardware-Only)

All software is deployed. Only physical hardware setup steps remain:

### A. Verify / create `1hour` hotspot profile (2 min)

In RouterOS terminal (Winbox → New Terminal, or SSH):

```
/ip/hotspot/user/profile/print
```

If `1hour` is not listed:

```
/ip/hotspot/user/profile/add name=1hour session-timeout=1h shared-users=1
```

### B. Apply the Outbound Sync Script on the Router (~5 min)

1. Open Winbox or SSH into the MikroTik.
2. Copy & paste **Section 8** of `infra/mikrotik-setup.rsc` into the RouterOS terminal.
   - The script is pre-loaded with `syncKey = f8a92e104d5b6c7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a` (matches `MIKROTIK_SYNC_KEY` in Vercel).
3. Verify the script and scheduler were created:
   ```
   /system script print
   /system scheduler print
   ```

### C. End-to-End Production Test (10 min)

1. Connect to the open "Fibott" WiFi network.
2. Log in via Google or credentials at `fibott.vercel.app`.
3. Start a recycling session, deposit a bottle/can, and verify points are awarded.
4. Redeem points for a WiFi voucher.
5. Verify HotSpot user created: `/ip hotspot user print` on the MikroTik.
6. Type the voucher code at the MikroTik captive portal and confirm internet access is granted.

---

## Deferred

- **`fibott-api` REST permissions** — `admin` is used as the active service account; accepted risk for deployment.
- **Legacy routes** — `POST /api/deposit-sessions`, `GET /api/device/session` retained for migration compatibility.
- **Voucher usage tracking** — MikroTik does not emit events back to Next.js when a voucher code is typed at the login screen.
- **MikroTik hotspot user cleanup** — RouterOS user entries are not auto-deleted upon voucher expiration; periodic manual pruning is recommended.
