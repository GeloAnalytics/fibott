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
            Globe At Home Router
                    │
                    ▼
            MikroTik hAP ax lite
       (Open Hotspot AP + Walled Garden)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  Mobile App               ESP32-CAM
        │                       │
        └──────── HTTPS ────────┘
                    │
                    ▼
             Next.js (Vercel / Local)
                    │
                    ▼ Direct REST API
             MikroTik REST API
        <router-host>:443 / 192.168.88.1
                    │
                    ▼
              Neon PostgreSQL
```

The Next.js backend communicates directly with the MikroTik RouterOS REST API to issue time-limited WiFi vouchers.

---

## Environment Variables

### Local & Production Environment Configuration

| Variable | Description / Value |
|---|---|
| `MIKROTIK_HOST` | Router's IP / DDNS hostname (e.g. `192.168.88.1` for local dev, or `hm20b2ta8p0.sn.mynetname.net` for production). Set to `"mock"` to simulate vouchers without a router. |
| `MIKROTIK_USER` | Router admin username (default: `admin`) |
| `MIKROTIK_PASSWORD` | Router admin password |
| `MIKROTIK_HOTSPOT_PROFILE` | Hotspot profile name on router (default: `1hour`) |
| `MIKROTIK_PROTOCOL` | `http` for local dev or `https` for production (default: `https`) |
| `MIKROTIK_PORT` | `80` for local dev or `443` for production |
| `MIKROTIK_INSECURE_TLS` | `true` if using self-signed router certificates |
| `MIKROTIK_SYNC_KEY` | Shared secret key used by the RouterOS outbound sync script to authenticate polls to `/api/mikrotik/sync`. Must match the `:local syncKey` in the RouterOS script. |
| `ALLOW_MOCK_VOUCHER` | `true` (optional) to allow mock voucher generation in testing environments |

---

## MikroTik Hotspot & Walled Garden Configuration

### 1. Open WiFi Network (No Password)
To provide zero-friction access for users connecting to the Fibott kiosk:
- The WiFi SSID ("Fibott") security profile is configured as **Open** (`authentication-types=none`).
- No WPA2 WiFi password is required to connect.
- Network access control is handled entirely by the MikroTik captive portal.

### 2. Walled Garden Rules (Google Login & Web App Access)
Unauthenticated users connected to the Fibott hotspot are allowed to access only the Fibott web application and Google Sign-In domains before authentication:

| Host / Pattern | Description |
|---|---|
| `fibott.vercel.app` | Fibott web application (login, deposit, wallet, redeem) |
| `*google.com` | Google OAuth login pages and authentication flows |
| `*googleapis.com` | Google OAuth APIs and token verification services |
| `*gstatic.com` | Google authentication static assets, fonts, and scripts |
| `*googleusercontent.com` | Google account profile images and avatars |

---

## Router Integration (Direct REST & Outbound Polling Sync)

The Next.js backend supports two methods for HotSpot user creation:

### Method 1: Outbound Router Polling Sync (Recommended — Network Independent)
Requires **zero open ports**, **zero DDNS**, and **zero port forwarding**. Works automatically on any Wi-Fi, home network, campus network, or 4G/5G mobile hotspot.

```
+-----------------------------------------------------------------------------------+
| MikroTik ---> (HTTPS Outbound every 3s) ---> GET /api/mikrotik/sync               |
| 1. Router polls Vercel for PENDING vouchers                                      |
| 2. Router creates HotSpot user (/ip hotspot user add ...)                         |
| 3. Router confirms issuance to Vercel (voucher status -> ISSUED)                  |
+-----------------------------------------------------------------------------------+
```

### Method 2: Direct REST API (Inbound HTTPS)
If `MIKROTIK_HOST` is configured and reachable, Vercel calls `/rest/ip/hotspot/user` directly. If direct REST fails due to network reachability (e.g. router moved to a new network), the backend automatically falls back to queueing the voucher for Outbound Router Sync.

```
              POST /api/vouchers/redeem
                    │
              getMikrotikClient()
                    │
              MikrotikClient (Direct REST API)
                    │
                    ├── (Success) ──> Hotspot User Created Immediately
                    │
                    └── (Network Failure) ──> Queued for Outbound Router Sync
```

---

## API Endpoints

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /api/auth/*` | Mobile App | Login, register, password reset |
| `POST /api/kiosk/session` | Mobile App | Start a recycling session |
| `GET /api/kiosk/session` | ESP32-CAM | Poll for active session (device API key) |
| `GET /api/kiosk/session` | Mobile App | Check own session status (user cookie, `?id=<sessionId>`) |
| `POST /api/device/deposit-image` | ESP32-CAM | Upload captured frame → classify → award points → complete session |
| `POST /api/device/logs` | ESP32-CAM / System | Post telemetry, hardware status, and error logs |
| `GET /api/admin/logs` | Admin Portal | Query and filter system & hardware logs, metrics |
| `DELETE /api/admin/logs` | Admin Portal | Purge old log entries |
| `POST /api/device/scan` | ESP32-CAM (test) | Pre-classified result, no image upload |
| `POST /api/vouchers/redeem` | Mobile App | Spend points → create MikroTik hotspot user → return voucher code |
| `GET /api/mikrotik/sync` | MikroTik Router | Outbound router poll & voucher issuance confirmation |

---

## Deposit / Recycling Workflow

```
User presses Start Recycling
    │
    ▼
POST /api/kiosk/session → DepositSession created (status=ACTIVE, TTL=5 min)
    │
    ▼ (ESP32 polling every 2 s)
GET /api/kiosk/session → { active: true, sessionId, expiresAt }
    │
    ▼
ESP32: IDLE → READY → PROCESSING
    │
    ▼
User inserts bottle or can
    │
    ▼
POST /api/device/deposit-image (multipart: image + sessionId)
    │
    ├── classifyImage() → materialType
    ├── processDeposit() → Deposit record + points awarded
    ├── DepositSession.status = COMPLETED
    └── returns { servoAction: ACCEPT | REJECT }
    │
    ▼
ESP32: gate opens 3 s on ACCEPT, stays closed on REJECT → back to IDLE
    │
    ▼ (frontend polling every 2 s)
GET /api/kiosk/session?id=<sessionId> → { status: COMPLETED, pointsAwarded }
    │
    ▼
Dashboard shows "Deposit successful! +N points"
```

---

## Voucher / Reward Workflow

1. User presses **Redeem** in the app.
2. Backend deducts points atomically via `spendPoints()` in `src/lib/points.ts` (`WHERE pointsBalance >= amount`).
3. Backend attempts to create a HotSpot user via **Direct REST** to the MikroTik router.
   - If `MIKROTIK_HOST="mock"` or `ALLOW_MOCK_VOUCHER="true"`, a mock voucher code is returned instantly.
   - If direct REST succeeds → voucher status is set to `ISSUED` immediately.
   - If direct REST fails due to **network reachability** (router behind NAT, moved to a new network, CGNAT, etc.) → voucher is saved as `PENDING` with a pre-generated code (`FBT-XXXX-XXXX-XXXX`) and queued for **Outbound Router Sync**.
   - If direct REST fails for any other reason (auth, profile not found, validation) → points are refunded via `refundPoints()`.
4. Voucher code (`FBT-XXXX-XXXX-XXXX`) is stored in DB and displayed on screen immediately regardless of delivery method.
5. **Outbound Router Sync** (if PENDING): The MikroTik router polls `/api/mikrotik/sync?key=<MIKROTIK_SYNC_KEY>` every 3 seconds, creates the HotSpot user locally, and confirms issuance. Voucher status transitions `PENDING → ISSUED`.
6. User enters the voucher code at the MikroTik captive portal to get internet access.

---

## Firmware & Hardware Summary

- **Active board:** ESP32-CAM-MB (AI-Thinker, OV2640).
- **Servo:** MG90S metal-gear micro servo on GPIO13 (dedicated 5V supply).
- **Buzzer:** Optional audible feedback on GPIO14 (`firmware/esp32-cam-buzzer/`).
- **Firmware path:** `firmware/esp32-cam/` (servo only) and `firmware/esp32-cam-buzzer/` (servo + buzzer).

---

## ML Classifier

- **File:** `src/lib/classifier.ts`
- **Model:** MobileNetV2 zero-shot fallback + fine-tuned head (`models/bottle-can-head/weights.json`).
- **Pipeline:** `npm run ml:train` to re-train head using dataset captures.
