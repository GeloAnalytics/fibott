# Push MikroTik env vars to Vercel production.
# Run AFTER setting up the ngrok tunnel and reserving your static domain.
#
# Prerequisites:
#   npm i -g vercel
#   vercel login
#
# Fill in the values below, then run this script from the project root.

# ngrok static domain pointing to the bridge (localhost:3001 on your LAN machine).
# Reserve one at https://dashboard.ngrok.com (free tier includes one static domain).
$BRIDGE_URL    = "https://cushy-tapeless-dividable.ngrok-free.app"

# Shared bearer secret between Vercel and the bridge.
# Generate a strong random value: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$BRIDGE_SECRET = "<your-bridge-secret>"

$env_pairs = @(
    @{ name = "BRIDGE_URL";    value = $BRIDGE_URL },
    @{ name = "BRIDGE_SECRET"; value = $BRIDGE_SECRET }
)

foreach ($pair in $env_pairs) {
    Write-Host "Setting $($pair.name)..."
    $pair.value | vercel env add $pair.name production
}

Write-Host ""
Write-Host "Done. Redeploy Vercel to pick up the new vars:"
Write-Host "  vercel --prod"
