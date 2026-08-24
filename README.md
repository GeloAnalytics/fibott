# Fibott

Fibott is a mobile-first reverse vending kiosk platform. A user opens the app, starts a recycling session, the ESP32-CAM captures the deposited item, and accepted bottles/cans earn points that can be redeemed for time-limited MikroTik HotSpot vouchers.

---

## 🚀 Status

- **Web App & Production**: Deployed and live at [`https://fibott.vercel.app`](https://fibott.vercel.app).
- **Authentication**: NextAuth with Credentials and Google OAuth (`allowDangerousEmailAccountLinking: true`).
- **Database**: Prisma ORM + Neon Serverless PostgreSQL.
- **MicroTik HotSpot Integration**: Direct REST API + Outbound RouterOS Polling Sync (`GET /api/mikrotik/sync`).
- **Voucher Claiming**: Interactive **Use Voucher** and **Copy Code** action buttons with step-by-step connection guide.
- **Timezone**: All application logs, audit trails, and transaction ledgers formatted in **Philippines Time (Asia/Manila GMT+8)**.
- **Mobile Responsiveness**: Viewport scale locked and mobile input font-size enforced (min 16px) to eliminate iOS Safari auto-zooming.

See [docs/STATUS.md](docs/STATUS.md) for full status verification and [docs/SYSTEM.md](docs/SYSTEM.md) for technical architecture details.

---

## 📁 Project Layout

- `src/` — Next.js app, API routes, auth, business logic, Prisma client, and device APIs
- `prisma/` — Prisma schema, migrations, seed scripts
- `firmware/` — ESP32-CAM firmware variants (`esp32-cam` and `esp32-cam-buzzer`)
- `infra/` — MikroTik RouterOS setup scripts (`mikrotik-setup.rsc`, `fibott-sync.rsc`) and direct REST test utility
- `docs/` — System reference, status, ML notes, and operator guide
- `scripts/` — Classifier dataset training pipeline and admin utilities

---

## ⚙️ Key Architecture

- **ESP32-CAM**: Active kiosk controller board running FSM (IDLE → READY → PROCESSING → SUCCESS/ERROR).
- **Mobile Web App**: Manages recycling sessions, displays real-time points, and issues Wi-Fi vouchers.
- **Outbound RouterOS Sync**: MikroTik router polls `GET /api/mikrotik/sync` every 3 seconds to fetch pending vouchers, create HotSpot users, and confirm activation — zero open ports required.
- **ML Classifier**: TensorFlow.js + MobileNetV2 with fine-tuned head (`models/bottle-can-head/weights.json`).

---

## 💻 Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Generate Prisma client**:
   ```bash
   npm run postinstall
   ```

3. **Set environment variables in `.env.local`**:
   - `DATABASE_URL`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `MIKROTIK_HOST`
   - `MIKROTIK_USER`
   - `MIKROTIK_PASSWORD`
   - `MIKROTIK_HOTSPOT_PROFILE` (`1hour`)
   - `MIKROTIK_SYNC_KEY`

4. **Run the app**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.

---

## 🛠️ Useful Commands

- `npm run dev` — Start Next.js in development mode
- `npm run build` — Build production bundle
- `npm run lint` — Run ESLint checks
- `npx tsc --noEmit` — Run TypeScript type checking
- `npm run test:mikrotik` — Test direct MikroTik REST API connection
- `npx prisma db seed` — Seed initial reward and voucher rules
