# Fibott - System Reference

**Version:** 2.1  
**Architecture:** Mobile-first, single-board kiosk

Fibott is a reverse-vending kiosk that awards internet vouchers for deposited
recyclable bottles and cans. The mobile app is the user interface; the
ESP32-CAM is the embedded controller; the MikroTik provides the captive portal
and HotSpot voucher enforcement.

---

## Architecture

```text
User phone
  -> Fibott web app on Vercel
  -> Next.js API routes
  -> Neon Postgres via Prisma

ESP32-CAM
  -> polls /api/kiosk/session
  -> uploads deposit images
  -> receives accept/reject action

Voucher delivery
  -> Direct REST fast path when MikroTik is reachable
  -> Outbound RouterOS polling sync when direct REST is unavailable
```

Production should prefer outbound RouterOS polling sync. It works behind NAT,
CGNAT, upstream routers, mobile hotspots, and campus/home networks without
opening inbound ports to the MikroTik.

---

## Core Components

| Component | Location | Purpose |
|---|---|---|
| Next.js app | `src/app` | UI, route handlers, auth pages, dashboard, admin |
| Auth config | `src/lib/auth.ts` | NextAuth credentials + Google OAuth |
| Prisma schema | `prisma/schema.prisma` | Users, accounts, sessions, deposits, points, vouchers |
| Prisma client | `src/lib/prisma.ts` | Neon-backed Prisma client |
| Voucher redeem API | `src/app/api/vouchers/redeem/route.ts` | Spend points and create/queue vouchers |
| MikroTik sync API | `src/app/api/mikrotik/sync/route.ts` | RouterOS polling and confirmation endpoint |
| MikroTik REST client | `src/lib/mikrotik-client.ts` | Optional direct REST HotSpot user creation |
| RouterOS sync script | `infra/fibott-sync.rsc` | Polls Vercel and creates HotSpot users locally |
| RouterOS setup notes | `infra/mikrotik-setup.rsc` | Walled Garden, HotSpot profile, REST, sync setup |
| ESP32-CAM firmware | `firmware/esp32-cam` | Active kiosk firmware |
| ESP32-CAM buzzer firmware | `firmware/esp32-cam-buzzer` | Optional buzzer variant |

---

## Environment Variables

### Required App Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon/Postgres connection used by Prisma |
| `NEXTAUTH_SECRET` | NextAuth signing/encryption secret |
| `NEXTAUTH_URL` | Public base URL for auth callbacks |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

### MikroTik Variables

| Variable | Purpose |
|---|---|
| `MIKROTIK_HOST` | Router IP/DDNS for direct REST, or `mock` for offline voucher testing |
| `MIKROTIK_USER` | Router account for direct REST |
| `MIKROTIK_PASSWORD` | Router password for direct REST |
| `MIKROTIK_HOTSPOT_PROFILE` | HotSpot user profile, usually `1hour` |
| `MIKROTIK_PROTOCOL` | `http` locally or `https` in production |
| `MIKROTIK_PORT` | `80` locally or `443` in production |
| `MIKROTIK_INSECURE_TLS` | `true` when using self-signed router TLS |
| `MIKROTIK_SYNC_KEY` | Shared secret for `/api/mikrotik/sync` polling |
| `ALLOW_MOCK_VOUCHER` | Optional local flag to generate mock vouchers |

Do not commit or expose real database URLs, router passwords, Google secrets,
OAuth tokens, provider account IDs, or sync keys.

---

## Auth

Auth is implemented with NextAuth in `src/lib/auth.ts`.

Providers:

- Credentials
- Google

Important Google facts:

- `allowDangerousEmailAccountLinking: true` is present.
- Production advertises the Google provider through `/api/auth/providers`.
- The tested account `urrizaangelo0719@gmail.com` exists, is active, is email
  verified, and has Google `Account` rows linked to the same user ID in the
  currently configured database.

Open QA issue:

```text
OAuthAccountNotLinked
```

Do not delete users or account rows unless production logs identify a specific
bad record or provider mismatch.

---

## Deposit Workflow

```text
User presses Start Recycling
  -> POST /api/kiosk/session
  -> DepositSession ACTIVE for 5 minutes
  -> ESP32-CAM polls GET /api/kiosk/session
  -> ESP32-CAM uploads image to /api/device/deposit-image
  -> classifier returns material type
  -> accepted deposit awards points
  -> session completes
  -> dashboard shows awarded points
```

The app currently supports one active recycling session at a time, matching the
single physical kiosk chute.

---

## Voucher Workflow

```text
User redeems points
  -> POST /api/vouchers/redeem
  -> points deducted in a transaction
  -> voucher row created as PENDING
  -> app attempts direct MikroTik REST
```

If direct REST succeeds:

```text
MikroTik HotSpot user is created immediately
  -> voucher status ISSUED
  -> code displayed to user
```

If direct REST fails due to network reachability:

```text
voucher gets a generated FBT code
  -> voucher remains PENDING
  -> code displayed to user
  -> RouterOS polls /api/mikrotik/sync
  -> RouterOS creates HotSpot user locally
  -> RouterOS confirms to Vercel
  -> voucher status ISSUED
```

If direct REST fails due to auth, permission, validation, or missing profile:

```text
voucher status FAILED
  -> points refunded
  -> admin/system logs record the failure category
```

---

## Router Integration

### Outbound RouterOS Polling Sync

This is the recommended production path.

```text
MikroTik
  -> outbound HTTPS GET /api/mikrotik/sync
  -> receives PENDING:id:code:profile:duration
  -> creates /ip hotspot user
  -> confirms /api/mikrotik/sync?confirm=<id>
  -> app marks voucher ISSUED
```

Benefits:

- no public MikroTik REST API exposure
- no TP-Link port forwarding
- no static public IP
- no DDNS requirement
- works behind NAT and CGNAT

### Direct REST

Direct REST is still implemented and useful on LAN/local testing or when the
router is deliberately reachable from the app.

It calls:

```text
/rest/ip/hotspot/user
```

Direct REST is optional for production because outbound sync is sufficient for
voucher delivery.

---

## MikroTik HotSpot QA

Voucher generation and HotSpot user creation are working. The current remaining
router-side issue is captive portal authentication:

```text
Web browser did not send challenge response (try again, enable JavaScript)
```

Diagnostic commands:

```routeros
/ip hotspot profile print detail
/ip hotspot print detail
/ip hotspot user profile print detail where name=1hour
```

Inspect:

- `login-by`
- HotSpot profile selected by the active server
- CHAP challenge-response behavior
- login page HTML/JavaScript
- whether the login page assets are being served correctly

Do not change voucher generation or outbound sync while debugging this.

---

## API Endpoints

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /api/auth/*` | Mobile app | Login, register, reset password |
| `POST /api/kiosk/session` | Mobile app | Start recycling session |
| `GET /api/kiosk/session` | ESP32-CAM / mobile app | Poll active session or check session status |
| `POST /api/device/deposit-image` | ESP32-CAM | Upload image, classify, award points |
| `POST /api/device/logs` | ESP32-CAM / system | Post device telemetry |
| `GET /api/admin/logs` | Admin | Query logs |
| `DELETE /api/admin/logs` | Admin | Purge logs |
| `POST /api/device/scan` | ESP32-CAM test | Submit pre-classified scan result |
| `POST /api/vouchers/redeem` | Mobile app | Spend points and create/queue voucher |
| `GET /api/mikrotik/sync` | MikroTik | Poll pending voucher and confirm issuance |

---

## ML Classifier

- File: `src/lib/classifier.ts`
- Base model: TensorFlow.js + MobileNet
- Optional trained head: `models/bottle-can-head/weights.json`
- Training pipeline: `scripts/ml`

Build note: Turbopack may warn about tracing the classifier because it can load
the optional model head from the filesystem. This warning is not related to
auth, vouchers, or MikroTik sync.
