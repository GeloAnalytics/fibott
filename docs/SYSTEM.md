# Fibott System Reference

**Version:** 2.0

**Architecture:** Mobile-first reverse vending kiosk with ESP32-CAM and MikroTik HotSpot vouchers

Fibott awards Wi-Fi voucher time for deposited recyclable bottles and cans. The mobile app is the user interface, the ESP32-CAM is the kiosk controller, Neon stores application data, and MikroTik provides captive portal access.

---

## Architecture

```text
                 Internet
                    |
                    v
            MikroTik hAP ax lite
       Open HotSpot AP + Walled Garden
                    |
        +-----------+-----------+
        v                       v
  Mobile Web App           ESP32-CAM
        |                       |
        +---------- HTTPS ------+
                    |
                    v
             Next.js on Vercel
                    |
          +---------+----------+
          v                    v
 Direct MikroTik REST   Outbound RouterOS sync
 if reachable           GET /api/mikrotik/sync
                    |
                    v
              Neon PostgreSQL
```

---

## Core Components

| Component | Location | Purpose |
|---|---|---|
| Auth config | `src/lib/auth.ts` | NextAuth providers, email normalization, account/session callbacks. |
| Admin password reset | `src/app/api/admin/users/reset-password/route.ts` | Admin-only password reset for users. |
| Points ledger | `src/lib/points.ts` | Atomic earn, spend, and refund operations. |
| Deposit processor | `src/lib/deposit.ts` | Creates deposits, awards points, and completes active sessions. |
| Device auth | `src/lib/device-auth.ts` | Validates ESP32 `x-device-api-key` values. |
| Device image intake | `src/app/api/device/deposit-image/route.ts` | Accepts ESP32-CAM images and classifies deposits. |
| Device scan intake | `src/app/api/device/scan/route.ts` | Accepts structured scan payloads from firmware. |
| Device log intake | `src/app/api/device/logs/route.ts` | Accepts telemetry logs from firmware, stored in `SystemLog`. |
| Kiosk sessions | `src/app/api/kiosk/session/route.ts` | Starts (POST), polls (GET), and cancels (DELETE) recycling sessions. Session TTL is **1 minute**. |
| Voucher redeem | `src/app/api/vouchers/redeem/route.ts` | Spends points and creates MikroTik vouchers. |
| MikroTik direct REST | `src/lib/mikrotik-client.ts` | Optional direct RouterOS REST voucher creation. |
| MikroTik sync | `src/app/api/mikrotik/sync/route.ts` | Router polling endpoint for pending vouchers. |
| Admin logs | `src/app/api/admin/logs/route.ts` | Paginated system log feed with level/source/tag filters. |
| Admin device alerts | `src/app/api/admin/device-alerts/route.ts` | Device health summary (GET) and admin-initiated manual alerts (POST). |

---

## Firmware Specifications

Fibott has one canonical firmware under `firmware/esp32-cam-buzzer/esp32-cam-buzzer-2pin/`:

| Firmware Folder | Target Hardware | Audio Driver | Pin Mapping & Description |
|---|---|---|---|
| [`firmware/esp32-cam-buzzer/esp32-cam-buzzer-2pin`](../firmware/esp32-cam-buzzer/esp32-cam-buzzer-2pin/) | AI-Thinker ESP32-CAM | Active / Passive 2-Pin Buzzer | Servo on **GPIO13**, Buzzer `(+)` on **GPIO14**, `(-)` to **GND**, Status LED on **GPIO33**. Comprehensive serial diagnostics, admin telemetry, periodic heartbeat. |

> `firmware/esp32-cam/` (if still present on disk) is a legacy no-buzzer sketch kept only in git history — do not flash it.

### Audible Feedback Protocol (Buzzer Firmware)

| State / Event | Beep Pattern | Frequency (Passive Mode) |
|---|---|---|
| **Boot Complete** | 1 short beep (80ms) | 2700 Hz |
| **Session Active / Ready** | 1 prompt beep (100ms) + LED flash | 3000 Hz |
| **Deposit Accepted** | 1 long tone (300ms) + Gate opens | 3500 Hz |
| **Deposit Rejected** | 3 rapid beeps (120ms each) | 1800 Hz |
| **Upload / Network Error** | 1 long warning tone (500ms) | 1200 Hz |

---

## Hardware Specifications

- **Microcontroller:** AI-Thinker ESP32-CAM (with PSRAM enabled).
- **Camera Module:** OV2640 JPEG camera module (VGA 640x480 capture).
- **Gate Actuator:** SG90 / MG90S Micro Servo driven via ESP32 `ledc` PWM on **GPIO13**.
- **Audible Alerts:** 
  - 2-Pin active/passive piezo element connected between **GPIO14** and **GND**.
  - OR 3-Pin active/passive breakout module (KY-012, HW-508, KY-006) powered by **5V/3.3V**, **GND**, and **GPIO14** (`SIG`).
- **Power Supply:** 5V 2A+ DC supply to ESP32-CAM `5V` pin (camera & servo draw peak currents up to 1.5A during capture & motor turn).

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon/Postgres connection string. |
| `NEXTAUTH_SECRET` | NextAuth signing/encryption secret. |
| `NEXTAUTH_URL` | Public app URL, normally `https://fibott.vercel.app` in production. |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |
| `MIKROTIK_HOST` | Router DDNS hostname or `mock` for offline development. |
| `MIKROTIK_USER` | RouterOS API username. |
| `MIKROTIK_PASSWORD` | RouterOS API password. |
| `MIKROTIK_HOTSPOT_PROFILE` | HotSpot user profile, normally `1hour`. |
| `MIKROTIK_PROTOCOL` | `https` in production unless the router is configured otherwise. |
| `MIKROTIK_PORT` | Router REST port. |
| `MIKROTIK_INSECURE_TLS` | `true` if the router uses a self-signed certificate. |
| `MIKROTIK_SYNC_KEY` | Shared secret for RouterOS polling sync. |
| `ALLOW_MOCK_VOUCHER` | Optional development flag for mock voucher behavior. |

---

## Authentication

- Credentials login normalizes email before lookup.
- Registration and forgot-password also normalize email.
- Google OAuth maps Google profile data into the same normalized email format.
- Existing Google/account-linking problems should be retested after deployment. If `OAuthAccountNotLinked` still appears, confirm the production Google OAuth redirect URI and existing account linkage state.

---

## Points and Deposits

1. A user starts a kiosk session from the web app.
2. The ESP32-CAM polls for an active session.
3. The ESP32 posts a scan or image with `x-device-api-key`.
4. The deposit processor validates the material and active session.
5. Accepted deposits call `awardPoints` and complete the session.
6. Rejected deposits are recorded with a rejection reason and do not award points.

---

## Voucher System

1. Authenticated users redeem points from the wallet.
2. The app checks an active voucher rule and spends points atomically.
3. A voucher code is generated in `FBT-XXXX-XXXX-XXXX` format.
4. The app attempts direct MikroTik REST creation if configured and reachable.
5. If direct REST has a network/router reachability issue, the voucher remains `PENDING` for outbound sync.
6. The MikroTik router polls `/api/mikrotik/sync`, creates the HotSpot user, then confirms issuance.

The stable production path is outbound RouterOS polling sync. Do not remove it while debugging direct REST.

---

## MikroTik HotSpot Requirements

- SSID: `Fibott`
- Wi-Fi security: open network, no WPA password.
- Captive portal controls access through HotSpot vouchers.
- HotSpot user profile `1hour` must exist.
- Walled garden should allow:
  - `fibott.vercel.app`
  - `*.google.com`
  - `*.googleapis.com`
  - `*.gstatic.com`
  - `*.googleusercontent.com`

---

## User Voucher Claiming

1. User redeems points on `/dashboard/wallet`.
2. User taps **Use Voucher**.
3. The app copies the voucher code and opens `http://192.168.88.1/login`.
4. User pastes the code into both Username and Password.
5. MikroTik HotSpot grants access based on the created HotSpot user.

---

## Validation Commands

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Use `npm run test:mikrotik` only when you are ready to create and then clean up a real test HotSpot user.
