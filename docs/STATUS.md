# Fibott — Status & Next Steps

**Last updated:** 2026-08-09 (firmware buzzer variant + production connectivity decision — see §"2026-08-09 session" below)

Reference: [docs/SYSTEM.md](SYSTEM.md) · Operator-facing summary: [docs/CLIENT-GUIDE.md](CLIENT-GUIDE.md)

---

## Current state (~95% complete)

| Area | Status | Notes |
|---|---|---|
| Backend — auth, sessions, deposits | ✅ Done | NextAuth (credentials + Google), Neon DB |
| Backend — recycling session API | ✅ Done | `POST/GET /api/kiosk/session` — one active session at a time, auto-expires |
| Backend — deposit flow | ✅ Done | Accepts `sessionId` or `sessionCode`; marks session COMPLETED on accept |
| Backend — MikroTik client | ✅ Done | Selects BridgeClient or direct client via `BRIDGE_URL` |
| Backend — bridge client | ✅ Done | `BridgeClient` in `src/lib/mikrotik-client.ts` calls bridge over HTTPS |
| Backend — voucher redeem flow | ✅ Done | Deducts points → creates hotspot user → refunds on failure. Fixed 2026-07-27: the deduct step was read-then-check-then-write, which could race under concurrent requests and push a balance negative (no non-negative DB constraint on `pointsBalance`) — now a single atomic conditional `UPDATE` |
| Frontend — Start Recycling button | ✅ Done | `RecyclingSession` component: idle → active (countdown) → success / expired. Fixed 2026-07-27: a stale-closure bug in the countdown hook could declare the session "expired" the instant it started, even with minutes still left server-side — browser-verified end-to-end after the fix |
| Frontend — wallet + redeem UI | ✅ Done | Redeem button, voucher code displayed immediately, history table. Fixed 2026-07-27: "Points spent" double-counted failed-then-refunded redemptions; vouchers now expire on screen via `expireStaleVouchers()` instead of showing `ISSUED` forever |
| Frontend — admin pages | ✅ Done | Users, deposits, vouchers, rewards, audit log, reports |
| ESP32-CAM firmware | ✅ Done | FSM: IDLE → READY → PROCESSING → SUCCESS/ERROR; polls `/api/kiosk/session` |
| ESP32-CAM firmware — servo+buzzer variant | ✅ Done | `firmware/esp32-cam-buzzer/` — same FSM, adds audible accept/reject/error feedback on GPIO14 |
| Bridge service (production option A) | ✅ Done | `infra/bridge/server.ts` — `npm run bridge:start`. Still valid; requires a tunnel + always-on LAN machine |
| Direct exposure (production option B) | 🟡 Scripted, unverified on hardware | `infra/mikrotik-setup.rsc` §6 + `infra/push-vercel-env-direct.ps1` — chosen for this deployment (no domain available for a stable tunnel hostname). Not yet run against the actual presentation router |
| Tunnel — ngrok setup | ✅ Done (fallback option) | Static domain `cushy-tapeless-dividable.ngrok-free.app` + `infra/start-bridge.ps1`. Kept working in case direct exposure hits a blocker on-site |
| MikroTik hotspot | ✅ Done | Walled Garden: `fibott.vercel.app` + `accounts.google.com` |
| RouterOS REST API (www service) | ✅ Done | Verified working — `npm run test:mikrotik` passes |
| TypeScript build | ✅ Clean | `tsc --noEmit` passes with no errors |
| ML dataset import | ✅ Done | 96 images (65 bottles, 31 cans) from TACO |
| ML training pipeline | ✅ Done | `npm run ml:train` writes `models/bottle-can-head/weights.json` |
| ML classifier accuracy | 🟡 Low | ~10% val accuracy — retrain after collecting real kiosk captures |
| MikroTik `fibott-api` user | 🟡 Deferred, accepted risk | REST permission issues unresolved; `admin` used instead, including for direct exposure — a deliberate decision to ship rather than block launch on it (see 2026-08-09 session note below). Troubleshooting notes for fixing it later are in `infra/mikrotik-setup.rsc` step 2 |
| MikroTik `1hour` profile | ❓ Verify | Confirm with `/ip/hotspot/user/profile/print` |
| ngrok static domain | ✅ Done | Reserved: `cushy-tapeless-dividable.ngrok-free.app` (never changes) — kept as the fallback path |
| Vercel env vars — bridge option | ❓ Verify | Values are ready in `infra/push-vercel-env.ps1` / `.env.local` — confirm `vercel env add` was actually run against production if this is the option used |
| Vercel env vars — direct exposure option | ❌ Needed | `infra/push-vercel-env-direct.ps1` is ready but not yet run — needs the real router's IP Cloud DDNS hostname first (only obtainable once that router is set up, see "Remaining tasks" §C) |
| End-to-end local validation | ✅ Done (2026-07-27) | Browser-verified: login → Start Recycling → simulated deposit → points awarded → wallet redeem → real MikroTik voucher issued (this machine has direct router access) |
| End-to-end **production** validation | ❌ Needed | Same flow through the deployed Vercel app + whichever connectivity option is live, plus real hotspot login with an issued voucher code |
| Password reset email delivery | ❌ Needed | `EMAIL_FROM` is still Resend's sandbox address — reset emails silently fail to reach anyone but the Resend account owner until a custom domain is verified. Registration no longer needs email (auto-verifies), but this path still does |
| MG90S servo condition | ❓ Unverified | Physical check before assembly |

---

## 2026-08-09 session — firmware variant + production connectivity decision

Two additions, not bug fixes:

1. **Servo+buzzer firmware variant** (`firmware/esp32-cam-buzzer/`) — same FSM and network
   protocol as the base sketch, adds audible accept/reject/error feedback for kiosks that
   have a buzzer wired alongside the gate servo. `docs/SYSTEM.md` updated (GPIO table,
   Firmware section) to document both variants side by side.
2. **Direct exposure chosen as this deployment's production connectivity path**, as an
   alternative to the bridge+ngrok setup — no domain is available for a stable Cloudflare
   Tunnel hostname (the alternative that was considered), and the presentation's actual
   router hardware isn't finalized yet so router-specific setup couldn't be verified this
   session. `infra/mikrotik-setup.rsc` §6 and `infra/push-vercel-env-direct.ps1` are ready;
   see `docs/SYSTEM.md` → "Direct exposure" for the full setup and its one router-topology
   caveat (single vs. double NAT), and "Remaining tasks" §C below for what's left to run
   once the real router is in place. The bridge+ngrok setup is left in place as a fallback,
   not removed.

Also decided, not fixed: the unresolved `fibott-api` REST permission issue
(`MikroTik fibott-api user` row above) — direct exposure means whichever account is used
becomes reachable from the whole internet, which raises the stakes on this compared to
local dev. Decision: ship with `admin` anyway rather than block launch on it, same call as
keeping the router's current password as-is. `infra/mikrotik-setup.rsc` step 2 has
diagnostic commands to fix it properly later; not required before deploying.

---

## QA pass — 2026-07-27

A full web-app review (not firmware/hardware) prompted by two user reports: the Start Recycling flow showing incorrect state, and errors converting points to vouchers / redeeming them. Found and fixed five issues, all committed to `master` with detailed commit messages:

1. **Recycling session desync** — `useCountdown`'s lazy `useState` initializer only ran once, while `expiresAt` was still `null` on the idle render, leaving `remaining` stuck at `0`. The instant a session became active, a separate effect saw that stale `0` and immediately declared the session expired — even though the backend session was genuinely active for minutes. Reproduced live (API confirmed `status: "ACTIVE"` with 4+ minutes left while the UI already showed "Session expired"), fixed, and re-verified end to end including a simulated real deposit landing mid-session.
2. **Vouchers never expired on screen** — nothing transitioned `Voucher.status` to `EXPIRED`; a voucher issued days earlier still showed `ISSUED`. Added `expireStaleVouchers()` (`src/lib/voucher.ts`), called from the wallet, admin vouchers, and admin dashboard pages.
3. **"Points spent" double-counted refunds** — the wallet page summed every `SPEND` transaction without netting out `ADJUSTMENT` (refund) transactions, so a failed-then-refunded redemption permanently inflated the displayed total even though the real balance was correctly refunded. This was the literal symptom the user reported ("100 → 300 but balance didn't change").
4. **Unclear redemption failure messaging** — users weren't told their points had been refunded on a failed redemption.
5. **Points balance race condition** — `spendPoints()` read the balance, checked it, then wrote the decrement as separate steps; two concurrent requests could both pass the check before either committed, and since `pointsBalance` has no non-negative DB constraint, both could succeed and push the balance negative. Folded the check into the `UPDATE`'s `WHERE` clause so it's one atomic operation.

Also caught during the fix: the first countdown fix attempt introduced a `react-hooks/set-state-in-effect` lint **error** (would have failed CI) — caught by actually running `eslint`, not just `tsc`, and rewritten to satisfy both the correctness need and the lint rule.

**Not covered by this pass**: ESP32-CAM/kiosk-controller firmware, physical camera/servo behavior, load or concurrency testing beyond the one race condition above, and the two gaps below (found but not fixed, since they're infra/product decisions, not code defects):

- No `Voucher.REDEEMED` tracking — MikroTik doesn't report back when a code is actually used, so status only ever reflects issuance + time-based expiry (see `SYSTEM.md` → Voucher lifecycle).
- MikroTik's own hotspot user list is never pruned — every voucher ever issued leaves a permanent router-side entry.

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

### B. Resolve `fibott-api` REST permissions (10 min, deferred — not required to deploy)

The dedicated API account hits permission errors with RouterOS REST. `admin` is used instead — accepted for now, including for direct exposure (§C), as a deliberate ship-over-block decision (see 2026-08-09 session note above). Worth fixing when there's time, since `admin` becoming internet-reachable is a real if accepted risk.

```
/user/print
/user/group/print detail where name=write
/user/group/print detail where name=full
```

Compare the `policy=` list between `write` and `full`; the account needs at minimum `read` + `write` + whatever policy RouterOS actually requires for REST specifically (commonly `api`/`rest-api` — confirm by testing, don't assume). Full diagnostic sequence and the fix command are in `infra/mikrotik-setup.rsc` step 2. Re-test with the step 5 curl command after each change until `fibott-api` succeeds.

### C. Direct exposure setup — chosen path for this deployment (~20 min, on the actual presentation router)

No domain was available for a stable tunnel hostname, so this deployment calls MikroTik directly instead of through the bridge. Can't be run until the real presentation router is in place — do this once that's settled:

```bash
# 1. Run infra/mikrotik-setup.rsc §6 on the router (Winbox/SSH/WebFig terminal):
#    - enables MikroTik's free built-in DDNS (IP Cloud) — no domain purchase needed
#    - switches REST API to HTTPS-only
#    - firewalls the WAN interface down to just that one port
#    Uses admin (§B deferred, not blocking) — see step 2's note in the .rsc file.

# 2. Check for double NAT (1 min): compare the IP on the router's WAN interface
#    (`/ip address print`) against https://whatismyip.com from a device on its LAN.
#    Different IPs → also port-forward WAN 443 → this router's LAN IP on whatever
#    device sits in front of it (that device's own admin panel, not MikroTik).

# 3. Push env vars to Vercel:
npm i -g vercel
vercel login
.\infra\push-vercel-env-direct.ps1   # fill in the DDNS hostname from `/ip cloud print` first

# Redeploy to pick up new vars
vercel --prod
```

### D. Bridge + ngrok — fallback path, already set up

Kept working in case direct exposure (§C) hits a blocker on-site. Run from the LAN machine that hosts the bridge service (already done on this machine — reproduce here only if moving the bridge to a new machine, or if switching this deployment back to the bridge):

```bash
# 1. Install ngrok and sign up at https://ngrok.com (free, static domain included)

# 2. Add the authtoken (one-time per machine)
ngrok config add-authtoken <YOUR-AUTHTOKEN>

# 3. Reserve a static domain in the ngrok dashboard — URL never changes across restarts
#    Already reserved: cushy-tapeless-dividable.ngrok-free.app

# 4. Domain is hardcoded in infra/start-bridge.ps1 ($NGROK_DOMAIN) — edit only if it changes
# 5. BRIDGE_URL / BRIDGE_SECRET are already filled in infra/push-vercel-env.ps1 — run it, then `vercel --prod`
```

If switching between §C and §D, remember `getMikrotikClient()` prefers the bridge whenever `BRIDGE_URL`/`BRIDGE_SECRET` are both set on Vercel — clear them out when using direct exposure, and set `MIKROTIK_*` when using the bridge doesn't matter since the bridge holds those itself.

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

- **`fibott-api` REST permissions** — dedicated service account exists but hits RouterOS errors; `admin` is the active workaround, including under direct exposure — accepted risk, not blocking this deployment. See "Remaining tasks" §B.
- **Legacy routes** — `POST /api/deposit-sessions`, `GET /api/device/session`, `/api/device/sessions/claim`, `/api/device/sessions/activate` retained for migration; retire when no longer needed.
- **Additional voucher profiles** — seed `3hour`, `1day` `VoucherRule` rows and create matching MikroTik profiles when ready.
- **Servo calibration** — set `SERVO_CLOSED_US` / `SERVO_OPEN_US` in `firmware/esp32-cam/config.h` (or `firmware/esp32-cam-buzzer/config.h` if using that variant) after physical assembly.
- **Multi-kiosk** — add `kioskId` to sessions when expanding beyond one kiosk. No major redesign required.
- **Resend sending domain** — `EMAIL_FROM` still points at Resend's sandbox address; password-reset email delivery is broken for anyone but the Resend account owner until a custom domain is verified.
- **Voucher usage tracking** — `Voucher.REDEEMED` is a schema value nothing ever sets; there's no signal from MikroTik back to the app when a code is actually used at the hotspot.
- **MikroTik hotspot user cleanup** — no code path deletes a router-side hotspot user once its voucher expires app-side; the list grows unbounded without manual pruning.
- **Admin user suspend/edit** — `AccountStatus.SUSPENDED` exists in the schema and is enforced at login, but there's no admin UI action to set it; the User Directory page says as much ("coming soon").
