# Fibott — Start bridge service and ngrok tunnel
# Run this every time the machine boots (or configure it in Task Scheduler).
#
# One-time setup: add your ngrok authtoken with:
#   ngrok config add-authtoken <token>
# Your permanent domain: cushy-tapeless-dividable.ngrok-free.app

$NGROK_DOMAIN = "cushy-tapeless-dividable.ngrok-free.app"

$projectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "[fibott] Starting bridge service..."
$bridge = Start-Process -FilePath "node" `
    -ArgumentList "--loader", "ts-node/esm", "infra/bridge/server.ts" `
    -WorkingDirectory $projectRoot `
    -PassThru -NoNewWindow

Write-Host "[fibott] Bridge PID: $($bridge.Id)"
Write-Host "[fibott] Starting ngrok tunnel ($NGROK_DOMAIN)..."

$tunnel = Start-Process -FilePath "ngrok" `
    -ArgumentList "http", "--domain=$NGROK_DOMAIN", "3001", "--log=stdout" `
    -WorkingDirectory $projectRoot `
    -PassThru -NoNewWindow

Write-Host "[fibott] Tunnel PID: $($tunnel.Id)"
Write-Host "[fibott] Bridge URL: https://$NGROK_DOMAIN"
Write-Host "[fibott] Both services running. Press Ctrl+C to stop."

try {
    Wait-Process -Id $bridge.Id
} finally {
    if (-not $bridge.HasExited)  { $bridge.Kill()  }
    if (-not $tunnel.HasExited) { $tunnel.Kill() }
    Write-Host "[fibott] Stopped."
}
