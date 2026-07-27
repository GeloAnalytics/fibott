# Fibott — Operator's Guide

*Last updated: 2026-07-27*

This is the plain-language guide for whoever runs Fibott day to day — not the engineering reference. For architecture, environment variables, and hardware wiring, see [SYSTEM.md](SYSTEM.md) and [STATUS.md](STATUS.md).

---

## 1. How it works, in one paragraph

A user opens the app, presses **Start Recycling**, and has 5 minutes to drop a bottle or can into the kiosk. The camera classifies the item, the app awards points, and the user can later redeem points for a WiFi voucher — a code they type into the MikroTik hotspot login page to get internet access. Everything (points, vouchers, users) lives in the web app; the kiosk hardware only captures images and opens the gate.

---

## 2. Before you launch — do these first

These are not optional. Skipping them means real users will hit dead ends.

1. **Change the default admin password.** The seed script creates `admin@fibott.local` / `Admin12345!` and that password is sitting in plain text in the project's source code. Log in and change it (Admin → Profile) before anyone else can find it.

2. **Set up a verified sending domain in Resend, or password reset will silently fail.** Right now `EMAIL_FROM` is `onboarding@resend.dev` — Resend's sandbox address, which only delivers to the Resend account owner's own inbox. Registration doesn't need email anymore (it auto-verifies), but **"Forgot password" still sends a real email**, and that email will never arrive for a real user until a custom domain is verified in Resend. The app will tell the user "check your email" either way — it has no way to know delivery failed. Until this is fixed, there is no way for a user who forgets their password to get back in except an admin resetting it manually in the database.

3. **Get the bridge running before going live**, or every voucher redemption will fail. The MikroTik router sits on your local network at `192.168.88.1`, which the hosted app (once deployed) cannot reach directly. The bridge service + zrok tunnel solve this — follow `infra/zrok-tunnel.ps1` step by step, then keep the bridge PC running via `infra/start-bridge.ps1` (there are instructions in that file for making it auto-start on boot). If you're still testing on the same local network as the router, this isn't needed yet — but it is required the moment the app is deployed anywhere else.

4. **Save the device API keys.** `npx prisma db seed` prints each device's API key exactly once. If you lose it, you have to regenerate it and reflash the kiosk's firmware. Store it somewhere durable (password manager, not a sticky note).

5. **Decide what to do with test accounts.** The database currently has several test/dev accounts (`testuser@fibott.local` and a handful of others created while building this). Remove them or leave them — just make that decision deliberately before go-live rather than by accident.

6. **Confirm Google Sign-In is wanted.** `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are already configured, so "Continue with Google" is live. If that's not desired, it needs to be removed from the login/register pages.

---

## 3. Daily / weekly operation

**Keep the bridge PC on.** If it (or its internet connection, or the zrok tunnel) goes down, recycling still works — points still get awarded — but **voucher redemption will fail** for everyone until it's back up. This is the single most common way the system will look "broken" day to day.

**Check these admin pages regularly:**

| Page | What to look for |
|---|---|
| Admin → Dashboard | Rough totals — user count, vouchers issued, items recycled |
| Admin → Deposit History | A sudden run of `REJECTED` items — may mean the camera angle shifted or the classifier is struggling with a new item type |
| Admin → Voucher Management | Vouchers stuck as `FAILED` — usually means the bridge or router was unreachable at that moment |
| Admin → Audit Logs | Who changed reward/voucher settings, and when |

**Adjust point values and voucher pricing** under Admin → Rewards Management — no code changes needed. Changes there take effect immediately for the next deposit/redemption.

**Review users** under Admin → User Directory (search by name or email). Suspend/edit actions aren't built yet — see §5.

---

## 4. Known limitations — set expectations accordingly

- **The camera's item recognition is a bootstrap model, not a trained one yet.** It currently reuses a general-purpose image classifier (MobileNet/ImageNet) with a keyword mapping — it was never trained on photos of your specific kiosk chute. Expect some misclassified or rejected items until it's retrained on real kiosk captures. There's already a pipeline for this (`npm run ml:train`) — it just needs a batch of real accepted/rejected photos from the field to run against.
- **A voucher's status reflects whether it was *issued*, not whether it was *used*.** The router doesn't report back to the app when someone actually logs into the hotspot with a code. A voucher shows `ISSUED` until its time window passes (then `EXPIRED`), regardless of whether the user ever connected.
- **The router's own hotspot user list is never cleaned up automatically.** Every voucher ever issued leaves a permanent entry in MikroTik's hotspot user table — the app doesn't delete them once they expire. Plan on pruning old entries there periodically (RouterOS terminal, or Winbox) so the list doesn't grow unbounded.
- **No admin tools yet to suspend or edit a user** — that page is explicitly marked "coming soon" in the app itself.
- **Reports and Leaderboard are placeholders** — not implemented yet, shown as "coming soon."
- **Only one recycling session, system-wide, at a time.** This matches having one physical kiosk. If a second kiosk is ever added, the session logic needs a `kioskId` added — noted as a known follow-up in `STATUS.md`.

---

## 5. If something goes wrong

| Symptom | Likely cause | What to do |
|---|---|---|
| Voucher redemption fails / "couldn't issue voucher" | Bridge PC off, zrok tunnel dropped, or the router itself is unreachable | Check the bridge PC is on and connected; check `infra/start-bridge.ps1` is running; points are automatically refunded on failure, so the user hasn't lost anything |
| A user says a redemption failed but their "points spent" total looks off | This was a real bug, fixed 2026-07-27 — refunded attempts were inflating the spent total even though the balance was correct. If you still see this after that date, something regressed — flag it | — |
| "Start Recycling" flashes to "Session expired" immediately | This was a real bug, fixed 2026-07-27 — a timing issue in the countdown made the app declare the session expired the instant it started, even though the kiosk was still waiting. Should not recur | If it does, capture a screenshot and check the server logs around that timestamp |
| A user never received their "reset password" email | Resend sandbox domain limitation — see §2, item 2 | Verify a sending domain in Resend, or reset the user's password directly |
| A run of items come back "rejected" that should have been accepted | Classifier limitation (see §4) or a physical issue — lighting, camera angle, dirty lens | Check Admin → Deposit History for the `classificationLabel` on those rows; consider a retraining pass |
| The kiosk device itself seems unresponsive | Hardware/firmware issue, not a web app issue | See `SYSTEM.md` → Firmware/Hardware sections |

---

## 6. Recent fixes (this review pass, 2026-07-27)

For a paper trail — these were found and fixed during this QA pass:

- **Recycling session desync**: the on-screen countdown could immediately (and incorrectly) declare a session "expired" the moment it started, even though the kiosk was genuinely still waiting for a deposit for several more minutes.
- **Vouchers never expired on screen**: a WiFi voucher stayed marked "ISSUED" forever, even long after its time window had passed, making it look usable when it wasn't.
- **"Points spent" total was inflated**: a failed-then-refunded voucher redemption permanently added to the displayed "points spent" figure even though the user's actual balance was correctly refunded.
- **Redemption failure message was unclear**: users weren't told their points had been refunded when a redemption failed.
- **A rare race condition could push a balance negative**: two redemption requests at nearly the same instant could, in theory, both pass the "enough points" check before either was recorded — now the check and the deduction happen as a single atomic step.

All five are covered by the git history on `master` with detailed commit messages if you want the technical explanation for any of them.
