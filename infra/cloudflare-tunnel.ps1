# Fibott — Cloudflare Tunnel setup (Windows PowerShell)
# Run this script on any machine that stays on your LAN (dev PC is fine for now).
# Prerequisites: winget available (Windows 10/11)

# ── Step 1: Install cloudflared ───────────────────────────────────────────────
winget install Cloudflare.cloudflared
# Restart your terminal after install so cloudflared is on PATH.

# ── Step 2: Log in to Cloudflare (opens browser) ─────────────────────────────
cloudflared tunnel login

# ── Step 3: Create a named tunnel ────────────────────────────────────────────
cloudflared tunnel create fibott-mikrotik
# This prints a Tunnel ID (UUID). Note it — you'll see it in the config below.

# ── Step 4: Write the tunnel config ──────────────────────────────────────────
# cloudflared looks for config at %USERPROFILE%\.cloudflared\config.yml
# Create that file with the content below (replace <TUNNEL-ID> with your UUID):
#
# tunnel: <TUNNEL-ID>
# credentials-file: C:\Users\<YOU>\.cloudflared\<TUNNEL-ID>.json
# ingress:
#   - service: http://192.168.88.1
#
# The config file is at: infra\cloudflared-config.yml (edit and copy it there)

# ── Step 5: Run the tunnel ────────────────────────────────────────────────────
cloudflared tunnel run fibott-mikrotik
# The terminal will print your public URL:
#   https://<tunnel-id>.cfargotunnel.com
# Copy that URL — it becomes MIKROTIK_HOST in Vercel.

# ── Step 6: Install as a Windows service (auto-starts with Windows) ───────────
# Run this in an elevated (Administrator) terminal:
cloudflared service install
# Then start it:
Start-Service cloudflared
