# Fibott - Operator Guide

**Last updated:** 2026-08-24

This is the plain-language guide for running Fibott day to day. For engineering
details, see [SYSTEM.md](SYSTEM.md). For current QA status, see
[STATUS.md](STATUS.md).

---

## What Fibott Does

A user opens the Fibott web app, starts a recycling session, and deposits a
bottle or can into the kiosk. The ESP32-CAM captures the item, the app awards
points for accepted deposits, and the user can redeem those points for a
MikroTik HotSpot voucher code.

The user enters that code on the MikroTik captive portal to get internet access.

---

## Current QA State

Working:

- user dashboard and wallet
- admin pages
- recycling sessions
- deposit image flow
- points awarding
- voucher generation
- outbound RouterOS voucher sync
- MikroTik HotSpot user creation
- voucher confirmation back to Vercel

Still in QA:

- Google login can show `OAuthAccountNotLinked` for the tested account.
- MikroTik captive portal voucher entry can show `Web browser did not send challenge response`.
- Automatic phone `Sign in to network` notification is secondary; manual redirect through `http://neverssl.com` works.

Do not change the working voucher sync system while investigating these login
issues.

---

## Before Launch

1. Change the default admin password.

The seed script creates a default admin account. Log in and change that password
from the admin profile before real use.

2. Keep real secrets out of docs and screenshots.

Do not expose database URLs, router passwords, Google OAuth secrets, OAuth
tokens, provider account IDs, or `MIKROTIK_SYNC_KEY`.

3. Configure the Fibott Wi-Fi as open.

Users should not need a WPA/WPA2 Wi-Fi password to join the Fibott SSID.
Authentication is handled by the MikroTik captive portal voucher system.

4. Verify Walled Garden rules.

Unauthenticated users must be able to reach Fibott and Google sign-in pages.
Check the Walled Garden rules in `infra/mikrotik-setup.rsc`.

5. Use outbound RouterOS sync for production voucher delivery.

Outbound sync is the recommended path. It requires no public MikroTik REST API,
no TP-Link port forwarding, no static public IP, and no DDNS.

6. Confirm the `1hour` HotSpot user profile exists.

```routeros
/ip hotspot user profile print
```

If missing:

```routeros
/ip hotspot user profile add name=1hour session-timeout=1h shared-users=1
```

7. Verify the RouterOS sync scheduler is installed.

```routeros
/system script print
/system scheduler print
```

Look for:

```text
fibott-sync
fibott-sync-scheduler
```

8. Set up a verified email sender before relying on password reset.

If Resend is still using its sandbox sender, real users may not receive forgot
password emails.

9. Save device API keys.

The seed flow prints device API keys once. Store them somewhere private.

---

## Daily Operation

Keep the MikroTik online.

If the router loses internet, recycling can still award points. Vouchers may
remain `PENDING` until the router comes back online and polls
`/api/mikrotik/sync`.

Check these admin pages regularly:

| Page | What to check |
|---|---|
| Admin Dashboard | User count, vouchers issued, items recycled |
| Deposit History | Repeated rejected items, camera alignment, item type issues |
| Voucher Management | Vouchers stuck as `PENDING` or marked `FAILED` |
| Audit Logs | Reward/voucher configuration changes |
| System Logs | MikroTik sync or hardware errors |

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Google login shows `OAuthAccountNotLinked` | Auth/account-linking issue still under QA | Capture the exact time, browser/device, and visible error; do not delete user/account rows blindly |
| Google login hangs on the HotSpot | Walled Garden may be blocking Google/Fibott domains | Recheck Walled Garden rules for Fibott, Google, Google APIs, gstatic, and googleusercontent |
| Phone asks for Wi-Fi password | Fibott SSID is not open | Set the wireless security profile to no authentication |
| Voucher stays `PENDING` | Router sync script is not running or router is offline | Check `/system scheduler print` and router internet access |
| Voucher becomes `FAILED` and points refund | Direct REST auth/profile/validation issue | Check router credentials/profile if using direct REST; outbound sync should still be preferred for production |
| Voucher exists in MikroTik but captive portal rejects login with CHAP error | MikroTik HotSpot profile/login page CHAP configuration issue | Run the HotSpot diagnostic commands in [STATUS.md](STATUS.md) and inspect `login-by`, profile, and login page assets |
| `Sign in to network` notification does not appear | OS captive portal detection issue | Fix CHAP login first; then retest automatic detection |
| Password reset email never arrives | Email sender domain not verified | Verify the Resend sender domain or handle reset through admin support |

---

## Known Limitations

- Voucher status tracks app/router issuance, not whether a user actually typed
  the code at the captive portal.
- MikroTik HotSpot users are not automatically pruned after voucher expiration.
- The system is designed around one physical kiosk chute and one active deposit
  flow at a time.
- Direct REST remains in code as an optional fast path, but production operation
  should rely on outbound sync.
