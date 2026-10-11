# Fibott System Status and Handoff

**Last updated:** 2026-10-11
**Release reference:** `origin/main` at `83d2a72` (`Improve two-class kiosk vision model`)

Reference: [SYSTEM.md](SYSTEM.md) | Operator guide: [CLIENT-GUIDE.md](CLIENT-GUIDE.md)

## Current status

| Area | Status | Evidence / limitation |
|---|---|---|
| Next.js static checks | Passed | `npm run lint` and `npx tsc --noEmit` pass. A production build produced `.next/BUILD_ID`. |
| Web/API wiring | Statically reviewed | The kiosk session, device intake, points, voucher, and RouterOS sync routes are present. This is not a live integration test. |
| Two-class model artifact | Integrated | The current ESP32 artifact is a 96x96 INT8 MobileNetV1 with PET bottle and aluminum can outputs. Its recorded grouped holdout accuracy is 81.25%; PET recall is 64.71%. |
| Vision reject behavior | Blocked | Successful inferences are always marked confident and open the gate. Confidence/margin thresholds and hand/paper/empty-chute filter settings are not applied by the current vision loop. |
| ESP-NOW actuator path | Bench test required | Firmware contains the transmitter/receiver protocol, but no hardware flash, channel-match, or servo test was performed for this release. |
| Deposit/points integrity | Needs remediation | The processor does not enforce that the submitting device owns the claimed session, and completion is not conditional on `ACTIVE`, so retries/concurrency can create duplicate awards. |
| MikroTik outbound sync | Blocked | The route currently allows requests if `MIKROTIK_SYNC_KEY` is absent. The local environment files do not define it. The key must be set, the tracked RouterOS key rotated, and a router test completed before enablement. |
| Direct MikroTik REST | Not run | `npm run test:mikrotik` creates a real HotSpot user and was intentionally not run. |
| Production deployment | Not verified | Repository checks cannot confirm Vercel environment values, Neon connectivity, or a deployed site's behavior. |
| Documentation | Updated | Architecture, limits, model state, and validation boundaries are documented as of this revision. |

## End-to-end flow

```text
User starts 3-minute session
  -> ESP32-CAM polls and atomically claims an unassigned session
  -> camera captures a frame and runs two-class TinyML inference
  -> current firmware sends ESP-NOW CMD:OPEN for every successful inference
  -> firmware uploads frame + local classification to /api/device/deposit-image
  -> API records the deposit and awards points
  -> user redeems points for a voucher
  -> direct RouterOS REST, or authenticated outbound RouterOS sync, issues HotSpot access
```

The web-to-database route is connected in code. The physical, database, deployment, and router portions of this flow still require a controlled end-to-end test.

## Required work before a public demo

1. Implement and hardware-test a real reject path before gate actuation.
2. Require a configured `MIKROTIK_SYNC_KEY`, rotate the key currently present in the RouterOS script, and send it in a header rather than a query string.
3. Make deposit completion device-owned and idempotent, using a conditional session update or a database constraint.
4. Flash both ESP32s, verify their Wi-Fi channel and ESP-NOW commands, and test accepted and rejected objects with the production backend.
5. Verify Vercel/Neon environment configuration and redeem a disposable real voucher; clean it up afterwards.
