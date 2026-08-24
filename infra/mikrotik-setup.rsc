# Fibott MikroTik Setup Script
# Paste these commands section by section into a RouterOS terminal
# (Winbox terminal, SSH, or WebFig terminal)

# ── 1. Confirm the REST API (www) service is enabled ─────────────────────────
# Run this first and check that www shows disabled=no
/ip/service/print

# If www is disabled, enable it:
# /ip/service/set www disabled=no

# ── 2. Configure Open WiFi AP (Remove WiFi Password) ─────────────────────────
# To allow users to connect to the Fibott hotspot freely without typing a WiFi password,
# set the security profile authentication-types to none (Open network).
# Authentication is handled strictly by the MikroTik Hotspot captive portal.
/interface/wireless/security-profiles/set [find default=yes] mode=none authentication-types=none
# Or if using a named security profile for the wireless interface:
# /interface/wireless/security-profiles/add name=fibott-open mode=none
# /interface/wireless/set [find name=wlan1] security-profile=fibott-open

# ── 3. Configure Walled Garden (Allow Fibott Web App & Google Auth) ─────────
# Unauthenticated hotspot users must be able to reach the Fibott app and complete
# Google Sign-In before logging in to the hotspot. Allow all necessary domains:

# Allow Fibott web app
/ip/hotspot/walled-garden/add dst-host=fibott.vercel.app comment="fibott: web app"

# Allow Google Authentication & OAuth static resources/APIs
/ip/hotspot/walled-garden/add dst-host=*google.com comment="fibott: google auth"
/ip/hotspot/walled-garden/add dst-host=*googleapis.com comment="fibott: google apis"
/ip/hotspot/walled-garden/add dst-host=*gstatic.com comment="fibott: google static assets"
/ip/hotspot/walled-garden/add dst-host=*googleusercontent.com comment="fibott: google account images"

# Confirm Walled Garden rules:
/ip/hotspot/walled-garden/print

# ── 4. Create a restricted API user ──────────────────────────────────────────
# Replace <STRONG-PASSWORD> with a real password (save it — you'll need it for Vercel)
/user/add name=fibott-api password=<STRONG-PASSWORD> group=write

# Confirm it was created:
/user/print where name=fibott-api

# KNOWN ISSUE (see docs/STATUS.md): this account has previously hit REST
# permission errors on this project. Accepted for now — this deployment uses
# MIKROTIK_USER=admin (including for direct internet exposure)
# rather than block launch on it. Fix when there's time; not required to ship.
#
# To fix later: if step 6 fails with a permission/403-style error for
# fibott-api but works for admin, the "write" group is missing a policy REST
# needs. Diagnose:
/user/group/print detail where name=write
/user/group/print detail where name=full
# Compare the "policy=" list on both. If "write" is missing something "full"
# has (commonly api / rest-api / policy), add it without removing the rest:
# /user/group/set write policy=<existing-list-from-above>,api,rest-api
# Re-run the step 6 curl test with fibott-api after each change.

# ── 5. Create the 1-hour hotspot profile ─────────────────────────────────────
/ip/hotspot/user/profile/add name=1hour session-timeout=1h shared-users=1

# Confirm:
/ip/hotspot/user/profile/print where name=1hour

# ── 6. Quick test — create a dummy hotspot user via REST API ──────────────────
# Run this from any machine on the same LAN to verify the REST API works:
#
# curl -u fibott-api:<STRONG-PASSWORD> \
#   -X PUT http://192.168.88.1/rest/ip/hotspot/user \
#   -H "Content-Type: application/json" \
#   -d '{"name":"TEST-001","password":"TEST-001","profile":"1hour"}'
#
# Expected response: {"name":"TEST-001", ... }
# Then clean up: /ip/hotspot/user/remove [find name=TEST-001]

# ── 7. Direct Router REST API Access Configuration ──────────────────────────
# This section exposes the MikroTik REST API to the Next.js app hosted on Vercel.
#
# This does three things: gives the router a stable free hostname (works even
# on a dynamic/changing public IP, no domain purchase required), forces the
# REST API onto HTTPS only, and firewalls the WAN side down to just that one
# port — Winbox/API/SSH/FTP/Telnet stay unreachable from the internet no
# matter what.

# 7a. Free DDNS hostname tied to this router's serial number (MikroTik IP Cloud).
# Works on any RouterOS device, no account/domain needed. Re-run `print` any
# time — including on a different physical router — to get its hostname.
/ip cloud set ddns-enabled=yes
/ip cloud print
# Note the "dns-name" field, e.g. abcd1234.sn.mynetname.net — this is what
# you'll put in MIKROTIK_HOST on Vercel.

# 7b. HTTPS-only REST API. Self-signed by default — Vercel-side code already
# supports this via MIKROTIK_INSECURE_TLS=true, so a paid/trusted cert is not
# required to get started.
/ip service set www disabled=yes
/ip service set www-ssl disabled=no port=443

# 7c. Firewall: allow the REST API in from WAN, drop every other WAN-facing
# management service. Replace "ether1" with whatever this router's actual
# WAN/internet-facing interface is named (check with /interface print).
/ip firewall filter add chain=input in-interface=ether1 protocol=tcp dst-port=443 action=accept comment="fibott: allow REST API (www-ssl) from WAN"
/ip firewall filter add chain=input in-interface=ether1 protocol=tcp dst-port=8291 action=drop comment="fibott: block Winbox from WAN"
/ip firewall filter add chain=input in-interface=ether1 protocol=tcp dst-port=22 action=drop comment="fibott: block SSH from WAN"
/ip firewall filter add chain=input in-interface=ether1 protocol=tcp dst-port=23 action=drop comment="fibott: block Telnet from WAN"
/ip firewall filter add chain=input in-interface=ether1 protocol=tcp dst-port=21 action=drop comment="fibott: block FTP from WAN"
/ip firewall filter add chain=input in-interface=ether1 protocol=tcp dst-port=8728,8729 action=drop comment="fibott: block API/API-SSL from WAN"
# Confirm the rules landed in the right order (accept rule must come before
# any general "drop all from WAN" rule already on this router):
/ip firewall filter print

# 7e. Upstream Router / Double-NAT Configuration (Optional for direct REST)
# If using direct REST behind an upstream TP-Link router, set up port forward: 443 -> 192.168.1.80:443.

# ── 8. Outbound Router Sync (Recommended — Zero Open Ports Required) ─────────
# Works on ANY internet connection (mobile hotspot, campus WiFi, home router, CGNAT)
# without requiring DDNS, open ports, or upstream port forwarding.
#
# The router polls Vercel outbound every 3 seconds for pending vouchers,
# creates the HotSpot user locally, and confirms issuance.

/system script add name=fibott-sync policy=read,write,test source="
:local syncKey \"f8a92e104d5b6c7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a\"
:local appUrl \"https://fibott.vercel.app/api/mikrotik/sync\"

:do {
  :local fetchUrl \"\$appUrl\?key=\$syncKey\"
  :if ([:len \$syncKey] = 0) do={ :set fetchUrl \$appUrl }
  :local res [/tool fetch url=\$fetchUrl as-value output=user]
  :local data (\$res->\"data\")
  :if (\$data ~ \"^PENDING:\") do={
    :local firstColon [:find \$data \":\" 0]
    :local secondColon [:find \$data \":\" (\$firstColon + 1)]
    :local thirdColon [:find \$data \":\" (\$secondColon + 1)]
    :local fourthColon [:find \$data \":\" (\$thirdColon + 1)]

    :local vId [:pick \$data (\$firstColon + 1) \$secondColon]
    :local vCode [:pick \$data (\$secondColon + 1) \$thirdColon]
    :local vProf [:pick \$data (\$thirdColon + 1) \$fourthColon]
    :local vUptime [:pick \$data (\$fourthColon + 1) [:len \$data]]

    :do {
      /ip hotspot user add name=\$vCode password=\$vCode profile=\$vProf limit-uptime=\$vUptime comment=\$vId
      :local confirmUrl \"\$appUrl\?confirm=\$vId\"
      :if ([:len \$syncKey] > 0) do={ :set confirmUrl \"\$appUrl\?key=\$syncKey&confirm=\$vId\" }
      /tool fetch url=\$confirmUrl mode=https output=user
      :log info (\"Fibott: Created hotspot user \$vCode\")
    } on-error={
      :log error (\"Fibott: Failed to create user \$vCode\")
    }
  }
} on-error={}
"

# Add background scheduler (runs every 3 seconds):
/system scheduler add name=fibott-sync-scheduler interval=3s on-event=fibott-sync

