param(
  [string]$CloudUrl = "https://korea-web-agent.netlify.app",
  [Parameter(Mandatory=$true)][SecureString]$RelaySecret,
  [string]$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe",
  [string]$ProfileDir = "$HOME\.kwa-profile",
  [string]$RepoDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$TaskName = "KoreaWebAgent"
$ConfigDir = Join-Path $env:LOCALAPPDATA "KoreaWebAgent"
$ConfigPath = Join-Path $ConfigDir "local-agent.json"
$RunnerPath = Join-Path $RepoDir "scripts\run-local-agent.ps1"

if (-not (Test-Path $RunnerPath)) {
  throw "Local agent runner not found: $RunnerPath"
}

New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

# ConvertFrom-SecureString without an explicit key uses Windows DPAPI for the current user.
$EncryptedRelaySecret = ConvertFrom-SecureString $RelaySecret
$Config = @{
  cloudUrl = $CloudUrl
  encryptedRelaySecret = $EncryptedRelaySecret
  chromePath = $ChromePath
  profileDir = $ProfileDir
  repoDir = $RepoDir
} | ConvertTo-Json

Set-Content -Path $ConfigPath -Value $Config -Encoding UTF8

# Restrict the configuration file to the current Windows user.
& icacls.exe $ConfigPath /inheritance:r /grant:r "$($env:USERNAME):(F)" | Out-Null

$ActionArguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -ConfigPath "{1}"' -f $RunnerPath, $ConfigPath
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $ActionArguments
$User = "$env:USERDOMAIN\$env:USERNAME"
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$Settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -StartWhenAvailable -DontStopIfGoingOnBatteries

$TaskParams = @{
  TaskName = $TaskName
  Action = $Action
  Trigger = $Trigger
  Settings = $Settings
  Description = "Korea Web Agent outbound read-only shopping connector"
  Force = $true
}
Register-ScheduledTask @TaskParams | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Korea Web Agent Local Agent installed for this Windows user."
Write-Host "Task: $TaskName"
Write-Host "Config: $ConfigPath"
