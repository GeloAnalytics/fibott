# Fibott — Status & Next Steps

**Last updated:** 2026-07-26 (post-bridge handover)

Reference: [docs/SYSTEM.md](SYSTEM.md)

---

## Current state (~90–95% complete)

| Area | Status | Notes |
|---|---|---|
| Backend — auth, sessions, deposits | ✅ Done | NextAuth (credentials + Google), Neon DB |
| Backend — MikroTik client | ✅ Done | `src/lib/mikrotik-client.ts` — selects BridgeClient or direct client via `BRIDGE_URL` |
| Backend — bridge client | ✅ Done | `BridgeClient` in `src/lib/mikrotik-client.ts` calls bridge over HTTPS |
| Backend — voucher redeem flow | ✅ Done | Deducts points → creates hotspot user → refunds on failure |
| Frontend — wallet + redeem UI | ✅ Done | Redeem button, voucher code displayed immediately, history table |
| Frontend — admin pages | ✅ Done | Users, deposits, vouchers, rewards, audit log, reports |
| ESP32-CAM polling endpoint | ✅ Done | `GET /api/device/session` — atomically claims PENDING session |
| ESP32-CAM firmware | ✅ Done | Session-polling loop, no UART, no controller board needed |
| Bridge service | ✅ Done | `infra/bridge/server.ts` — `npm run bridge:start` |
| MikroTik hotspot | ✅ Done | Walled Garden: `fibott.vercel.app` + `accounts.google.com` |
| RouterOS REST API (www service) | ✅ Done | Verified working — `npm run test:mikrotik` passes, hotspot user created |
| Local MikroTik connection | ✅ Done | `npm run test:mikrotik` → `✓ Created hotspot user` confirmed |
| TypeScript build | ✅ Clean | `tsc --noEmit` passes with no errors |
| ML dataset import | ✅ Done | 96 images (65 bottles, 31 cans) from TACO |
| ML training pipeline | ✅ Done | `npm run ml:train` writes `models/bottle-can-head/weights.json` |
| ML classifier accuracy | 🟡 Low | ~10% val accuracy — dataset is Flickr outdoor trash, not kiosk captures; retrain after collecting real images |
| MikroTik `fibott-api` user | ❌ Needed | REST permission issues unresolved; still using `admin` |
| MikroTik `1hour` profile | ❓ Verify | May already exist — confirm with `/ip/hotspot/user/profile/print` |
| Cloudflare Tunnel (permanent) | ❌ Needed | Quick tunnel works for dev; production needs `cloudflared service install` |
| Vercel env vars (`BRIDGE_URL`, `BRIDGE_SECRET`) | ❌ Needed | Run `infra/push-vercel-env.ps1` after permanent tunnel is up |
| End-to-end production validation | ❌ Needed | Full flow from login → recycle → redeem → hotspot login |
| MG90S servo condition | ❓ Unverified | Physical check before assembly |

---

## Action plan — remaining tasks

### A. Verify / create `1hour` hotspot profile (2 min)

Open a RouterOS terminal (Winbox → New Terminal, or SSH):

```
/ip/hotspot/user/profile/print
```

If the `1hour` profile is not listed:

```
/ip/hotspot/user/profile/add name=1hour session-timeout=1h shared-users=1
```

### B. Resolve `fibott-api` REST permissions (10 min)

The dedicated API account exists but hits permission errors with RouterOS REST. Investigate:

```
/user/print
/user/group/print
```

The account needs at minimum `read` + `write` on `/rest/ip/hotspot/user`. Until resolved, `admin` is used as a workaround.

### C. Deploy permanent Cloudflare Tunnel (15 min)

Run from the machine that stays on the LAN (run as Administrator for service install):

```bash
# 1. Install (if not already installed)
winget install Cloudflare.cloudflared

# 2. Login (opens browser — link your Cloudflare account)
cloudflared tunnel login

# 3. Create tunnel
cloudflared tunnel create fibott-mikrotik
# → prints a UUID, e.g. a1b2c3d4-...

# 4. Edit infra/cloudflared-config.yml — replace <TUNNEL-ID> and <YOU> with real values
#    Then copy it to: C:\Users\<YOU>\.cloudflared\config.yml

# 5. Run tunnel to verify
cloudflared tunnel run fibott-mikrotik
# → prints: https://<uuid>.cfargotunnel.com

# 6. Install as Windows service so it survives reboots
cloudflared service install
Start-Service cloudflared
```

### D. Push production env vars to Vercel (5 min)

Edit `infra/push-vercel-env.ps1` — fill in the tunnel URL and `BRIDGE_SECRET`, then:

```bash
npm i -g vercel
vercel login
.\infra\push-vercel-env.ps1

# Redeploy to pick up new vars
vercel --prod
```

### E. End-to-end production test (10 min)

1. Log in at `fibott.vercel.app` as `testuser@fibott.local` / `TestUser12345!` (starts with 500 pts).
2. Go to **Wallet** → click **Redeem** on the 1 Hour WiFi card.
3. Voucher code appears immediately on screen.
4. In RouterOS terminal confirm: `/ip/hotspot/user/print` — the new user should appear.
5. Connect a phone to the MikroTik hotspot, enter the voucher code at the captive portal.
6. Confirm internet access is granted.

### F. Improve ML model (ongoing)

The current dataset (TACO outdoor trash images) gives ~10% validation accuracy. After collecting real kiosk captures:

```bash
npm run ml:setup
# copy captured images into ml-data/PET_BOTTLE and ml-data/ALUMINUM_CAN
npm run ml:train
```

`classifyImage()` switches to the fine-tuned head automatically on next server start.

---

## Deferred

- **`fibott-api` REST permissions** — dedicated service account exists but hits RouterOS permission errors; `admin` is the active workaround. Resolve and swap credentials before leaving beta.
- **Legacy routes** — `/api/device/sessions/claim` and `/api/device/sessions/activate` retained for migration; retire when no longer needed.
- **Additional voucher profiles** — seed `3hour`, `1day` `VoucherRule` rows and create matching MikroTik profiles when ready.
- **ML dataset licensing** — define source rules for TACO + any supplemental images before using in production.
- **Servo calibration** — set `SERVO_CLOSED_US` / `SERVO_OPEN_US` in `firmware/esp32-cam/config.h` after physical assembly.
