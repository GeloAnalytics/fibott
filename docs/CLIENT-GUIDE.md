# Fibott Operator Guide

**Last updated:** 2026-08-24

This is the plain-language guide for operating Fibott. For technical details, see [SYSTEM.md](SYSTEM.md). For QA status, see [STATUS.md](STATUS.md).

---

## How Fibott Works

1. A user opens `https://fibott.vercel.app`, logs in, and starts a recycling session.
2. The user drops a bottle or can into the kiosk chute within the session window.
3. The ESP32-CAM captures or reports the item to the app.
4. Accepted items add points to the user's wallet.
5. The user redeems points for a Wi-Fi voucher.
6. The MikroTik router creates a matching HotSpot user through outbound sync.
7. The user enters the voucher code as both Username and Password on the HotSpot login page.

---

## Before Demo Checklist

1. Confirm the production site opens: `https://fibott.vercel.app`.
2. Confirm normal email/password login works.
3. Confirm Google login works from the same browser/device you will use during the demo.
4. Confirm the Fibott Wi-Fi network is open and does not ask for a Wi-Fi password.
5. Confirm RouterOS has the `1hour` HotSpot user profile.
6. Confirm the `fibott-sync` RouterOS scheduler is enabled.
7. Confirm the ESP32-CAM is powered on and can reach the production app.
8. Run one real deposit test and confirm points increase.
9. Redeem one small voucher and confirm it becomes usable on the HotSpot login page.

---

## Admin Password Reset

Use this when a user forgets their password and the admin needs to set a temporary replacement.

1. Log in as an admin.
2. Open the admin user management page.
3. Choose the user.
4. Use the reset password action.
5. Give the generated temporary password to the user privately.
6. Ask the user to log in and change it if a change-password flow is available.

The reset action is admin-only and writes an audit log.

---

## Voucher Redemption Instructions for Users

1. Open the wallet page.
2. Redeem enough points for a voucher.
3. Tap **Use Voucher**.
4. Connect to the `Fibott` Wi-Fi network if not already connected.
5. On `http://192.168.88.1/login`, paste the voucher code into both Username and Password.
6. Tap Login.

---

## Router Checks

Run these in WinBox or RouterOS terminal:

```routeros
/ip hotspot profile print detail
/ip hotspot print detail
/ip hotspot user profile print detail where name=1hour
/system scheduler print detail where name=fibott-sync
/system script print detail where name=fibott-sync
```

If vouchers stay pending for more than 30 seconds, check that the router is online and the `fibott-sync` scheduler is running.

If the HotSpot page says the browser did not send a challenge response, check the HotSpot profile login methods and make sure the generated login page matches the router's CHAP/PAP settings.

---

## Cleanup Test Vouchers

RouterOS keeps generated HotSpot users. To remove Fibott test users:

```routeros
/ip hotspot user remove [find comment~"FBT-"]
```
