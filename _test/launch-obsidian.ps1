<#
  Launches Obsidian in Chrome DevTools Protocol mode for the CDP e2e tests.
  The --remote-debugging-port flag only takes effect at startup: we therefore
  kill any existing instance before relaunching.

  -Vault forces opening the target vault by editing %APPDATA%\obsidian\obsidian.json
  (workaround for the "Obsidian reopens the last vault" trap).

  Usage:
    powershell -ExecutionPolicy Bypass -File _test/launch-obsidian.ps1 -Vault "C:\...\satisfactory-test-vault"
#>
param(
  [int]$Port = 9222,
  [Parameter(Mandatory = $true)][string]$Vault
)

$exe = "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe"
if (-not (Test-Path $exe)) { Write-Error "Obsidian not found at $exe"; exit 1 }
$Vault = (Resolve-Path $Vault).Path

# 1) Stop Obsidian (the debug flag only takes effect when the process starts).
$running = Get-Process Obsidian -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "Stopping the existing Obsidian instance..."
  $running | Stop-Process -Force
  Start-Sleep -Milliseconds 800
}

# 2) Force the target vault in obsidian.json (open:true on it only).
$cfgPath = Join-Path $env:APPDATA "obsidian\obsidian.json"
if (Test-Path $cfgPath) {
  $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
  if (-not $cfg.vaults) { $cfg | Add-Member -NotePropertyName vaults -NotePropertyValue (@{}) -Force }
  $targetId = $null
  foreach ($p in $cfg.vaults.PSObject.Properties) {
    $vpath = $p.Value.path
    if ($vpath -and ((Resolve-Path $vpath -ErrorAction SilentlyContinue).Path -eq $Vault)) { $targetId = $p.Name }
    $p.Value.open = $false
  }
  if (-not $targetId) {
    $targetId = -join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
    $entry = [PSCustomObject]@{ path = $Vault; ts = [int64](([datetime]::UtcNow - [datetime]'1970-01-01').TotalMilliseconds); open = $true }
    $cfg.vaults | Add-Member -NotePropertyName $targetId -NotePropertyValue $entry -Force
  } else {
    $cfg.vaults.$targetId.open = $true
  }
  ($cfg | ConvertTo-Json -Depth 10) | Set-Content $cfgPath -Encoding utf8
  Write-Host "Target vault forced in obsidian.json (id $targetId)."
} else {
  Write-Warning "obsidian.json not found: Obsidian will open the last vault."
}

# 3) Launch in debug mode.
Start-Process $exe -ArgumentList "--remote-debugging-port=$Port"
Write-Host "Obsidian launched in debug mode on port $Port."

# 4) Bring the window to the foreground (Chromium pauses rAF when the window is hidden).
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Fg {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
"@
for ($i = 0; $i -lt 24; $i++) {
  Start-Sleep -Milliseconds 500
  $w = Get-Process Obsidian -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($w) {
    [Win32Fg]::ShowWindow($w.MainWindowHandle, 9) | Out-Null
    [Win32Fg]::SetForegroundWindow($w.MainWindowHandle) | Out-Null
    Write-Host "Obsidian window brought to the foreground."
    break
  }
}
Write-Host "Endpoint: http://localhost:$Port/json/version"
