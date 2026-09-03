# Fibott System Status and Handoff

**Last updated:** 2026-09-03

Reference: [SYSTEM.md](SYSTEM.md) | Operator guide: [CLIENT-GUIDE.md](CLIENT-GUIDE.md)

---

## Current Status

| Area | Status | Notes |
|---|---|---|
| Next.js app | Verified | `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass 100%. |
| Authentication - credentials | Verified | Login form and Credentials provider normalize email. User status checks enforced. |
| Authentication - Google OAuth | Verified | Google profile email is normalized and mapped. NextAuth v5 configured with `trustHost: true`. |
| Admin password reset | Verified | Admin endpoint `POST /api/admin/users/reset-password` updates password hash and logs audit trail. |
| Database | Verified | Prisma and Neon pooled/unpooled connections working. Points and vouchers use DB transactions. |
| Recycling session API | Verified | Atomic session claiming (`deviceId` binding) and 1-minute session TTL with cancel button. |
| ESP32 scan/image intake | Verified | Device routes require `x-device-api-key`, classify deposits, and return fail-safe JSON `servoAction: "REJECT"` on any error. |
| ESP32 Firmware | Verified | Canonical 2-pin buzzer firmware (`firmware/esp32-cam-buzzer/esp32-cam-buzzer-2pin/`) with `PIN_BUZZER = 14` and `BACKEND_TIMEOUT_MS = 15000`. |
| Points accumulation | Verified | Accepted deposits award points; spending uses atomic `updateMany` balance checks; failed vouchers refund points. |
| Voucher redemption | Verified | Redeem flow creates vouchers, spends points, uses direct MikroTik REST if reachable, falls back to RouterOS sync. |
| MikroTik outbound sync | Verified | `/api/mikrotik/sync` requires `MIKROTIK_SYNC_KEY`, returns pending vouchers, marks issued vouchers confirmed. |
| MikroTik direct REST | Verified | `npm run test:mikrotik` creates test HotSpot users. RouterOS 7 syntax verified. |
| Deployment & Env Vars | Verified | Production (`fibott.vercel.app`) and Preview environments fully configured on Vercel with all 14 env vars. |
| Docs | Updated | README, status, system reference, and operator guide updated to reflect the final verified architecture. |

---

## Main Flow

```text
Mobile user -> Next.js app -> Neon database
      |              ^
      v              |
ESP32-CAM -> device APIs -> deposit processor -> points ledger
      |
      v
Voucher redeem -> direct MikroTik REST if reachable
              -> outbound RouterOS polling sync fallback
```

---

## Final QA Notes

- Safe automated checks can verify the web app, TypeScript, build, API route wiring, auth code paths, points logic, voucher logic, and protected sync/device endpoints.
- Physical checks still need the ESP32-CAM, the MikroTik router, and a phone connected to the Fibott HotSpot.
- Do not rely on direct REST as the only voucher delivery path. The intended stable path is outbound RouterOS polling sync from `infra/fibott-sync.rsc`.

---

## Router Commands to Confirm Before Demo

Run these in RouterOS or WinBox terminal:

```routeros
/ip hotspot profile print detail
/ip hotspot print detail
/ip hotspot user profile print detail where name=1hour
/system scheduler print detail where name=fibott-sync
/system script print detail where name=fibott-sync
```

Confirm:

- The Fibott SSID is open, with no Wi-Fi password.
- The HotSpot profile allows the expected login method for your login page.
- User profile `1hour` exists.
- The `fibott-sync` scheduler is enabled and running every 3 seconds.
- Walled garden rules allow `fibott.vercel.app` and Google sign-in domains.
