# Fibott — ngrok Tunnel setup (Windows PowerShell)
# Run this ONCE on the LAN machine that will run the bridge service.
# Prerequisites: Node.js installed, project dependencies installed (npm install)
#
# NOTE: the static domain below is already reserved (cushy-tapeless-dividable.ngrok-free.app).
# Only steps 1-2 are needed to bring a NEW machine online with the existing domain — skip
# straight to Step 6 if you're just restarting the bridge on a machine already set up.

# ── Step 1: Install ngrok ─────────────────────────────────────────────────────
winget install ngrok.ngrok
# Close and reopen your terminal after install so ngrok is on PATH.

# ── Step 2: Create a free account ────────────────────────────────────────────
# Visit https://ngrok.com and sign up (email only, no credit card).
# After confirming your email, go to your dashboard and copy your authtoken.

# ── Step 3: Add the authtoken to this machine (one-time per machine) ─────────
# Replace <YOUR-AUTHTOKEN> with the token from Step 2.
ngrok config add-authtoken <YOUR-AUTHTOKEN>

# ── Step 4: Reserve a static domain (one-time, only if starting fresh) ───────
# Free tier includes one static domain. Reserve it from the ngrok dashboard
# (Domains → New Domain), or via:
#   ngrok http --domain=<your-reserved-domain> 3001
# Already reserved for this project: cushy-tapeless-dividable.ngrok-free.app
# Save the domain — you will need it in Steps 5 and 6.

# ── Step 5: Push env vars to Vercel (one-time) ───────────────────────────────
# Edit infra/push-vercel-env.ps1:
#   Set $BRIDGE_URL    to https://cushy-tapeless-dividable.ngrok-free.app
#   Set $BRIDGE_SECRET to a random secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Then run:
#   npm i -g vercel
#   vercel login
#   .\infra\push-vercel-env.ps1
# Redeploy to pick up the new vars:
#   vercel --prod

# ── Step 6: Daily operation — start bridge + tunnel ──────────────────────────
# infra/start-bridge.ps1 already has the domain hardcoded. Just run:
#   .\infra\start-bridge.ps1

# ── Step 7 (optional): Auto-start on Windows boot ────────────────────────────
# Open Task Scheduler → Create Basic Task
#   Trigger:  At startup (or At log on)
#   Action:   Start a program
#   Program:  powershell.exe
#   Arguments: -WindowStyle Hidden -File "C:\path\to\Fibott\infra\start-bridge.ps1"
# This keeps the bridge and tunnel running without manual intervention.
