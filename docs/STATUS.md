# Fibott - Status & Next Steps

**Last updated:** 2026-08-24

Reference: [SYSTEM.md](SYSTEM.md) | Operator guide: [CLIENT-GUIDE.md](CLIENT-GUIDE.md)

This document is the current QA source of truth. It reflects the repo state and
the latest handoff: the app is close to final, voucher generation/sync is
working, and two login-related issues remain under investigation.

---

## Current State

| Area | Status | Notes |
|---|---|---|
| Next.js app | Working | App Router, API routes, dashboard, wallet, admin pages |
| Auth | In QA | Credentials + Google configured; Google provider is live in production |
| Database | Working | Prisma + Neon Serverless Postgres |
| Deposit flow | Working | Mobile session starts, ESP32-CAM polls, accepted deposits award points |
| Voucher redeem flow | Working | Deducts points, creates voucher, displays code immediately |
| Direct MikroTik REST | Implemented | Optional fast path when the router is reachable from the app |
| Outbound RouterOS sync | Working / frozen | Router polls `/api/mikrotik/sync`, creates HotSpot user, confirms `ISSUED` |
| MikroTik HotSpot user creation | Working | Verified through outbound sync |
| MikroTik captive portal login | Open issue | Voucher entry reaches CHAP challenge-response failure |
| Captive portal notification | Secondary issue | Manual redirect via `http://neverssl.com` works |
| TypeScript | Clean | `npx tsc --noEmit` passes |
| ESLint | Clean | `npm run lint` passes after ignoring local tool cache folders |
| Production build | Clean | `npm run build` passes and generates 42 routes |

---

## Latest Repo Verification

Completed on 2026-08-24:

- `npx tsc --noEmit` passed.
- `npm run lint` passed.
- `npm run build` passed.
- Production `https://fibott.vercel.app/api/auth/providers` returned both `credentials` and `google`.
- Sanitized database check for `urrizaangelo0719@gmail.com` found:
  - user exists
  - user is active
  - email is verified
  - Google `Account` rows point to the same user ID

No OAuth access tokens, refresh tokens, ID tokens, or provider account IDs were
printed or copied during the check.

---

## Priority 1 - Google OAuth QA

Observed issue:

```text
OAuthAccountNotLinked
```

Tested account:

```text
urrizaangelo0719@gmail.com
```

Repo facts:

- `src/lib/auth.ts` uses `PrismaAdapter(prisma)`.
- The Google provider is configured.
- `allowDangerousEmailAccountLinking: true` is present.
- Production advertises the Google provider.
- The sanitized DB relationship check did not show a missing user/account link.

Next action:

- Reproduce the Google login error in production and capture the exact time,
  browser/device, and visible error.
- If the issue still happens, inspect production auth logs around that timestamp.
- Do not delete the user or Google account rows until logs show a specific bad row
  or provider mismatch.
- Do not expose OAuth tokens or `providerAccountId`.

---

## Priority 2 - MikroTik HotSpot CHAP Login

Observed issue after entering a generated voucher on the MikroTik login page:

```text
Web browser did not send challenge response (try again, enable JavaScript)
```

Known working:

- Wi-Fi association
- HotSpot interception
- Manual redirect via `http://neverssl.com`
- Voucher generation
- Pending queue
- Outbound RouterOS sync
- HotSpot user creation
- Vercel confirmation to `ISSUED`

Interpretation:

The issue is likely in MikroTik HotSpot authentication/profile/login page
configuration, not in the Fibott voucher generation or sync path.

Router-side diagnostic needed:

```routeros
/ip hotspot profile print detail
/ip hotspot print detail
/ip hotspot user profile print detail where name=1hour
```

Inspect:

- `login-by`
- CHAP-related settings
- selected HotSpot profile
- login HTML/template behavior
- whether the browser receives the JavaScript challenge-response assets

Do not change the working outbound sync while investigating this.

---

## Priority 3 - Captive Portal Notification

Observed issue:

```text
Sign in to network
```

does not appear automatically on the phone.

This is secondary because manual captive portal redirect works:

```text
Connect to Fibott Wi-Fi -> open http://neverssl.com -> redirected to MikroTik HotSpot
```

Fix CHAP login first. Then retest Android/iOS captive portal detection.

---

## Frozen / Working Voucher Architecture

Production should use outbound RouterOS polling as the reliable path:

```text
MikroTik
  -> outbound HTTPS poll
  -> Vercel /api/mikrotik/sync
  -> PENDING voucher
  -> MikroTik creates HotSpot user
  -> Vercel confirmation
  -> ISSUED
```

This does not require:

- TP-Link port forwarding
- inbound MikroTik TCP 443
- static public IP
- DDNS
- public RouterOS REST API exposure
- tunnel/bridge infrastructure

The code still supports direct REST as an optional fast path. If direct REST
fails due to network reachability, the voucher is queued for outbound sync.

---

## Security Notes

- Keep `MIKROTIK_SYNC_KEY` only in environment variables and the private RouterOS
  script actually installed on the router.
- Do not paste real sync keys, database URLs, router passwords, Google secrets,
  OAuth tokens, refresh tokens, ID tokens, or provider account IDs into docs,
  issues, screenshots, or chat.
- If a real sync key was shared in committed docs or a public repository, rotate
  it in Vercel and on the MikroTik router.

---

## Deferred

- `fibott-api` restricted REST permissions; direct REST currently depends on the configured router account.
- Voucher usage tracking after a user enters the code on the captive portal.
- Automatic MikroTik HotSpot user cleanup after voucher expiration.
- Captive portal notification tuning after CHAP login works.
