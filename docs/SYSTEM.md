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
| `MIKROTIK_HOST` | Router's IP / DDNS hostname (e.g. `192.168.88.1` for local dev, or `abcd1234.sn.mynetname.net` for production). Set to `"mock"` to simulate vouchers without a router. |
| `MIKROTIK_USER` | Router admin username (default: `admin`) |
| `MIKROTIK_PASSWORD` | Router admin password |
| `MIKROTIK_HOTSPOT_PROFILE` | Hotspot profile name on router (default: `1hour`) |
| `MIKROTIK_PROTOCOL` | `http` for local dev or `https` for production (default: `https`) |
| `MIKROTIK_PORT` | `80` for local dev or `443` for production |
| `MIKROTIK_INSECURE_TLS` | `true` if using self-signed router certificates |
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

## Direct Router REST Integration

The Next.js backend calls the MikroTik RouterOS REST API endpoint (`/rest/ip/hotspot/user`) directly when a user redeems points for a voucher.

```
              POST /api/vouchers/redeem
                    │
              getMikrotikClient()
                    │
              MikrotikClient (Direct REST API)
                    │
                    ▼
             MikroTik REST API
         <router-host>:443 / 80
```

### Production Setup Requirements
1. Run `infra/mikrotik-setup.rsc` on the router:
   - Configures the open wireless security profile (no WiFi password).
   - Adds Walled Garden wildcard rules for Google login and Fibott app.
   - Enables MikroTik IP Cloud DDNS (`/ip cloud set ddns-enabled=yes`).
   - Enables HTTPS REST API (`/ip service set www-ssl disabled=no port=443`).
   - Adds firewall rules to allow WAN access on port 443 while dropping Winbox/SSH/FTP/Telnet from WAN.
2. Set `MIKROTIK_HOST` in Vercel to the router's DDNS hostname (`<serial>.sn.mynetname.net`).

---

## Components

**Mobile App** — Primary UI. Login, start recycling session, view points, redeem voucher, view history.

**ESP32-CAM** — Kiosk board. Polls backend for active sessions, captures images, uploads frames, drives the servo gate. Contains no business logic.

**Next.js Backend (Vercel / Local)** — Owns auth, sessions, classification, points, voucher generation, and MikroTik integration.

**Neon PostgreSQL** — Stores users, sessions, deposits, points, vouchers, devices.

**MikroTik hAP ax lite** — Hotspot AP. Issues internet access via voucher codes. Knows nothing about recycling; only receives user creation commands from the backend via REST API.

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
3. Backend calls MikroTik RouterOS REST API → creates a hotspot user (`name=FBT-XXXX-XXXX-XXXX`, same value as password, `profile=1hour`).
   - If `MIKROTIK_HOST="mock"` or `ALLOW_MOCK_VOUCHER="true"`, a mock voucher code is generated.
   - If the router API call fails (e.g. router unreachable), the points are refunded immediately via `refundPoints()`.
4. Voucher code is stored in DB and displayed on screen.
5. User enters the code at the MikroTik captive portal to get internet access.

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
