# Fibott System Status and Handoff

**Last updated:** 2026-08-24

Reference: [SYSTEM.md](SYSTEM.md) | Operator guide: [CLIENT-GUIDE.md](CLIENT-GUIDE.md)

---

## Current Status

| Area | Status | Notes |
|---|---|---|
| Next.js app | Verified locally | `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass. |
| Authentication - credentials | Code verified | Login form and Credentials provider normalize email. User status checks are enforced. |
| Authentication - Google OAuth | Code hardened, live retest needed | Google profile email is normalized and mapped. If production still shows `OAuthAccountNotLinked`, retest after deployment and confirm the Google OAuth redirect URI. |
| Admin password reset | Code verified | Admin-only endpoint `POST /api/admin/users/reset-password` updates the selected user's password hash and writes an audit log. |
| Database | Code verified | Prisma and Neon are used through `src/lib/prisma.ts`; points and vouchers use database transactions. |
| Recycling session API | Code verified | One active kiosk session is enforced and sessions expire automatically. |
| ESP32 scan/image intake | Code verified, hardware retest needed | Device routes require `x-device-api-key`, classify deposits, and call the shared deposit processor. Physical ESP32 upload should be retested on the kiosk. |
| Points accumulation | Code verified | Accepted deposits call `awardPoints`; spending uses atomic `updateMany` balance checks; failed voucher issuance refunds points when appropriate. |
| Voucher redemption | Code verified | Redeem flow creates a voucher, spends points, tries direct MikroTik REST, and leaves vouchers pending for outbound sync on network fallback. |
| MikroTik outbound sync | Code verified, router retest needed | `/api/mikrotik/sync` requires `MIKROTIK_SYNC_KEY`, returns one pending voucher, and marks confirmed vouchers as issued. Router scheduler must be active. |
| MikroTik direct REST | Code verified, live router retest optional | `npm run test:mikrotik` creates a real test HotSpot user and should only be run when you are ready to clean it up. |
| HotSpot CHAP/browser challenge | Router-side check needed | If the HotSpot login page says the browser did not send a challenge response, verify the router HotSpot profile and login method settings. |
| Docs | Updated | README, status, system reference, and operator guide reflect the current repo behavior. |

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
