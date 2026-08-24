# Push MikroTik environment variables to Vercel production.
#
# Prerequisites:
#   - infra/mikrotik-setup.rsc has been run on the router
#   - npm i -g vercel
#   - vercel login
#
# Fill in the values below, then run this script from the project root.

# Router host: Use the "dns-name" field from `/ip cloud print` on the router (e.g.
# abcd1234.sn.mynetname.net) or your router's public IP address.
$MIKROTIK_HOST             = "<router-dns-name>.sn.mynetname.net"

# Router credentials and profile
$MIKROTIK_USER             = "admin"
$MIKROTIK_PASSWORD         = "<router-admin-password>"
$MIKROTIK_HOTSPOT_PROFILE  = "1hour"
$MIKROTIK_PROTOCOL         = "https"
$MIKROTIK_PORT             = "443"
$MIKROTIK_INSECURE_TLS     = "true"
$MIKROTIK_SYNC_KEY         = "<random-64-character-sync-key>"

$env_pairs = @(
    @{ name = "MIKROTIK_HOST";             value = $MIKROTIK_HOST },
    @{ name = "MIKROTIK_USER";             value = $MIKROTIK_USER },
    @{ name = "MIKROTIK_PASSWORD";         value = $MIKROTIK_PASSWORD },
    @{ name = "MIKROTIK_HOTSPOT_PROFILE";  value = $MIKROTIK_HOTSPOT_PROFILE },
    @{ name = "MIKROTIK_PROTOCOL";         value = $MIKROTIK_PROTOCOL },
    @{ name = "MIKROTIK_PORT";             value = $MIKROTIK_PORT },
    @{ name = "MIKROTIK_INSECURE_TLS";     value = $MIKROTIK_INSECURE_TLS },
    @{ name = "MIKROTIK_SYNC_KEY";         value = $MIKROTIK_SYNC_KEY }
)

foreach ($pair in $env_pairs) {
    Write-Host "Setting $($pair.name)..."
    $pair.value | vercel env add $pair.name production
}

Write-Host ""
Write-Host "Done. Redeploy Vercel to pick up the new env vars:"
Write-Host "  vercel --prod"
