# Fibott — Status & Next Steps

**Last updated:** 2026-08-23 (Bridge removal, Open Hotspot, Google OAuth Walled Garden, and Voucher Redemption updates)

Reference: [docs/SYSTEM.md](SYSTEM.md) · Operator-facing summary: [docs/CLIENT-GUIDE.md](CLIENT-GUIDE.md)

---

## Current state (~98% complete)

| Area | Status | Notes |
|---|---|---|
| Backend — auth, sessions, deposits | ✅ Done | NextAuth (credentials + Google), Neon DB |
| Backend — recycling session API | ✅ Done | `POST/GET /api/kiosk/session` — one active session at a time, auto-expires |
| Backend — deposit flow | ✅ Done | Accepts `sessionId` or `sessionCode`; marks session COMPLETED on accept |
| Backend — MikroTik client | ✅ Done | Direct REST API connection to MikroTik RouterOS (`MikrotikClient`). Bridge service completely removed |
| Backend — voucher redeem flow | ✅ Done | Deducts points → creates hotspot user → refunds on failure. Supports mock vouchers (`MIKROTIK_HOST="mock"` / `ALLOW_MOCK_VOUCHER="true"`) for offline testing |
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

---

## 2026-08-23 Session Updates

1. **Complete Removal of Bridge Service**:
   - Removed `infra/bridge/`, `infra/start-bridge.ps1`, `infra/push-vercel-env.ps1`, `infra/ngrok-tunnel.ps1`, `BridgeClient`, and all bridge environment variables (`BRIDGE_URL`, `BRIDGE_SECRET`).
   - Standardized on direct HTTPS/HTTP REST API calls from Next.js to MikroTik.

2. **Google Sign-In Walled Garden Fix**:
   - Updated `infra/mikrotik-setup.rsc` and system documentation with wildcard domain rules (`*google.com`, `*googleapis.com`, `*gstatic.com`, `*googleusercontent.com`) so Google OAuth succeeds while users are connected to the captive portal.

3. **Open Hotspot (No WiFi Password)**:
   - Configured wireless AP security profile to `authentication-types=none` so users can connect to the "Fibott" SSID without entering a WiFi password. Access control remains fully protected by MikroTik hotspot vouchers.

4. **Voucher Redemption Fix & Mock Testing**:
   - Resolved voucher issuance failures by supporting mock mode (`MIKROTIK_HOST="mock"` or `ALLOW_MOCK_VOUCHER="true"`) for local development without physical router hardware.
   - Improved REST API error messages when communicating with a physical MikroTik unit.

---

## Remaining tasks

### A. Verify / create `1hour` hotspot profile (2 min)

In RouterOS terminal (Winbox → New Terminal, or SSH):

```
/ip/hotspot/user/profile/print
```

If `1hour` is not listed:

```
/ip/hotspot/user/profile/add name=1hour session-timeout=1h shared-users=1
```

### B. Deploy Direct Router Setup on Presentation Hardware (~15 min)

1. Paste `infra/mikrotik-setup.rsc` into the RouterOS terminal on the presentation router.
2. Note the router's DDNS hostname from `/ip cloud print`.
3. Set `MIKROTIK_HOST` in Vercel to the router's DDNS hostname.
4. Redeploy Vercel (`vercel --prod`).

### C. End-to-End Production Test (10 min)

1. Connect to the open "Fibott" WiFi network.
2. Log in via Google or credentials at `fibott.vercel.app`.
3. Start a recycling session, deposit a bottle/can, and verify points are awarded.
4. Redeem points for a WiFi voucher and verify hotspot internet access is granted.

---

## Deferred

- **`fibott-api` REST permissions** — `admin` is used as the active service account; accepted risk for deployment.
- **Legacy routes** — `POST /api/deposit-sessions`, `GET /api/device/session` retained for migration compatibility.
- **Voucher usage tracking** — MikroTik does not emit events back to Next.js when a voucher code is typed at the login screen.
- **MikroTik hotspot user cleanup** — RouterOS user entries are not auto-deleted upon voucher expiration; periodic manual pruning is recommended.
