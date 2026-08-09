# Push MikroTik env vars to Vercel production — DIRECT EXPOSURE mode.
# Use this instead of push-vercel-env.ps1 when Vercel calls the router
# directly (no infra/bridge, no tunnel) — see docs/SYSTEM.md "Direct exposure".
#
# Prerequisites:
#   - infra/mikrotik-setup.rsc section 6 has been run on the router
#   - npm i -g vercel
#   - vercel login
#
# Fill in the values below, then run this script from the project root.

# From `/ip cloud print` on the router (the "dns-name" field), e.g.
# abcd1234.sn.mynetname.net — NOT an IP address, so it keeps working even if
# the router's public IP changes, and works without owning a domain.
$MIKROTIK_HOST = "<router-dns-name>.sn.mynetname.net"

# Using admin for now — fibott-api has a known unresolved REST permission
# issue (mikrotik-setup.rsc step 2's "KNOWN ISSUE" note / docs/STATUS.md).
# Accepted risk for this deployment rather than a launch blocker; swap to
# fibott-api later by changing this one value once that's fixed.
$MIKROTIK_USER             = "admin"
$MIKROTIK_PASSWORD         = "<router-admin-password>"
$MIKROTIK_HOTSPOT_PROFILE  = "1hour"
$MIKROTIK_PROTOCOL         = "https"
$MIKROTIK_PORT             = "443"
# Self-signed cert on the router by default — leave "true" unless you've
# issued a trusted cert for the IP Cloud hostname.
$MIKROTIK_INSECURE_TLS     = "true"

$env_pairs = @(
    @{ name = "MIKROTIK_HOST";             value = $MIKROTIK_HOST },
    @{ name = "MIKROTIK_USER";             value = $MIKROTIK_USER },
    @{ name = "MIKROTIK_PASSWORD";         value = $MIKROTIK_PASSWORD },
    @{ name = "MIKROTIK_HOTSPOT_PROFILE";  value = $MIKROTIK_HOTSPOT_PROFILE },
    @{ name = "MIKROTIK_PROTOCOL";         value = $MIKROTIK_PROTOCOL },
    @{ name = "MIKROTIK_PORT";             value = $MIKROTIK_PORT },
    @{ name = "MIKROTIK_INSECURE_TLS";     value = $MIKROTIK_INSECURE_TLS }
)

foreach ($pair in $env_pairs) {
    Write-Host "Setting $($pair.name)..."
    $pair.value | vercel env add $pair.name production
}

Write-Host ""
Write-Host "IMPORTANT: also remove BRIDGE_URL / BRIDGE_SECRET from Vercel production env"
Write-Host "if they're set from a previous ngrok/bridge setup — getMikrotikClient() prefers"
Write-Host "the bridge whenever both BRIDGE_URL and BRIDGE_SECRET are present."
Write-Host "  vercel env rm BRIDGE_URL production"
Write-Host "  vercel env rm BRIDGE_SECRET production"
Write-Host ""
Write-Host "Done. Redeploy Vercel to pick up the new vars:"
Write-Host "  vercel --prod"
