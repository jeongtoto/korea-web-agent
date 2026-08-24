param(
  [switch]$RemoveConfig
)

$TaskName = "KoreaWebAgent"
$ConfigDir = Join-Path $env:LOCALAPPDATA "KoreaWebAgent"

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

if ($RemoveConfig -and (Test-Path $ConfigDir)) {
  Remove-Item -Path $ConfigDir -Recurse -Force
}

Write-Host "Korea Web Agent Local Agent task removed."
if (-not $RemoveConfig) {
  Write-Host "Encrypted local configuration was preserved. Use -RemoveConfig to delete it."
}
