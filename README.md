# Fibott

Fibott is a mobile-first reverse vending kiosk platform. A user opens the app,
starts a recycling session, the ESP32-CAM captures the deposited item, and
accepted bottles/cans earn points that can be redeemed for time-limited
MikroTik HotSpot vouchers.

## Current Source Of Truth

- The web app, database, device APIs, wallet, admin pages, and voucher
  generation flow are implemented.
- Voucher delivery supports both direct MikroTik REST and outbound RouterOS
  polling sync.
- Production should prefer outbound RouterOS polling sync because it works
  behind NAT/CGNAT and does not require public inbound access to the MikroTik.
- Final QA currently has two open login issues:
  - Google login can show `OAuthAccountNotLinked` for the tested account.
  - MikroTik HotSpot voucher login can show `Web browser did not send challenge response`.
- Do not modify the working voucher sync path while debugging those login issues.

See [docs/STATUS.md](docs/STATUS.md) for the live QA checklist and
[docs/SYSTEM.md](docs/SYSTEM.md) for the architecture reference.

## Project Layout

- `src/` - Next.js app, API routes, auth, business logic, Prisma client, and device APIs
- `prisma/` - Prisma schema, migrations, seed scripts
- `firmware/` - ESP32-CAM firmware variants
- `hardware/` - wiring notes, BOM, and provisioning guidance
- `infra/` - MikroTik RouterOS scripts and direct REST test utility
- `docs/` - system reference, current status, ML notes, and operator guide
- `scripts/ml/` - classifier dataset and training pipeline
- `models/` - trained classifier head artifacts

## Key Architecture

- `ESP32_CAM` is the active kiosk board in the baseline design.
- The mobile app starts deposit sessions and displays points/vouchers.
- Prisma + Neon Serverless Postgres store users, sessions, deposits, points, and vouchers.
- NextAuth supports credentials and Google OAuth.
- Voucher redemption first attempts direct MikroTik REST when configured and reachable.
- On direct REST network failures, the app queues a `PENDING` voucher for outbound RouterOS sync.
- RouterOS outbound sync polls `GET /api/mikrotik/sync`, creates the HotSpot user locally, and confirms the voucher as `ISSUED`.
- The ML classifier uses TensorFlow.js + MobileNet with an optional fine-tuned head in `models/bottle-can-head/weights.json`.

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Generate Prisma client:

```bash
npm run postinstall
```

3. Initialize the database and seed defaults:

```bash
npx prisma migrate dev
npx prisma db seed
```

4. Set environment variables in `.env.local`.

Required app variables:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

MikroTik variables:

- `MIKROTIK_HOST` - router IP/DDNS for direct REST, or `mock` for offline voucher testing
- `MIKROTIK_USER`
- `MIKROTIK_PASSWORD`
- `MIKROTIK_HOTSPOT_PROFILE` - usually `1hour`
- `MIKROTIK_PROTOCOL` - `http` locally or `https` in production
- `MIKROTIK_PORT` - `80` locally or `443` in production
- `MIKROTIK_INSECURE_TLS` - `true` when using self-signed router TLS
- `MIKROTIK_SYNC_KEY` - shared secret for outbound RouterOS polling
- `ALLOW_MOCK_VOUCHER` - optional local testing shortcut

Do not commit real credentials, database URLs, OAuth secrets, or sync keys.

5. Run the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Useful Commands

- `npm run dev` - start Next.js in development mode
- `npm run build` - build the app
- `npm run lint` - run ESLint
- `npx tsc --noEmit` - run TypeScript checks
- `npm run test:mikrotik` - test direct MikroTik REST and create a sample HotSpot user
- `npx prisma migrate dev` - run migrations and regenerate the client
- `npx prisma db seed` - seed initial reward/voucher rules

## Final QA Focus

1. Fix or confirm the Google OAuth issue for `urrizaangelo0719@gmail.com`.
2. Fix the MikroTik HotSpot CHAP challenge-response login error on the router.
3. After voucher login works, retest automatic captive portal notification behavior.

The voucher generation, pending queue, outbound RouterOS sync, HotSpot user
creation, and confirmation flow are working and should remain frozen unless a
new failure directly implicates them.
