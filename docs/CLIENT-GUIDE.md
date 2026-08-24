# Fibott — Operator's Guide

**Last updated:** 2026-08-24 (100% Verified)

This is the plain-language guide for running Fibott day to day. For technical engineering reference, see [SYSTEM.md](SYSTEM.md). For system status, see [STATUS.md](STATUS.md).

---

## 1. How Fibott Works

1. A user opens the Fibott web app (`https://fibott.vercel.app`), logs in, and taps **Start Recycling**.
2. The user drops a bottle or can into the kiosk chute within 5 minutes.
3. The camera captures the item, the ML classifier checks it, and points are awarded immediately to the user's wallet.
4. The user redeems points for a Wi-Fi voucher (`FBT-XXXX-XXXX-XXXX`).
5. The user taps **Use Voucher** on their phone to copy the code and open the Wi-Fi login page (`http://192.168.88.1/login`), then pastes the voucher code to connect.

---

## 2. Before Launch Checklist

1. **Change the default admin password**:
   Log into `admin@fibott.local` (default: `Admin12345!`) and update the password under Admin → Profile.

2. **Configure Open Wi-Fi Network**:
   Ensure the "Fibott" SSID security profile is set to **Open** (`authentication-types=none`). Network access is managed by the captive portal voucher system.

3. **Verify Walled Garden Rules**:
   Ensure unauthenticated users can access `fibott.vercel.app` and Google sign-in subdomains (`*google.com`, `*googleapis.com`, `*gstatic.com`, `*googleusercontent.com`).

4. **Verify Outbound RouterOS Sync Script**:
   Paste `infra/fibott-sync.rsc` into the RouterOS terminal to install the `fibott-sync` script and background scheduler (`interval=3s`).

5. **Confirm `1hour` HotSpot Profile Exists**:
   Run `/ip hotspot user profile print` in RouterOS. If missing, create it:
   ```routeros
   /ip hotspot user profile add name=1hour session-timeout=1h shared-users=1
   ```

---

## 3. Daily / Weekly Operation

- **Keep the MikroTik Router Online**: If the router temporarily loses internet, points recycling still works. Vouchers redeemed during an offline period will sit in `PENDING` status and automatically activate (`ISSUED`) the moment the router reconnects and polls Vercel.
- **Check Admin Pages Regularly**:
  - **Admin Dashboard**: Total users, active users, total recycled items, vouchers issued.
  - **Deposit History**: Overview of accepted/rejected recycling scans.
  - **System Logs**: Real-time hardware and backend diagnostic logs formatted in Philippines Time (Asia/Manila GMT+8).
  - **Voucher Management**: Status of all generated vouchers.

---

## 4. Voucher Redemption & Claiming Instructions for Users

When a user redeems points:
1. They receive a 12-character voucher code (e.g. `FBT-AB3C-D4EF-GH5J`).
2. They tap **Use Voucher (Connect to Wi-Fi)**.
3. The app copies the code automatically and opens `http://192.168.88.1/login`.
4. They paste `FBT-AB3C-D4EF-GH5J` into **both** Username and Password fields and tap **Login**.

---

## 5. Troubleshooting Guide

| Symptom | Likely Cause | Solution |
|---|---|---|
| Phone prompts for a Wi-Fi password when joining "Fibott" | Security profile has WPA2 enabled | Run `/interface/wireless/security-profiles/set [find default=yes] mode=none authentication-types=none` on router |
| Voucher remains `PENDING` for >30 seconds | Router sync script is not installed or router is offline | SSH or Winbox into router and check `/system scheduler print`. Run `infra/fibott-sync.rsc` if missing |
| Captive portal page doesn't open automatically | OS captive portal detection bypassed | Tap **Use Voucher** in the web app or open `http://192.168.88.1/login` directly in browser |
| Google login fails or hangs on HotSpot | Walled Garden domain blocked | Verify wildcard Walled Garden rules in `infra/mikrotik-setup.rsc` are applied |

---

## 6. Operational Notes

- **One Kiosk Chute**: The recycling session API enforces 1 active session system-wide at a time, matching the single physical hardware chute.
- **Manual Voucher Removal**: RouterOS retains generated hotspot users. To clean up old test users from the router table, run:
  ```routeros
  /ip hotspot user remove [find comment~"FBT-"]
  ```
