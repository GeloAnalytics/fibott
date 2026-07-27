# Fibott — Status & Next Steps

**Last updated:** 2026-07-27

Reference: [docs/SYSTEM.md](SYSTEM.md)

---

## Current state (~95% complete)

| Area | Status | Notes |
|---|---|---|
| Backend — auth, sessions, deposits | ✅ Done | NextAuth (credentials + Google), Neon DB |
| Backend — recycling session API | ✅ Done | `POST/GET /api/kiosk/session` — one active session at a time, auto-expires |
| Backend — deposit flow | ✅ Done | Accepts `sessionId` or `sessionCode`; marks session COMPLETED on accept |
| Backend — MikroTik client | ✅ Done | Selects BridgeClient or direct client via `BRIDGE_URL` |
| Backend — bridge client | ✅ Done | `BridgeClient` in `src/lib/mikrotik-client.ts` calls bridge over HTTPS |
| Backend — voucher redeem flow | ✅ Done | Deducts points → creates hotspot user → refunds on failure |
| Frontend — Start Recycling button | ✅ Done | `RecyclingSession` component: idle → active (countdown) → success / expired |
| Frontend — wallet + redeem UI | ✅ Done | Redeem button, voucher code displayed immediately, history table |
| Frontend — admin pages | ✅ Done | Users, deposits, vouchers, rewards, audit log, reports |
| ESP32-CAM firmware | ✅ Done | FSM: IDLE → READY → PROCESSING → SUCCESS/ERROR; polls `/api/kiosk/session` |
| Bridge service | ✅ Done | `infra/bridge/server.ts` — `npm run bridge:start` |
| Tunnel — zrok setup | ✅ Done | `infra/zrok-tunnel.ps1` + `infra/start-bridge.ps1` |
| MikroTik hotspot | ✅ Done | Walled Garden: `fibott.vercel.app` + `accounts.google.com` |
| RouterOS REST API (www service) | ✅ Done | Verified working — `npm run test:mikrotik` passes |
| TypeScript build | ✅ Clean | `tsc --noEmit` passes with no errors |
| ML dataset import | ✅ Done | 96 images (65 bottles, 31 cans) from TACO |
| ML training pipeline | ✅ Done | `npm run ml:train` writes `models/bottle-can-head/weights.json` |
| ML classifier accuracy | 🟡 Low | ~10% val accuracy — retrain after collecting real kiosk captures |
| MikroTik `fibott-api` user | ❌ Needed | REST permission issues unresolved; still using `admin` |
| MikroTik `1hour` profile | ❓ Verify | Confirm with `/ip/hotspot/user/profile/print` |
| zrok permanent share | ❌ Needed | Follow `infra/zrok-tunnel.ps1` — reserve once, URL never changes |
| Vercel env vars (`BRIDGE_URL`, `BRIDGE_SECRET`) | ❌ Needed | Run `infra/push-vercel-env.ps1` after zrok share is reserved |
| End-to-end production validation | ❌ Needed | Full flow: login → recycle → redeem → hotspot login |
| MG90S servo condition | ❓ Unverified | Physical check before assembly |

---

## Remaining tasks

### A. Verify / create `1hour` hotspot profile (2 min)

In RouterOS terminal (Winbox → New Terminal, or SSH):

```
/ip/hotspot/user/profile/print
```

If `1hour` is not listed:

```
/ip/hotspot/user/profile/add name=1hour session-timeout=1h shared-users=1
```

### B. Resolve `fibott-api` REST permissions (10 min)

The dedicated API account hits permission errors with RouterOS REST. Until resolved, `admin` is used.

```
/user/print
/user/group/print
```

The account needs at minimum `read` + `write` on `/rest/ip/hotspot/user`.

### C. Set up zrok permanent tunnel (10 min)

Run from the LAN machine that will host the bridge service. Full script: `infra/zrok-tunnel.ps1`.

```bash
# 1. Install zrok
winget install OpenZiti.zrok

# 2. Sign up at https://zrok.io (free, no credit card)
#    Copy your Enable Token from the dashboard.

# 3. Enable zrok on this machine (one-time)
zrok enable <YOUR-ENABLE-TOKEN>

# 4. Reserve a permanent share — URL never changes across restarts
zrok reserve public http://localhost:3001 --backend-mode proxy
# → prints your share token, e.g.: abc123def456
# → your permanent URL: https://abc123def456.share.zrok.io

# 5. Fill in ZROK_SHARE_TOKEN in infra/start-bridge.ps1
# 6. Fill in BRIDGE_URL in infra/push-vercel-env.ps1, then run it
```

### D. Push production env vars to Vercel (5 min)

```bash
npm i -g vercel
vercel login
.\infra\push-vercel-env.ps1

# Redeploy to pick up new vars
vercel --prod
```

### E. End-to-end production test (10 min)

1. Log in at `fibott.vercel.app` as `testuser@fibott.local` / `TestUser12345!` (starts with 500 pts).
2. Dashboard → click **Start Recycling** → session starts with 5-min countdown.
3. Insert a bottle or can at the kiosk → ESP32 captures and uploads.
4. Dashboard shows "Deposit successful! +N points".
5. Wallet → click **Redeem** → voucher code appears.
6. Connect a phone to MikroTik hotspot → enter voucher code at captive portal → internet access granted.

### F. Improve ML model (ongoing)

After collecting real kiosk captures:

```bash
# copy captured images into ml-data/PET_BOTTLE and ml-data/ALUMINUM_CAN
npm run ml:train
```

`classifyImage()` switches to the fine-tuned head automatically on next server start.

---

## Deferred

- **`fibott-api` REST permissions** — dedicated service account exists but hits RouterOS errors; `admin` is the active workaround.
- **Legacy routes** — `POST /api/deposit-sessions`, `GET /api/device/session`, `/api/device/sessions/claim`, `/api/device/sessions/activate` retained for migration; retire when no longer needed.
- **Additional voucher profiles** — seed `3hour`, `1day` `VoucherRule` rows and create matching MikroTik profiles when ready.
- **Servo calibration** — set `SERVO_CLOSED_US` / `SERVO_OPEN_US` in `firmware/esp32-cam/config.h` after physical assembly.
- **Multi-kiosk** — add `kioskId` to sessions when expanding beyond one kiosk. No major redesign required.
