# Fibott — System Reference

**Version:** 2.0 · **Architecture:** Mobile-first, single-board kiosk

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

`getMikrotikClient()` picks between two connectivity options based on env vars — no code
differs between them, only configuration. See "Bridge service" and "Direct exposure" below
for the full setup of each; this deployment uses direct exposure (no domain was available
for a stable tunnel hostname).

**Option A — Bridge** (`BridgeClient`, router never touches the internet):

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
            ngrok Tunnel
      https://cushy-tapeless-dividable.ngrok-free.app
                    │
                    ▼
            Bridge Service
              localhost:3001
                    │
                    ▼
             MikroTik REST API
              192.168.88.1
```

Set `BRIDGE_URL` to the permanent ngrok domain.

**Option B — Direct exposure** (`MikrotikClient`, router is reachable from the internet on
one narrow, firewalled path):

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
              MikrotikClient (no bridge/tunnel)
                    │
                    ▼
             MikroTik REST API
        <router>.sn.mynetname.net
```

Leave `BRIDGE_URL`/`BRIDGE_SECRET` unset — their presence makes `getMikrotikClient()`
prefer the bridge — and set `MIKROTIK_HOST` to the router's DDNS hostname instead.

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

### Production (Vercel) — Option A: Bridge

| Variable | Value |
|---|---|
| `BRIDGE_URL` | `https://cushy-tapeless-dividable.ngrok-free.app` |
| `BRIDGE_SECRET` | _(shared bearer secret between Vercel and bridge)_ |

All other `MIKROTIK_*` vars are only needed locally; the bridge holds them and they never leave the LAN.

### Production (Vercel) — Option B: Direct exposure (in use for this deployment)

| Variable | Value |
|---|---|
| `MIKROTIK_HOST` | Router's IP Cloud DDNS hostname, e.g. `abcd1234.sn.mynetname.net` (from `/ip cloud print`) — not an IP |
| `MIKROTIK_USER` / `MIKROTIK_PASSWORD` | `admin` for now — the scoped `fibott-api` account has an unresolved REST permission issue; accepted risk for this deployment rather than a launch blocker, see `docs/STATUS.md` |
| `MIKROTIK_HOTSPOT_PROFILE` | `1hour` |
| `MIKROTIK_PROTOCOL` | `https` |
| `MIKROTIK_PORT` | `443` |
| `MIKROTIK_INSECURE_TLS` | `true` (self-signed cert by default) |
| `BRIDGE_URL` / `BRIDGE_SECRET` | Unset — their presence takes priority over direct mode |

Set via `infra/push-vercel-env-direct.ps1` after running `infra/mikrotik-setup.rsc` §6 on the router.

---

## Bridge service (production Option A)

File: `infra/bridge/server.ts` — runs on the LAN machine alongside the MikroTik router. This
deployment currently uses direct exposure (Option B, below) instead, since no domain was
available for a stable tunnel hostname — this section is kept as the fallback path.

The bridge listens on `localhost:3001`, validates the `Authorization: Bearer <BRIDGE_SECRET>` header, creates the hotspot user via the local MikroTik REST API, and returns the credentials.

### First-time setup (run once per machine)

1. Install ngrok and sign up at https://ngrok.com (free tier includes one static domain)
2. `ngrok config add-authtoken <token>` — links this machine to your account
3. Reserve a static domain in the ngrok dashboard (e.g. `cushy-tapeless-dividable.ngrok-free.app`) — this URL never changes across restarts
4. Set that URL as `BRIDGE_URL` in Vercel (run `infra/push-vercel-env.ps1`)

### Daily operation

```powershell
.\infra\start-bridge.ps1
```

`start-bridge.ps1` starts the bridge and the ngrok tunnel together. The domain is hardcoded at the top of that file (`$NGROK_DOMAIN`).

### Auto-start on boot (Task Scheduler)

Open Task Scheduler → Create Basic Task:
- Trigger: **At startup** (or At log on)
- Action: Start a program — `powershell.exe`
- Arguments: `-WindowStyle Hidden -File "C:\path\to\Fibott\infra\start-bridge.ps1"`

---

## Direct exposure (production Option B — in use for this deployment)

No LAN machine, no tunnel — Vercel calls the router's REST API directly. Chosen over the
bridge when there's no domain available for a stable tunnel hostname (a Cloudflare named
tunnel needs a domain added as a Cloudflare zone; ngrok's free static domain doesn't).
Trades away "router never touches the internet" for "one less moving part to keep running."
`getMikrotikClient()` in `src/lib/mikrotik-client.ts` already supports this — it only uses
the bridge when both `BRIDGE_URL` and `BRIDGE_SECRET` are set; otherwise it calls
`MIKROTIK_HOST` directly. No code changes needed to switch modes, only env vars.

```
              POST /api/vouchers/redeem
                    │
              getMikrotikClient()
                    │
              MikrotikClient (direct — no bridge/tunnel)
                    │
                    ▼
             MikroTik REST API
        <router>.sn.mynetname.net
```

### Setup (run once per physical router)

1. Run section 6 of `infra/mikrotik-setup.rsc` on the router — enables a free DDNS
   hostname via MikroTik's built-in IP Cloud (no domain purchase needed, survives IP
   changes), switches the REST API to HTTPS-only, and firewalls the WAN interface down to
   just that port (Winbox/SSH/API/FTP/Telnet stay blocked from the internet).
2. Run `infra/push-vercel-env-direct.ps1` with the DDNS hostname from `/ip cloud print` and
   the router's `admin` password. `fibott-api` (a scoped account) has a known unresolved REST
   permission issue (see `docs/STATUS.md`) — using `admin` instead is an accepted risk for
   this deployment, not a launch blocker; swap to `fibott-api` later once that's fixed, no
   other change needed. This step also removes any leftover `BRIDGE_URL`/`BRIDGE_SECRET`
   from Vercel, since their presence takes priority over direct mode.
3. Redeploy: `vercel --prod`

### If the router changes before deployment

IP Cloud hostnames are tied to the router's serial number, so a different physical unit
gets a different hostname. Re-run step 1 on whichever router is actually in use, then
step 2 with its new `dns-name` — no code changes, just swapping one env var.

### One conditional step: check for double NAT (redo this on every new internet connection)

The DDNS hostname and firewall rules survive a change of internet connection automatically —
IP Cloud updates the DNS record itself whenever the WAN IP changes. What doesn't survive is
whether the *new* connection gives this router a real public IP at all, so re-run this check
every time the router moves to a different connection, not just once.

Section 6 of `mikrotik-setup.rsc` only firewalls *this* router — if it sits behind another
router/modem that does the actual internet-facing NAT, that other device also needs a
port-forward (WAN 443 → this router's LAN IP, port 443) configured in its own admin panel.
Check: compare the IP on the router's WAN interface (`/ip address print`) against
`https://whatismyip.com` from a device on its LAN.

- **Same IP** — nothing more to do, direct exposure works as-is.
- **Different IP, and there's a router/modem you can log into** — add the port-forward there.
- **Different IP, and the WAN IP falls in `100.64.0.0–100.127.255.255`, or there's no device
  you can log into at all** — this is carrier-grade NAT (CGNAT), common on mobile data,
  pocket WiFi, and some prepaid plans. There is no fix for this on the router side; no
  firewall rule or port-forward makes it reachable, because the ISP itself controls the NAT
  and doesn't expose it. **Switch to the bridge + tunnel fallback (`infra/start-bridge.ps1`)
  for this connection instead** — it makes an outbound connection to the tunnel, so CGNAT
  doesn't affect it.

---

## Components

**Mobile App** — primary UI. Login, start recycling session, view points, redeem voucher, view history.

**ESP32-CAM** — kiosk board. Polls backend for active sessions, captures images, uploads frames, drives the servo gate. Contains no business logic.

**Next.js Backend (Vercel)** — owns everything: auth, sessions, classification, points, voucher generation, MikroTik integration.

**Neon PostgreSQL** — stores users, sessions, deposits, points, vouchers, devices.

**MikroTik hAP ax lite** — hotspot AP. Issues internet access via voucher codes. Knows nothing about recycling; only receives username/password/profile from the backend.

---

## API Endpoints

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /api/auth/*` | Mobile App | Login, register, password reset |
| `POST /api/kiosk/session` | Mobile App | Start a recycling session |
| `GET /api/kiosk/session` | ESP32-CAM | Poll for active session (device API key) |
| `GET /api/kiosk/session` | Mobile App | Check own session status (user cookie, `?id=<sessionId>`) |
| `POST /api/device/deposit-image` | ESP32-CAM | Upload captured frame → classify → award points → complete session |
| `POST /api/device/scan` | ESP32-CAM (test) | Pre-classified result, no image upload |
| `POST /api/vouchers/redeem` | Mobile App | Spend points → create MikroTik hotspot user → return voucher code |

### Deprecated (retained for migration only)

| Endpoint | Notes |
|---|---|
| `POST /api/deposit-sessions` | Replaced by `POST /api/kiosk/session` |
| `GET /api/device/session` | Replaced by `GET /api/kiosk/session` |
| `POST /api/device/sessions/claim` | Legacy |
| `POST /api/device/sessions/activate` | Legacy |

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

Session auto-expires after 5 minutes if no deposit is made.

---

## Voucher / Reward Workflow

1. User presses **Redeem** in the app.
2. Backend deducts points — `spendPoints()` in `src/lib/points.ts` folds the "sufficient balance" check into the same atomic `UPDATE` as the decrement (`WHERE pointsBalance >= amount`), so two concurrent redemption requests can't both pass the check before either commits.
3. Backend calls MikroTik RouterOS REST API → creates a hotspot user (`name=FBT-XXXX-XXXX-XXXX`, same value as password, `profile=1hour`). If this fails, the voucher is marked `FAILED` and the points are refunded in the same transaction pattern (`refundPoints()`).
4. Voucher code stored in DB, returned immediately to the app.
5. User enters the code at the MikroTik captive portal to get internet access.

Points: PET\_BOTTLE = 5 pts · ALUMINUM\_CAN = 10 pts · 1 Hour WiFi = 100 pts

### Voucher lifecycle and its limits

`Voucher.status` moves `PENDING → ISSUED → EXPIRED`, or `PENDING → FAILED` on issuance failure. `expireStaleVouchers()` (`src/lib/voucher.ts`) sweeps `ISSUED` vouchers past their `expiresAt` to `EXPIRED` — called opportunistically from the wallet page, admin vouchers page, and admin dashboard on each load (no cron; it's a lazy sweep, same pattern as `expireStale()` for deposit sessions in `src/app/api/kiosk/session/route.ts`).

Two things this system does **not** do, by design gap rather than by choice — noted here so they aren't mistaken for bugs:

- **No `REDEEMED` tracking.** MikroTik doesn't report back when a voucher code is actually used to log into the hotspot, so the app has no way to distinguish "issued but never used" from "issued and used." `Voucher.status` only ever reflects issuance and time-based expiry, never actual usage — despite `REDEEMED` existing as a schema value, nothing currently sets it.
- **No cleanup of the MikroTik-side hotspot user list.** Every voucher ever issued leaves a permanent `/ip/hotspot/user` entry on the router; the app never deletes it, including after the app marks the voucher `EXPIRED` on its own side. Left unpruned, this list grows without bound — see `CLIENT-GUIDE.md` §4 for the operational note.

---

## MikroTik Walled Garden

Unauthenticated users (no voucher) can reach only:

| Domain | Reason |
|---|---|
| `fibott.vercel.app` | The app itself (login, deposit, redeem) |
| `accounts.google.com` | Google OAuth |

Everything else stays blocked until a valid voucher is used.

---

## Hardware

### Active components

| Part | Role |
|---|---|
| ESP32-CAM-MB (AI-Thinker, OV2640) | Captures deposited item, uploads image, drives servo |
| MG90S servo (metal gear, micro) | Opens/closes intake gate |
| Dedicated 5V/1A supply (servo rail) | Separate from camera supply |
| Dedicated 5V/500mA+ supply (camera rail) | Do not share with servo |

### ESP32-CAM safe GPIO

| Function | GPIO | Notes |
|---|---|---|
| Servo signal | **13** | Baseline pin, not a strapping pin |
| Status LED | 33 | Onboard red, active-LOW |
| Buzzer signal | 14 | Only if a buzzer is wired — see `firmware/esp32-cam-buzzer/` |
| Optional sensor | 15 | Only if a presence sensor is added later |

Camera data lines (do not use): 5, 18, 19, 21, 22, 23, 25, 26, 27, 32, 34, 35, 36, 39.

### Servo wiring

```
5V PSU (+)       → servo red
5V PSU GND       → servo brown/black
ESP32-CAM GND    → common ground with servo PSU  ← mandatory
ESP32-CAM GPIO13 → servo signal (optional 220–470 Ω series resistor)
```

Do not power the servo from the ESP32-CAM board's own rail — camera WiFi TX spikes will brown-out a shared supply.

---

## Firmware

Sketch: `firmware/esp32-cam/esp32-cam.ino`

Variant: `firmware/esp32-cam-buzzer/esp32-cam-buzzer.ino` — identical state machine and
network protocol, for kiosks that also have an active buzzer (GPIO14, active-HIGH) wired
alongside the servo. Adds audible feedback: a short beep on boot/READY, one long beep on
ACCEPT (while the gate opens), three short beeps on REJECT, one long beep on error.

### Configure (`firmware/esp32-cam/config.h`)

| Setting | Value |
|---|---|
| `WIFI_SSID` / `WIFI_PASSWORD` | LAN the kiosk joins |
| `BACKEND_HOST` | `your-app.vercel.app` (no `https://`) |
| `BACKEND_PORT` | `443` production · local dev port otherwise |
| `DEVICE_API_KEY` | Plaintext key from seed output |
| `PIN_SERVO` | `13` |
| `SERVO_CLOSED_US` / `SERVO_OPEN_US` | Calibrate after assembly |
| `PIN_BUZZER` | `14` (buzzer variant only) |
| `POLL_INTERVAL_MS` | `2000` |
| `GATE_OPEN_MS` | `3000` |
| `RETRY_DELAY_MS` | `2000` |

### Flash

1. Arduino IDE → Board: **AI Thinker ESP32-CAM**
2. Tools → PSRAM → **OPI PSRAM**
3. Flash via the MB base board micro-USB (onboard CH340C, no FTDI needed).
4. Serial Monitor at **115200** baud.

### ESP32-CAM state machine

```
BOOT → CONNECT WIFI → IDLE
  IDLE: poll /api/kiosk/session every 2 s
    → session found → READY
  READY: capture image immediately → PROCESSING
  PROCESSING: upload to /api/device/deposit-image
    → ACCEPT → SUCCESS
    → REJECT / error → ERROR
  SUCCESS: open gate 3 s → close gate → IDLE
  ERROR: check if session still active
    → still active → READY (retry)
    → gone / expired → IDLE
```

### Device provisioning

1. Run `npx prisma db seed` — generates a `Device` row and prints the plaintext API key (shown once).
2. Flash the plaintext key into `DEVICE_API_KEY` in `config.h`.
3. The backend stores only the bcrypt hash; the plaintext is never stored.

---

## ML Classifier

File: `src/lib/classifier.ts` — see `docs/ml.md` for the full explanation of why it works this way, current accuracy, and what it takes to improve it. Summary:

**Two modes, same function** (`classifyImage(buffer)`):

1. **Fine-tuned head** (`models/bottle-can-head/weights.json`) — if the file exists, used automatically.
2. **Zero-shot fallback** — keyword mapping over MobileNetV2 ImageNet labels. Active now.

`MIN_CONFIDENCE = 0.15` — predictions below this threshold become `REJECTED`.

### Training workflow

```bash
npm run ml:import:taco -- --annotations "path/to/annotations.json" --max-per-label 139
npm run ml:train
```

---

## Design Principles

- Mobile app is the only user-facing interface — no physical buttons.
- Backend owns all business logic; ESP32-CAM owns only hardware control.
- MikroTik owns only networking; it never knows about points or recycling.
- Walled Garden lets users earn and redeem before they have internet access.
- One kiosk, one active session at a time. Multi-kiosk requires adding `kioskId` to sessions.
- Simplicity and reliability over premature optimization.
