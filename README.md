# Fibott

Fibott is a mobile-first reverse vending kiosk platform. A user opens the app, starts a deposit session, the backend owns the session and reward logic, the ESP32-CAM captures the item, and approved deposits earn points that can be redeemed for time-limited MikroTik WiFi vouchers.

## Project layout

- `src/` - Next.js app, API routes, auth, business logic, Prisma client, and device APIs
- `prisma/` - Prisma schema, migrations, seed scripts
- `firmware/` - ESP32-CAM firmware (base servo-only build, plus a servo+buzzer variant) and a legacy controller-era sketch kept for migration support
- `hardware/` - wiring notes, BOM, and provisioning guidance for the mobile-first baseline
- `docs/` - system design, connectivity, status, ML classifier notes, and the operator's guide
- `scripts/ml/` - training and dataset preparation pipeline for the classifier

## Key architecture

- `ESP32_CAM` (ESP32-CAM-MB) is the active kiosk board in the baseline design
- The mobile app starts the deposit session
- Backend uses Prisma + Neon Serverless Postgres for users, sessions, deposits, points, and vouchers
- Classifier is TensorFlow.js + MobileNet, with a fine-tuneable head stored in `models/bottle-can-head/weights.json`
- MikroTik integration is fully implemented in `src/lib/mikrotik-client.ts` via direct REST API — set `MIKROTIK_*` env vars and run `npm run test:mikrotik` to verify

## Current status (~98% complete)

- Full application stack working: auth, deposits, wallet, admin portal, voucher redemption.
- Open Hotspot AP & Google OAuth Walled Garden wildcard rules configured on MikroTik.
- MikroTik RouterOS REST integration verified (`npm run test:mikrotik`).
- Support for mock vouchers (`MIKROTIK_HOST="mock"` or `ALLOW_MOCK_VOUCHER="true"`) for offline development/testing without physical router hardware.
- ML training pipeline complete.

## Getting started

1. Install dependencies

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

4. Set environment variables in `.env.local`

Required:
- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

MikroTik Router Configuration:
- `MIKROTIK_HOST` (e.g. `192.168.88.1`, DDNS hostname for production, or `"mock"` for offline testing)
- `MIKROTIK_USER` (default: `admin`)
- `MIKROTIK_PASSWORD`
- `MIKROTIK_HOTSPOT_PROFILE` (default: `1hour`)
- `MIKROTIK_PROTOCOL` (default: `https`)
- `MIKROTIK_PORT` (default: `443`)
- `MIKROTIK_INSECURE_TLS` (default: `true`)

5. Run the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Firmware and device provisioning

- `firmware/esp32-cam/` - active ESP32-CAM sketch (servo only) and camera-side config
- `firmware/esp32-cam-buzzer/` - same sketch, for kiosks with audible buzzer feedback (GPIO14)

## ML training

- `npm run ml:setup` - prepare ML data folders
- `npm run ml:import:taco -- --annotations path/to/annotations.json` - import from the TACO dataset
- `npm run ml:train` - train the fine-tuned model head

## Docs

- `docs/SYSTEM.md` - full system architecture, REST API integration, hardware, firmware, ML classifier, and environment variables
- `docs/STATUS.md` - current completion state and action plan
- `docs/ml.md` - ML classifier technical details
- `docs/CLIENT-GUIDE.md` - plain-language operator's guide: pre-launch checklist, daily operation, troubleshooting

## Useful commands

- `npm run dev` - start Next.js in development mode
- `npm run build` - build the app
- `npm run lint` - run ESLint
- `npm run test:mikrotik` - test direct MikroTik connection and create a sample voucher
- `npx prisma migrate dev` - run migrations and regenerate the client
- `npx prisma db seed` - seed initial reward/voucher rules
