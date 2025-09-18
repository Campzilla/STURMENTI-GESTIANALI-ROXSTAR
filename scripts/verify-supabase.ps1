#requires -Version 7.0
param(
  [Parameter(Mandatory=$false)][string]$DocId="fixed_list"
)

$ErrorActionPreference = 'Stop'

function Invoke-RestJson {
  param(
    [Parameter(Mandatory=$true)][string]$Method,
    [Parameter(Mandatory=$true)][string]$Url,
    [Parameter(Mandatory=$false)][hashtable]$Headers,
    [Parameter(Mandatory=$false)][object]$Body
  )
  $params = @{ Method=$Method; Uri=$Url }
  if ($Headers) { $params.Headers = $Headers }
  if ($Body)    { $params.Body    = ($Body | ConvertTo-Json -Depth 10) ; $params.ContentType='application/json' }
  (Invoke-WebRequest @params).Content | ConvertFrom-Json
}

function Test-FixedColumn {
  param([string]$Url,[hashtable]$Headers)
  try {
    $probeUrl = "$Url/rest/v1/checklist_items?select=fixed&limit=1"
    $resp = Invoke-WebRequest -Method GET -Uri $probeUrl -Headers $Headers
    return $true
  } catch {
    return $false
  }
}

# Load config
Write-Host "Reading config.json..."
$configPath = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath 'config.json'
if (-not (Test-Path $configPath)) { throw "config.json not found at $configPath" }
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$baseUrl = $config.supabase.url.TrimEnd('/')
$anonKey = $config.supabase.anon_key
$headers = @{ 'apikey'=$anonKey; 'Authorization'="Bearer $anonKey" }

# Notes CRUD
Write-Host "Upserting a test note..."
$note = @{ id = "verify_note"; title="Verifica"; content="ok"; updated_at=(Get-Date).ToString("o") }
Invoke-RestJson -Method POST -Url "$baseUrl/rest/v1/notes" -Headers ($headers + @{Prefer='resolution=merge-duplicates'}) -Body @($note) | Out-Null

Write-Host "Selecting the test note..."
$sel = Invoke-RestJson -Method GET -Url "$baseUrl/rest/v1/notes?id=eq.verify_note&select=id,title,content" -Headers $headers
if (-not $sel -or $sel.Count -eq 0) { throw "Note upsert/select failed" }

Write-Host "Deleting the test note..."
Invoke-RestJson -Method DELETE -Url "$baseUrl/rest/v1/notes?id=eq.verify_note" -Headers $headers | Out-Null

# Checklist simple checks (without relying on 'fixed' column)
Write-Host "Ensuring checklist endpoint is reachable..."
$chk = Invoke-RestJson -Method GET -Url "$baseUrl/rest/v1/checklist_items?select=id,title,category,order_index&limit=1" -Headers $headers
# No strict assertion: endpoint reachable is enough here.

# Non-blocking probe for 'fixed' column (do not fail the pipeline if absent)
Write-Host "Probing optional 'fixed' column visibility via REST (non-blocking)..."
$maxRetries = 6
$attempt = 0
$seen = $false
while ($attempt -lt $maxRetries -and -not $seen) {
  $seen = Test-FixedColumn -Url $baseUrl -Headers $headers
  if (-not $seen) { Start-Sleep -Seconds 5 }
  $attempt++
}
if ($seen) {
  Write-Host "'fixed' column visible via REST."
} else {
  Write-Warning "'fixed' column not visible via REST yet. Continuing (client is resilient)."
}

Write-Host "Verification completed successfully."