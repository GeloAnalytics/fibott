# Fibott — Operator's Guide

*Last updated: 2026-08-23*

This is the plain-language guide for whoever runs Fibott day to day — not the engineering reference. For architecture, environment variables, and hardware wiring, see [SYSTEM.md](SYSTEM.md) and [STATUS.md](STATUS.md).

---

## 1. How it works, in one paragraph

A user opens the app, presses **Start Recycling**, and has 5 minutes to drop a bottle or can into the kiosk. The camera classifies the item, the app awards points, and the user can later redeem points for a WiFi voucher — a code they type into the MikroTik hotspot login page to get internet access. Everything (points, vouchers, users) lives in the web app; the kiosk hardware only captures images and opens the gate.

---

## 2. Before you launch — do these first

These are not optional. Skipping them means real users will hit dead ends.

1. **Change the default admin password.** The seed script creates `admin@fibott.local` / `Admin12345!` and that password is sitting in plain text in the project's source code. Log in and change it (Admin → Profile) before anyone else can find it.

2. **Configure Open WiFi Network (No Password).** Ensure the MikroTik wireless security profile has `authentication-types=none` so users connecting to the "Fibott" SSID do not need a WiFi password. The network is protected and managed entirely by the captive portal voucher system.

3. **Verify Google Sign-In Walled Garden Rules.** Unauthenticated users connected to the hotspot must be allowed to complete Google OAuth. Verify that `infra/mikrotik-setup.rsc` Walled Garden rules (`*google.com`, `*googleapis.com`, `*gstatic.com`, `*googleusercontent.com`, `fibott.vercel.app`) have been executed on the router.

4. **Get the router REST API reachable from the internet**, or voucher redemption will fail. The MikroTik router sits on your local network at `192.168.88.1`, which the hosted Vercel app cannot reach directly unless exposed via DDNS and port 443 HTTPS. Run `infra/mikrotik-setup.rsc` on the router and set `MIKROTIK_HOST` in Vercel to the router's IP Cloud DDNS hostname.

5. **Set up a verified sending domain in Resend, or password reset will silently fail.** Right now `EMAIL_FROM` is `onboarding@resend.dev` — Resend's sandbox address, which only delivers to the Resend account owner's own inbox. Registration doesn't need email anymore (it auto-verifies), but **"Forgot password" still sends a real email**, and that email will never arrive for a real user until a custom domain is verified in Resend.

6. **Save the device API keys.** `npx prisma db seed` prints each device's API key exactly once. Store it somewhere durable.

---

## 3. Daily / weekly operation

**Keep the router online.** If the MikroTik router loses power or its internet connection, recycling still works and points still get awarded, but **voucher redemption will fail** until it is reachable again. (If testing locally without a router, set `MIKROTIK_HOST="mock"` or `ALLOW_MOCK_VOUCHER="true"` in `.env.local`).

**Check these admin pages regularly:**

| Page | What to look for |
|---|---|
| Admin → Dashboard | Totals — user count, vouchers issued, items recycled |
| Admin → Deposit History | A sudden run of `REJECTED` items — camera angle shifted or new item type |
| Admin → Voucher Management | Vouchers stuck as `FAILED` — usually means the router was unreachable at that moment |
| Admin → Audit Logs | Who changed reward/voucher settings, and when |

---

## 4. Known limitations

- **A voucher's status reflects whether it was *issued*, not whether it was *used*.** The router doesn't report back to the app when someone actually logs into the hotspot with a code.
- **The router's own hotspot user list is never cleaned up automatically.** Every voucher ever issued leaves an entry in MikroTik's hotspot user table. Plan on pruning old entries periodically via RouterOS terminal or Winbox.
- **Only one recycling session, system-wide, at a time.** Matches having one physical kiosk chute.

---

## 5. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Google login fails on hotspot / stuck loading | MikroTik Walled Garden blocking Google OAuth subdomains | Ensure `infra/mikrotik-setup.rsc` Walled Garden wildcard rules (`*google.com`, `*googleapis.com`, `*gstatic.com`, `*googleusercontent.com`) are applied on the router |
| Phone prompts for a WiFi password when joining "Fibott" | Security profile has WPA2 enabled | Run `/interface/wireless/security-profiles/set [find default=yes] mode=none authentication-types=none` on the router |
| Voucher redemption fails / points keep getting refunded | Router REST API unreachable or misconfigured host | Check router internet connection and DDNS hostname. For offline dev/testing, set `MIKROTIK_HOST="mock"` in `.env.local` |
| "Start Recycling" flashes to "Session expired" immediately | Resolved timing issue | Ensure latest frontend code is running |
| Password reset email never arrives | Resend sandbox domain limitation | Verify custom sending domain in Resend or reset password manually in admin DB |
