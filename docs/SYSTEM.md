# Fibott — System Reference

**Version:** 1.0 · **Architecture:** Mobile-first, single-board kiosk

Fibott is a reverse-vending kiosk that awards internet vouchers for deposited recyclable bottles and cans. The mobile app is the only user interface; the ESP32-CAM is the only embedded controller.

---

## Architecture

### Local development

```
                Internet
                    │
                    ▼
            Globe At Home Router
                    │
                    ▼
            MikroTik hAP ax lite
          (Hotspot + Walled Garden)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
 Mobile App               ESP32-CAM
        │                       │
        └──────── HTTPS ────────┘
                    │
                    ▼
             Next.js (local)
                    │
                    ▼ direct REST
             MikroTik REST API
              192.168.88.1
                    │
                    ▼
              Neon PostgreSQL
```

Set `BRIDGE_URL=""` — the client calls MikroTik directly.

### Production (Vercel)

```
                Internet
                    │
                    ▼
            Next.js (Vercel)
                    │
              POST /api/vouchers/redeem
                    │
              getMikrotikClient()
                    │
              BridgeClient
                    │
                    ▼
            Cloudflare Tunnel
                    │
                    ▼
            Bridge Service
              localhost:3001
                    │
                    ▼
             MikroTik REST API
              192.168.88.1
```

The router is never exposed directly to the internet. Set `BRIDGE_URL` to the Cloudflare Tunnel URL.

---

## Environment variables

### Local (`.env.local`)

| Variable | Value |
|---|---|
| `BRIDGE_URL` | `""` (empty — direct MikroTik) |
| `MIKROTIK_HOST` | `192.168.88.1` |
| `MIKROTIK_PROTOCOL` | `http` |
| `MIKROTIK_PORT` | `80` |
| `MIKROTIK_USER` | `admin` (replace with `fibott-api` once permissions are resolved) |
| `MIKROTIK_PASSWORD` | _(router password)_ |
| `MIKROTIK_HOTSPOT_PROFILE` | `1hour` |

### Production (Vercel)

| Variable | Value |
|---|---|
| `BRIDGE_URL` | `https://<your-tunnel>.cfargotunnel.com` |
| `BRIDGE_SECRET` | _(shared bearer secret between Vercel and bridge)_ |

All other `MIKROTIK_*` vars are only needed locally; the bridge holds them and they never leave the LAN.

---

## Bridge service

File: `infra/bridge/server.ts` — runs on the same machine as the MikroTik router.

Start with:

```bash
npm run bridge:start
```

The bridge listens on `localhost:3001`, validates the `Authorization: Bearer <BRIDGE_SECRET>` header, creates the hotspot user via the local MikroTik REST API, and returns the credentials.

For production, expose it through a permanent Cloudflare tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create fibott-mikrotik
cloudflared service install
Start-Service cloudflared
```

For quick local testing, use a Quick Tunnel (disappears when cloudflared stops):

```bash
cloudflared tunnel --url http://localhost:3001
```

---

## Components

**Mobile App** — primary UI. Login, start deposit, view points, redeem voucher, view history. No physical kiosk buttons.

**ESP32-CAM** — kiosk board. Polls backend for active sessions, captures images, uploads frames, drives the servo gate. Contains no business logic.

**Next.js Backend (Vercel)** — owns everything: auth, sessions, classification, points, voucher generation, MikroTik integration.

**Neon PostgreSQL** — stores users, sessions, deposits, points, vouchers, devices.

**MikroTik hAP ax lite** — hotspot AP. Issues internet access via voucher codes. Knows nothing about recycling; only receives username/password/profile from the backend.

---

## API Endpoints

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /api/auth/*` | Mobile App | Login, register, password reset |
| `POST /api/deposit-sessions` | Mobile App | Start a deposit session |
| `GET /api/device/session` | ESP32-CAM | Poll for active session (claims it atomically) |
| `POST /api/device/deposit-image` | ESP32-CAM | Upload captured frame → classify → award points |
| `POST /api/device/scan` | ESP32-CAM (test) | Pre-classified result, no image upload |
| `POST /api/vouchers/redeem` | Mobile App | Spend points → create MikroTik hotspot user → return voucher code |
| ~~`POST /api/device/sessions/claim`~~ | Legacy | Retained for migration only |
| ~~`POST /api/device/sessions/activate`~~ | Legacy | Retained for migration only |

---

## Deposit Workflow

1. User connects to Fibott WiFi (MikroTik hotspot, Walled Garden allows the app without a voucher).
2. User logs in and presses **Start Deposit**.
3. Backend creates a `PENDING` deposit session.
4. ESP32-CAM polls `GET /api/device/session` every ~1.5 s; backend atomically claims the session and returns the session code.
5. User inserts a bottle or can.
6. ESP32-CAM captures a JPEG and POSTs it to `/api/device/deposit-image` with the session code.
7. Backend classifies the image → awards points if accepted → returns `servoAction: ACCEPT | REJECT`.
8. ESP32-CAM opens the servo gate for 3 s on ACCEPT; gate stays closed on REJECT.
9. Session is marked complete.

---

## Voucher / Reward Workflow

1. User presses **Redeem** in the app (no re-login required — session already active).
2. Backend deducts points atomically.
3. Backend calls MikroTik RouterOS REST API → creates a hotspot user (`name=FBT-XXXX-XXXX-XXXX`, same value as password, `profile=1hour`).
4. Voucher code stored in DB, returned immediately to the app.
5. User enters the code at the MikroTik captive portal to get internet access.

Points: PET\_BOTTLE = 5 pts · ALUMINUM\_CAN = 10 pts · 1 Hour WiFi = 100 pts

---

## MikroTik Walled Garden

Unauthenticated users (no voucher) can reach only:

| Domain | Reason |
|---|---|
| `fibott.vercel.app` | The app itself (login, deposit, redeem) |
| `accounts.google.com` | Google OAuth — only needed if Google Sign-In must work before a voucher |

Everything else (Facebook, YouTube, Google Search, etc.) stays blocked until a valid voucher is used.

---

## Hardware

### Active components

| Part | Role |
|---|---|
| ESP32-CAM-MB (AI-Thinker, OV2640) | Captures deposited item, uploads image, drives servo |
| MG90S servo (metal gear, micro) | Opens/closes intake gate |
| Dedicated 5V/1A supply (servo rail) | Separate from camera supply |
| Dedicated 5V/500mA+ supply (camera rail) | Do not share with servo |

**Legacy / spare:** bare ESP32 dev board — migration support only, not active kiosk hardware.

### ESP32-CAM safe GPIO

| Function | GPIO | Notes |
|---|---|---|
| Servo signal | **13** | Baseline pin, not a strapping pin |
| Status LED | 33 | Onboard red, active-LOW |
| Optional sensor | 14 or 15 | Only if a presence sensor is added later |

Camera data lines (do not use): 5, 18, 19, 21, 22, 23, 25, 26, 27, 32, 34, 35, 36, 39.

### Servo wiring

```
5V PSU (+)       → servo red
5V PSU GND       → servo brown/black
ESP32-CAM GND    → common ground with servo PSU  ← mandatory
ESP32-CAM GPIO13 → servo signal (optional 220–470 Ω series resistor)
```

Do not power the servo from the ESP32-CAM board's own rail — camera WiFi TX spikes will brown-out a shared supply.

### Power rails

| Rail | Feeds | Note |
|---|---|---|
| A | ESP32-CAM-MB | 5V, 500 mA+ via micro-USB or dedicated supply |
| B | MG90S servo | 5V, ~1A dedicated; common GND with Rail A |

---

## Firmware

Sketch: `firmware/esp32-cam/esp32-cam.ino`

### Configure (`firmware/esp32-cam/config.h`)

| Setting | Value |
|---|---|
| `WIFI_SSID` / `WIFI_PASSWORD` | LAN the kiosk joins |
| `BACKEND_HOST` | `your-app.vercel.app` (no `https://`) |
| `BACKEND_PORT` | `443` production · local dev port otherwise |
| `DEVICE_API_KEY` | Plaintext key from seed output |
| `PIN_SERVO` | `13` |
| `SERVO_CLOSED_US` / `SERVO_OPEN_US` | Calibrate after assembly |
| `POLL_INTERVAL_MS` | `1500` (1–2 s per design spec) |
| `GATE_OPEN_MS` | `3000` |

### Flash

1. Arduino IDE → Board: **AI Thinker ESP32-CAM**
2. Tools → PSRAM → **OPI PSRAM**
3. Flash via the MB base board micro-USB (onboard CH340C, no FTDI needed).
4. Serial Monitor at **115200** baud.

### ESP32-CAM state machine

```
BOOT → CONNECT WIFI → IDLE → POLL SESSION
         → SESSION FOUND → CAPTURE IMAGE → UPLOAD IMAGE
         → WAIT VALIDATION → [ACCEPT] OPEN SERVO → CLOSE SERVO
         → SESSION COMPLETE → IDLE
```

### Device provisioning

1. Run `npx prisma db seed` — generates a `Device` row and prints the plaintext API key (shown once).
2. Flash the plaintext key into `DEVICE_API_KEY` in `config.h`.
3. The backend stores only the bcrypt hash; the plaintext is never stored.

---

## ML Classifier

File: `src/lib/classifier.ts`

**Two modes, same function** (`classifyImage(buffer)`):

1. **Fine-tuned head** (`models/bottle-can-head/weights.json`) — if the file exists, used automatically.
2. **Zero-shot fallback** — keyword mapping over MobileNetV2 ImageNet labels. Active now. Can mapping is weak; bottle mapping is reasonable.

`MIN_CONFIDENCE = 0.15` — predictions below this threshold become `REJECTED`.

### Training workflow

```bash
# Import TACO dataset (downloads ~417 images from Flickr)
npm run ml:import:taco -- --annotations "path/to/annotations.json" --max-per-label 139

# Train the fine-tuned head (reads ml-data/, writes models/bottle-can-head/weights.json)
npm run ml:train
```

TACO label mapping: categories 4+5 → `PET_BOTTLE` · category 10+12 → `ALUMINUM_CAN` · everything else → `REJECTED`.

---

## Design Principles

- Mobile app is the only user-facing interface — no physical buttons.
- Backend owns all business logic; ESP32-CAM owns only hardware control.
- MikroTik owns only networking; it never knows about points or recycling.
- Walled Garden lets users earn and redeem before they have internet access.
- Simplicity and reliability over premature optimization.
