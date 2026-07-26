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
