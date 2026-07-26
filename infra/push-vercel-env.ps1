# Push MikroTik env vars to Vercel production.
# Run AFTER setting up the Cloudflare Tunnel and getting its public URL.
#
# Prerequisites:
#   npm i -g vercel
#   vercel login
#
# Fill in the values below, then run this script from the project root.

# Cloudflare Tunnel URL pointing to the bridge (localhost:3001 on your LAN machine).
# Replace with the permanent tunnel hostname from: cloudflared tunnel create fibott-mikrotik
$BRIDGE_URL    = "<your-tunnel-id>.cfargotunnel.com"

# Shared bearer secret between Vercel and the bridge.
# Generate a strong random value: openssl rand -hex 32
$BRIDGE_SECRET = "<your-bridge-secret>"

$env_pairs = @(
    @{ name = "BRIDGE_URL";    value = "https://$BRIDGE_URL" },
    @{ name = "BRIDGE_SECRET"; value = $BRIDGE_SECRET }
)

foreach ($pair in $env_pairs) {
    Write-Host "Setting $($pair.name)..."
    $pair.value | vercel env add $pair.name production
}

Write-Host ""
Write-Host "Done. Redeploy Vercel to pick up the new vars:"
Write-Host "  vercel --prod"
