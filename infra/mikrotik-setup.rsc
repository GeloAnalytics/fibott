# Fibott MikroTik Setup Script
# Paste these commands one section at a time into a RouterOS terminal
# (Winbox terminal, SSH, or WebFig terminal)

# ── 1. Confirm the REST API (www) service is enabled ─────────────────────────
# Run this first and check that www shows disabled=no
/ip/service/print

# If www is disabled, enable it:
# /ip/service/set www disabled=no

# ── 2. Create a restricted API user ──────────────────────────────────────────
# Replace <STRONG-PASSWORD> with a real password (save it — you'll need it for Vercel)
/user/add name=fibott-api password=<STRONG-PASSWORD> group=write

# Confirm it was created:
/user/print where name=fibott-api

# KNOWN ISSUE (see docs/STATUS.md): this account has previously hit REST
# permission errors on this project. Accepted for now — this deployment uses
# MIKROTIK_USER=admin (including for section 6, direct internet exposure)
# rather than block launch on it. Fix when there's time; not required to ship.
#
# To fix later: if step 5 fails with a permission/403-style error for
# fibott-api but works for admin, the "write" group is missing a policy REST
# needs. Diagnose:
/user/group/print detail where name=write
/user/group/print detail where name=full
# Compare the "policy=" list on both. If "write" is missing something "full"
# has (commonly api / rest-api / policy), add it without removing the rest:
# /user/group/set write policy=<existing-list-from-above>,api,rest-api
# Re-run the step 5 curl test with fibott-api after each change.

# ── 3. Create the 1-hour hotspot profile ─────────────────────────────────────
/ip/hotspot/user/profile/add name=1hour session-timeout=1h shared-users=1

# Confirm:
/ip/hotspot/user/profile/print where name=1hour

# ── 4. (Optional) Create future profiles for later ───────────────────────────
# /ip/hotspot/user/profile/add name=3hour session-timeout=3h shared-users=1
# /ip/hotspot/user/profile/add name=1day  session-timeout=24h shared-users=1

# ── 5. Quick test — create a dummy hotspot user via REST API ──────────────────
# Run this from any machine on the same LAN to verify the REST API works
# before setting up the tunnel:
#
# curl -u fibott-api:<STRONG-PASSWORD> \
#   -X PUT http://192.168.88.1/rest/ip/hotspot/user \
#   -H "Content-Type: application/json" \
#   -d '{"name":"TEST-001","password":"TEST-001","profile":"1hour"}'
#
# Expected response: {"name":"TEST-001", ... }
# Then clean up: /ip/hotspot/user/remove [find name=TEST-001]

# ── 6. Direct internet exposure (no bridge, no domain needed) ────────────────
# Only run this section if Vercel will call this router directly instead of
# going through infra/bridge — see docs/SYSTEM.md "Direct exposure" section.
#
# This does three things: gives the router a stable free hostname (works even
# on a dynamic/changing public IP, no domain purchase required), forces the
# REST API onto HTTPS only, and firewalls the WAN side down to just that one
# port — Winbox/API/SSH/FTP/Telnet stay unreachable from the internet no
# matter what.

# 6a. Free DDNS hostname tied to this router's serial number (MikroTik IP Cloud).
# Works on any RouterOS device, no account/domain needed. Re-run `print` any
# time — including on a different physical router — to get its hostname.
/ip cloud set ddns-enabled=yes
/ip cloud print
# Note the "dns-name" field, e.g. abcd1234.sn.mynetname.net — this is what
# you'll put in MIKROTIK_HOST on Vercel.

# 6b. HTTPS-only REST API. Self-signed by default — Vercel-side code already
# supports this via MIKROTIK_INSECURE_TLS=true, so a paid/trusted cert is not
# required to get started.
/ip service set www disabled=yes
/ip service set www-ssl disabled=no port=443

# 6c. Firewall: allow the REST API in from WAN, drop every other WAN-facing
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

# 6d. Which user to expose. Using admin for now (accepted risk, see step 2's
# note and docs/STATUS.md) — switch to fibott-api once its REST permissions
# are sorted out, no other change needed since it's just an env var swap.
#
# Password check: whichever account ends up exposed here is about to be
# reachable from the whole internet over HTTP Basic Auth — make sure its
# password is a long random string, not something memorable. Regenerate if needed:
# /user/set admin password=<NEW-STRONG-RANDOM-PASSWORD>

# 6e. If this router is NOT the one holding the public IP (i.e. it sits behind
# another ISP router/modem doing NAT), steps 6a-6d still apply here, but you
# additionally need a port-forward rule on that OTHER device: WAN port 443 →
# this router's LAN IP (192.168.88.1) port 443. That has to be done in the
# other device's own admin panel — there's no MikroTik command for it since
# it's not this router. Check /ip address print on this router (WAN interface)
# against https://whatismyip.com from a device on this LAN: same IP means this
# router already has the public IP directly and 6e doesn't apply.
