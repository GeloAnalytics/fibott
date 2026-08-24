# Fibott — System Status & Handoff

**Last updated:** 2026-08-24 (100% Complete & Verified)

Reference: [SYSTEM.md](SYSTEM.md) | Operator guide: [CLIENT-GUIDE.md](CLIENT-GUIDE.md)

---

## Current State (✅ 100% Complete & Verified)

| Area | Status | Notes |
|---|---|---|
| **Next.js App** | ✅ Working | App Router, API routes, dashboard, wallet, admin portal |
| **Authentication** | ✅ Working | NextAuth (Credentials + Google OAuth with `allowDangerousEmailAccountLinking: true`). Email normalization applied. |
| **Database** | ✅ Working | Prisma ORM + Neon Serverless PostgreSQL |
| **Recycling Session API** | ✅ Working | Single active session system-wide, auto-expires after 5 mins |
| **Deposit Flow** | ✅ Working | Camera frames uploaded to `/api/device/deposit-image`, classified via fine-tuned MobileNetV2 head, points awarded atomically |
| **Points Ledger** | ✅ Working | Atomic earn/spend/refund transactions. All user accounts updated with 1,000 pts bonus. |
| **Voucher Redemption** | ✅ Working | Points deducted → voucher code generated (`FBT-XXXX-XXXX-XXXX`) → automatic direct REST or Outbound Sync fallback |
| **Outbound Router Sync** | ✅ Working | `GET /api/mikrotik/sync` endpoint. RouterOS polls every 3 s, creates HotSpot user, and confirms issuance |
| **Voucher Claiming UI** | ✅ Working | Interactive **Use Voucher** & **Copy Code** buttons with HotSpot login guide on wallet page |
| **Timezone System** | ✅ Working | All logs, audit entries, deposits, and transaction tables formatted in Philippines Time (Asia/Manila, UTC+8) |
| **Mobile Responsiveness** | ✅ Working | Locked viewport scale and iOS input font-size enforcement (min 16px) to prevent auto-zooming |
| **Hardware Telemetry Logs** | ✅ Working | `POST /api/device/logs` telemetry API + Admin real-time log monitoring portal (`/admin/logs`) |
| **Firmware** | ✅ Working | ESP32-CAM firmware with hardware state machine, servo gate, optional buzzer feedback, and telemetry |
| **TypeScript / ESLint** | ✅ Clean | `npx tsc --noEmit` (0 errors) & `npm run lint` (0 errors) |
| **Vercel Production** | ✅ Live | Deployed and `READY` at `https://fibott.vercel.app` |

---

## Architecture Summary

```
                 Internet
                    │
                    ▼
            MikroTik hAP ax lite
       (Open HotSpot AP + Walled Garden)
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
   Mobile Web App         ESP32-CAM
         │                     │
         └─────── HTTPS ───────┘
                    │
                    ▼
             Next.js (Vercel)
                    │
                    ├── Direct REST (if reachable)
                    └── Outbound Router Sync (GET /api/mikrotik/sync every 3s)
                    │
                    ▼
             Neon PostgreSQL
```

---

## Operating Environment Variables (Vercel Production)

| Variable | Value / Description |
|---|---|
| `MIKROTIK_HOST` | `hm20b2ta8p0.sn.mynetname.net` (or `"mock"` for offline dev) |
| `MIKROTIK_USER` | `admin` |
| `MIKROTIK_PASSWORD` | Router admin password |
| `MIKROTIK_HOTSPOT_PROFILE` | `1hour` |
| `MIKROTIK_PROTOCOL` | `https` |
| `MIKROTIK_PORT` | `443` |
| `MIKROTIK_INSECURE_TLS` | `true` |
| `MIKROTIK_SYNC_KEY` | 64-character secret key shared with RouterOS polling script |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |

---

## Pre-Presentation Operational Checklist

1. **Hotspot Profile**: Verify that profile `1hour` exists on the router (`/ip hotspot user profile print`).
2. **Outbound Sync Script**: Ensure `infra/fibott-sync.rsc` script & scheduler are installed and running on the router.
3. **Connecting & Claiming Vouchers**:
   - Connect phone to **Fibott** open Wi-Fi.
   - Log in at `https://fibott.vercel.app`.
   - Deposit a bottle/can to earn points (or use current points balance).
   - Press **Redeem** for a voucher.
   - Tap **Use Voucher** to copy code and open `http://192.168.88.1/login`.
   - Paste the voucher code into both Username and Password fields to get internet access.
