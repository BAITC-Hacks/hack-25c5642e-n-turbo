param([switch]$Production)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $runtimeBin = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin'
    if (Test-Path -LiteralPath (Join-Path $runtimeBin 'node.exe')) { $env:Path = $runtimeBin + ';' + $env:Path }
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    $localNpmBin = Join-Path $PSScriptRoot '.tools'
    if (Test-Path -LiteralPath (Join-Path $localNpmBin 'npm.cmd')) { $env:Path = $localNpmBin + ';' + $env:Path }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22+ with npm, then run this script again.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm is not available. Install Node.js with npm.' }
if ($Production) { & npm.cmd run start } else { & npm.cmd run dev }
exit $LASTEXITCODE
