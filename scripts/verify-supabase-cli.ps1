$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$cfg = Get-Content -Raw -Path "$PSScriptRoot/../config.json" | ConvertFrom-Json
$baseUrl = $cfg.supabase.url
$anon = $cfg.supabase.anonKey

$commonHeaders = @{ apikey=$anon; Authorization="Bearer $anon" }
$wHeaders = $commonHeaders.Clone()
$wHeaders['Content-Type'] = 'application/json'
$wHeaders['Prefer'] = 'resolution=merge-duplicates,return=representation'

$id = "verify_note_cli_" + [guid]::NewGuid().ToString('N').Substring(0,8)
$body = @{ id=$id; title='probe'; body='ok' } | ConvertTo-Json -Compress

# Insert
Invoke-RestMethod -Method POST -Uri "$baseUrl/rest/v1/notes" -Headers $wHeaders -Body $body | Out-Null
Start-Sleep -Milliseconds 250

# Select (avoid & in query to stay PS5-safe)
$sel = Invoke-RestMethod -Method GET -Uri "$baseUrl/rest/v1/notes?id=eq.$id" -Headers $commonHeaders

# Delete
Invoke-RestMethod -Method DELETE -Uri "$baseUrl/rest/v1/notes?id=eq.$id" -Headers $commonHeaders | Out-Null

# Output
if ($sel -and $sel[0].id -eq $id) {
  Write-Output ("SUPABASE_OK:" + ($sel | ConvertTo-Json -Compress))
} else {
  throw "SUPABASE_FAIL: select returned unexpected payload"
}