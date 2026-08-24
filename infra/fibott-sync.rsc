# fibott-sync.rsc — Fibott Outbound Router Sync
# Paste this script into the RouterOS terminal (Winbox → New Terminal, or SSH).
# It creates the fibott-sync script and background scheduler that polls
# https://fibott.vercel.app/api/mikrotik/sync every 3 seconds.
#
# Requirements:
#   - Router must have outbound HTTPS internet access
#   - The 1hour hotspot profile must exist (/ip hotspot user profile print)
#   - MIKROTIK_SYNC_KEY in Vercel must match :local syncKey below

/system script add name=fibott-sync policy=read,write,test source="
:local syncKey \"f8a92e104d5b6c7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a\"
:local appUrl \"https://fibott.vercel.app/api/mikrotik/sync\"

:do {
  :local fetchUrl \"\$appUrl?key=\$syncKey\"
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
      :local confirmUrl \"\$appUrl?confirm=\$vId\"
      :if ([:len \$syncKey] > 0) do={ :set confirmUrl \"\$appUrl?key=\$syncKey&confirm=\$vId\" }
      /tool fetch url=\$confirmUrl mode=https output=user
      :log info (\"Fibott: Created hotspot user \$vCode\")
    } on-error={
      :log error (\"Fibott: Failed to create user \$vCode\")
    }
  }
} on-error={}
"

/system scheduler add name=fibott-sync-scheduler interval=3s on-event=fibott-sync
