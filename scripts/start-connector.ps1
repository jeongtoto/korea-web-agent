param(
  [Parameter(Mandatory=$true)][string]$CloudUrl,
  [Parameter(Mandatory=$true)][SecureString]$RelaySecret,
  [string]$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe",
  [string]$ProfileDir = "$HOME\.kwa-profile"
)

$plain = [System.Net.NetworkCredential]::new('', $RelaySecret).Password
try {
  $env:KWA_CLOUD_URL = $CloudUrl
  $env:KWA_RELAY_SECRET = $plain
  $env:KWA_PROFILE_DIR = $ProfileDir
  $env:CHROMIUM_PATH = $ChromePath

  Write-Host "Korea Web Agent local connector starting..."
  Write-Host "Cloud: $CloudUrl"
  Write-Host "Profile: $ProfileDir"
  Write-Host "The relay is read-only. Login to Naver/Coupang directly in the dedicated browser window."
  npm run connector
}
finally {
  Remove-Item Env:KWA_RELAY_SECRET -ErrorAction SilentlyContinue
  $plain = $null
}
