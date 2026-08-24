# Fibott — System Reference

**Version:** 2.0 · **Architecture:** Mobile-first, single-board kiosk

Fibott is a reverse-vending kiosk that awards internet vouchers for deposited recyclable bottles and cans. The mobile app is the user interface; the ESP32-CAM is the embedded controller.

---

## Architecture

### System Communication Flow

```
                Internet
                    │
                    ▼
            MikroTik hAP ax lite
       (Open HotSpot AP + Walled Garden)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  Mobile Web App           ESP32-CAM
        │                       │
        └──────── HTTPS ────────┘
                    │
                    ▼
             Next.js (Vercel)
                    │
                    ├── Direct REST API (if reachable)
                    └── Outbound Router Sync (GET /api/mikrotik/sync every 3s)
                    │
                    ▼
             Neon PostgreSQL
```

---

## Environment Variables

| Variable | Description / Value |
|---|---|
| `MIKROTIK_HOST` | Router DDNS hostname (`hm20b2ta8p0.sn.mynetname.net`) or `"mock"` for offline dev |
| `MIKROTIK_USER` | Router admin username (default: `admin`) |
| `MIKROTIK_PASSWORD` | Router admin password |
| `MIKROTIK_HOTSPOT_PROFILE` | Hotspot profile name on router (default: `1hour`) |
| `MIKROTIK_PROTOCOL` | `https` for production, `http` for local dev |
| `MIKROTIK_PORT` | `443` for production, `80` for local dev |
| `MIKROTIK_INSECURE_TLS` | `true` if using self-signed router certificates |
| `MIKROTIK_SYNC_KEY` | Shared secret key used by RouterOS script to authenticate polls to `/api/mikrotik/sync` |
| `ALLOW_MOCK_VOUCHER` | `true` (optional) to allow mock voucher generation in dev environments |

---

## MikroTik HotSpot & Walled Garden Configuration

### 1. Open WiFi Network (No Password)
- SSID: **Fibott**
- Security profile: **Open** (`authentication-types=none`)
- Access control handled entirely by the captive portal voucher system.

### 2. Walled Garden Rules (Google Login & Web App Access)
Unauthenticated users connected to the Fibott hotspot can access only the web app and Google Sign-In subdomains before authentication:

| Host / Pattern | Description |
|---|---|
| `fibott.vercel.app` | Fibott web application |
| `*google.com` | Google OAuth login pages |
| `*googleapis.com` | Google OAuth token verification APIs |
| `*gstatic.com` | Google authentication static assets |
| `*googleusercontent.com` | Google account profile images |

---

## Router Integration (Outbound RouterOS Polling Sync)

The primary voucher delivery method is **Outbound RouterOS Polling Sync**:

```
+-----------------------------------------------------------------------------------+
| MikroTik ---> (HTTPS Outbound every 3s) ---> GET /api/mikrotik/sync               |
| 1. Router polls Vercel for PENDING vouchers                                       |
| 2. Router creates HotSpot user (/ip hotspot user add ...)                         |
| 3. Router confirms issuance to Vercel (voucher status -> ISSUED)                  |
+-----------------------------------------------------------------------------------+
```

Benefits: Zero open ports required, zero DDNS dependency, zero port-forwarding needed. Works behind NAT and CGNAT.

---

## User Voucher Claiming & UI

1. User redeems points on the Wallet page (`/dashboard/wallet`).
2. The code (`FBT-XXXX-XXXX-XXXX`) is displayed immediately with the interactive **VoucherActions** component:
   - **Use Voucher (Connect to Wi-Fi)**: Copies the code to clipboard and opens `http://192.168.88.1/login` in a new tab.
   - **Copy Code**: Copies code to clipboard with instant toast confirmation.
   - **How to connect?**: Quick 3-step instructions on pasting the code into Username & Password fields.
3. Every voucher entry in the "My Vouchers" table includes compact **Copy** and **Use Voucher** action buttons.

---

## Timezone Standard

All system logs, audit logs, deposit records, and transaction ledgers are formatted explicitly in **Philippines Time (Asia/Manila, UTC+8 / GMT+8)** via `src/lib/date-utils.ts`.

---

## API Endpoints

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /api/auth/*` | Mobile app | Login, register, reset password |
| `POST /api/kiosk/session` | Mobile app | Start recycling session |
| `GET /api/kiosk/session` | ESP32-CAM / mobile app | Poll active session or check session status |
| `POST /api/device/deposit-image` | ESP32-CAM | Upload image, classify, award points |
| `POST /api/device/logs` | ESP32-CAM / system | Post device telemetry & hardware logs |
| `GET /api/admin/logs` | Admin | Query system & hardware telemetry logs |
| `DELETE /api/admin/logs` | Admin | Purge logs |
| `POST /api/vouchers/redeem` | Mobile app | Spend points and create/queue voucher |
| `GET /api/mikrotik/sync` | MikroTik | Poll pending voucher and confirm issuance |

---

## ML Classifier

- File: `src/lib/classifier.ts`
- Base model: TensorFlow.js + MobileNetV2
- Fine-tuned head: `models/bottle-can-head/weights.json`
- Pipeline: `npm run ml:train`
