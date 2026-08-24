param(
  [Parameter(Mandatory=$true)][string]$ConfigPath
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $ConfigPath)) {
  throw "Local agent configuration not found."
}

$Config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
$SecureSecret = ConvertTo-SecureString $Config.encryptedRelaySecret
$PlainSecret = [System.Net.NetworkCredential]::new('', $SecureSecret).Password

try {
  $env:KWA_CLOUD_URL = [string]$Config.cloudUrl
  $env:KWA_RELAY_SECRET = $PlainSecret
  $env:KWA_PROFILE_DIR = [string]$Config.profileDir
  if ($Config.chromePath) {
    $env:CHROMIUM_PATH = [string]$Config.chromePath
  }

  Push-Location ([string]$Config.repoDir)
  try {
    npm run local-agent
  }
  finally {
    Pop-Location
  }
}
finally {
  Remove-Item Env:KWA_RELAY_SECRET -ErrorAction SilentlyContinue
  $PlainSecret = $null
}
