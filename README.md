# Fibott

Fibott is a mobile-first reverse vending kiosk platform. A user opens the app, starts a recycling session, the ESP32-CAM captures the deposited item, and accepted bottles/cans earn points that can be redeemed for time-limited MikroTik HotSpot vouchers.

---

## Status

- **Web app**: Next.js App Router app deployed at `https://fibott.vercel.app`.
- **Authentication**: NextAuth with Credentials and Google OAuth. Emails are normalized before credential login, registration, password reset, and Google profile mapping.
- **Database**: Prisma ORM with Neon Serverless PostgreSQL.
- **Device intake**: ESP32-CAM posts authenticated scans/images to the device APIs.
- **Points**: Earn, spend, and refund flows use database transactions and atomic balance updates.
- **Vouchers**: Redeeming points creates a voucher, attempts direct MikroTik REST when available, and falls back to outbound RouterOS polling sync.
- **MikroTik sync**: RouterOS polls `GET /api/mikrotik/sync` using `MIKROTIK_SYNC_KEY`, creates HotSpot users, then confirms issued vouchers.
- **Operator docs**: See [docs/STATUS.md](docs/STATUS.md), [docs/SYSTEM.md](docs/SYSTEM.md), and [docs/CLIENT-GUIDE.md](docs/CLIENT-GUIDE.md).

---

## Project Layout

- `src/` - Next.js app, API routes, auth, business logic, Prisma client, and device APIs.
- `prisma/` - Prisma schema, migrations, and seed script.
- `firmware/` - ESP32-CAM firmware variants.
- `infra/` - MikroTik RouterOS setup scripts and direct REST test utility.
- `docs/` - System reference, status, ML notes, and operator guide.
- `scripts/` - Classifier dataset/training utilities and admin scripts.

---

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Generate the Prisma client:
   ```bash
   npm run postinstall
   ```

3. Set environment variables in `.env.local`:
   ```bash
   DATABASE_URL=
   NEXTAUTH_SECRET=
   NEXTAUTH_URL=
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   MIKROTIK_HOST=
   MIKROTIK_USER=
   MIKROTIK_PASSWORD=
   MIKROTIK_HOTSPOT_PROFILE=1hour
   MIKROTIK_SYNC_KEY=
   ```

4. Run the app:
   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`.

---

## Useful Commands

- `npm run dev` - Start Next.js in development mode.
- `npm run build` - Build the production bundle.
- `npm run lint` - Run ESLint checks.
- `npx tsc --noEmit` - Run TypeScript type checking.
- `npm run test:mikrotik` - Run the direct MikroTik REST smoke test. This creates a router HotSpot user and should only be used intentionally.
- `npx prisma db seed` - Seed initial reward rules, voucher rules, users, and device keys.
