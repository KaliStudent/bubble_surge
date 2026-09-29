param(
  [Parameter(Mandatory=$true)][string]$Origin,
  [Parameter(Mandatory=$true)][ValidateSet('webhook','status','report','refund')][string]$Action,
  [string]$Charge
)
$ErrorActionPreference = 'Stop'
if ($Origin -notmatch '^https://[^/]+$') { throw 'Use the exact HTTPS game origin, with no trailing slash.' }
if ($Action -eq 'refund' -and -not $Charge) { throw 'Refund requires -Charge with the Telegram receipt charge ID.' }
if ($Action -eq 'refund' -and (Read-Host 'This sends a REAL refund and resets premium styles. Type REFUND to continue') -cne 'REFUND') { throw 'Cancelled.' }
$adminValue = Read-Host 'Paste SURGE_ADMIN_SECRET (hidden)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminValue)
try {
  $secretValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $payload = @{ action = $Action }
  if ($Charge) { $payload.charge = $Charge }
  Invoke-RestMethod -Uri "$Origin/api/admin" -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $secretValue" } -Body ($payload | ConvertTo-Json) | ConvertTo-Json -Depth 8
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  $secretValue = $null
  $adminValue.Dispose()
}
