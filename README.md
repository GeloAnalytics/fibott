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
- MikroTik integration is fully implemented in `src/lib/mikrotik-client.ts` — set `MIKROTIK_*` env vars and run `npm run test:mikrotik` to verify
- The older controller sketch remains only as legacy compatibility during migration

## Current status (~90–95% complete)

- Full application stack working: auth, deposits, wallet, admin portal, voucher redemption. Leaderboard and Reports are still placeholder "coming soon" pages, not implemented
- ESP32-CAM session-polling workflow and firmware complete, including a servo+buzzer variant for kiosks with audible feedback
- MikroTik RouterOS REST integration verified (`npm run test:mikrotik` → `✓ Created hotspot user`)
- Hotspot and Walled Garden configured — `fibott.vercel.app` and `accounts.google.com` accessible before WiFi auth
- MikroTik reachability: `getMikrotikClient()` picks direct-vs-bridge automatically from env vars — direct MikroTik for local dev; in production, either the bridge (`infra/bridge/` + ngrok tunnel) or direct internet exposure (`infra/mikrotik-setup.rsc` §6 + `infra/push-vercel-env-direct.ps1`) work, pick one per deployment. See `docs/SYSTEM.md` → "Bridge service" vs "Direct exposure"
- ML training pipeline complete; accuracy is low (~10%) due to outdoor TACO dataset — retrain with real kiosk captures (see `docs/ml.md`)
- QA pass completed 2026-07-27: fixed a recycling-session frontend/backend desync, stale voucher status display, a points-spent double-count, and a points-balance race condition — see `docs/CLIENT-GUIDE.md` §6 for the list
- See `docs/STATUS.md` for the remaining action plan (production connectivity setup, Vercel env vars, end-to-end test)

## Getting started

1. Install dependencies

```bash
npm install
```

2. Generate Prisma client via `postinstall` or manually:

```bash
npm run postinstall
```

3. Initialize the database and seed defaults:

```bash
npx prisma migrate dev
npx prisma db seed
```

The seed script creates reward rules, a voucher rule, admin/test users, and device entries. It prints plaintext device API keys once; save them before you close the terminal.

4. Set environment variables in `.env`

Required:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

Optional — local development (direct MikroTik):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `RESEND_API_KEY`
- `EMAIL_FROM` — defaults to Resend's sandbox address, which only delivers to the Resend account owner. Verify a custom sending domain in Resend before relying on password-reset emails for real users
- `MIKROTIK_HOST` (default: `192.168.88.1`)
- `MIKROTIK_USER` (default: `admin`)
- `MIKROTIK_PASSWORD`
- `MIKROTIK_HOTSPOT_PROFILE` (default: `1hour`)
- `MIKROTIK_PROTOCOL` (default: `http`)
- `MIKROTIK_PORT` (default: `80`)
- `MIKROTIK_INSECURE_TLS`
- `FIBOTT_ML_HEAD_PATH`

Production needs one of two setups, since the hosted app can't reach a router on your LAN (`192.168.88.1`) directly. Pick one per deployment — `getMikrotikClient()` in `src/lib/mikrotik-client.ts` uses the bridge whenever both `BRIDGE_URL` and `BRIDGE_SECRET` are set, and falls back to calling `MIKROTIK_HOST` directly otherwise.

**Option A — Bridge via tunnel** (`infra/push-vercel-env.ps1`):

- `BRIDGE_URL` — permanent tunnel domain pointing at the bridge service (e.g. ngrok's static domain, started via `infra/start-bridge.ps1`).
- `BRIDGE_SECRET` — shared bearer secret between Vercel and the bridge service.

Requires a machine on the router's LAN to stay running as the bridge host.

**Option B — Direct exposure** (`infra/push-vercel-env-direct.ps1`, no bridge machine, no domain needed):

- `MIKROTIK_HOST` — the router's own DDNS hostname from MikroTik's built-in IP Cloud (`/ip cloud print` after running `infra/mikrotik-setup.rsc` §6), not an IP — survives the router's public IP changing.
- `MIKROTIK_USER` / `MIKROTIK_PASSWORD` — `admin` for now (the scoped `fibott-api` account has an unresolved REST permission issue, see `docs/STATUS.md` — accepted risk for this deployment, not a blocker).
- `MIKROTIK_PROTOCOL=https`, `MIKROTIK_PORT=443`, `MIKROTIK_INSECURE_TLS=true` (self-signed cert by default).

Requires `infra/mikrotik-setup.rsc` §6 to have been run on the router first (DDNS + HTTPS-only + WAN firewall lockdown to just that one port). See `docs/SYSTEM.md` → "Direct exposure" for the full setup and its one router-topology caveat.

Leave `BRIDGE_URL`/`BRIDGE_SECRET` empty (or unset) for local development and for Option B.

5. Run the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Firmware and device provisioning

- `firmware/esp32-cam/` - active ESP32-CAM sketch (servo only) and camera-side config
- `firmware/esp32-cam-buzzer/` - same sketch, for kiosks that also have a buzzer wired for audible accept/reject/error feedback (GPIO14)
- `firmware/kiosk-controller/` - legacy controller sketch kept for migration support
- The active kiosk board requires a `Device` row and plaintext API key generated by `generateDeviceApiKey()` in `src/lib/device-auth.ts`

## ML training

- `npm run ml:setup` - create `ml-data` folders
- `npm run ml:import -- --manifest path/to/manifest.json` - import internet-sourced images into the labeled dataset folders
- `npm run ml:train` - train the fine-tuned head and write `models/bottle-can-head/weights.json`
- Use internet-sourced images for the dataset in this environment; the local capture server is not the primary data path

## Docs

- `docs/SYSTEM.md` - full system architecture (local vs production), bridge service, API endpoints, hardware, firmware, ML classifier, and environment variables
- `docs/STATUS.md` - current completion state and ordered action plan for remaining tasks
- `docs/ml.md` - why the classifier works the way it does, and the path to a properly trained model
- `docs/CLIENT-GUIDE.md` - plain-language operator's guide: pre-launch checklist, daily operation, known limitations, troubleshooting

## Useful commands

- `npm run dev` - start Next.js in development mode
- `npm run build` - build the app
- `npm run lint` - run ESLint
- `npm run bridge:start` - start the local bridge service (localhost:3001)
- `npm run test:mikrotik` - test direct MikroTik connection and create a sample voucher
- `npm run ml:setup` - prepare ML data folders
- `npm run ml:import -- --manifest path/to/manifest.json` - import internet-sourced images into the labeled dataset
- `npm run ml:import:taco -- --annotations path/to/annotations.json` - import from the TACO dataset
- `npm run ml:train` - train the fine-tuned model head
- `npx prisma migrate dev` - run migrations and regenerate the client
- `npx prisma db seed` (or `npm run db:seed`) - seed initial reward/voucher rules
- `npx prisma studio` - open the database browser
