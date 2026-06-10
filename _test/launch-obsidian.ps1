<#
  Lance Obsidian en mode Chrome DevTools Protocol pour les tests e2e CDP.
  Le flag --remote-debugging-port ne prend effet qu'au demarrage : on tue donc
  toute instance existante avant de relancer.

  -Vault force l'ouverture du vault cible en editant %APPDATA%\obsidian\obsidian.json
  (parade au piege "Obsidian rouvre le dernier vault").

  Usage :
    powershell -ExecutionPolicy Bypass -File _test/launch-obsidian.ps1 -Vault "C:\...\satisfactory-test-vault"
#>
param(
  [int]$Port = 9222,
  [Parameter(Mandatory = $true)][string]$Vault
)

$exe = "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe"
if (-not (Test-Path $exe)) { Write-Error "Obsidian introuvable a $exe"; exit 1 }
$Vault = (Resolve-Path $Vault).Path

# 1) Arreter Obsidian (le flag debug n'agit qu'au demarrage du process).
$running = Get-Process Obsidian -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "Arret de l'instance Obsidian existante..."
  $running | Stop-Process -Force
  Start-Sleep -Milliseconds 800
}

# 2) Forcer le vault cible dans obsidian.json (open:true uniquement sur lui).
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
  Write-Host "Vault cible force dans obsidian.json (id $targetId)."
} else {
  Write-Warning "obsidian.json introuvable : Obsidian ouvrira le dernier vault."
}

# 3) Lancer en debug.
Start-Process $exe -ArgumentList "--remote-debugging-port=$Port"
Write-Host "Obsidian lance en debug sur le port $Port."

# 4) Mettre la fenetre au premier plan (Chromium met les rAF en pause si masquee).
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
    Write-Host "Fenetre Obsidian au premier plan."
    break
  }
}
Write-Host "Endpoint : http://localhost:$Port/json/version"
