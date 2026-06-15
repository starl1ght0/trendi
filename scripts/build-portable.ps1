$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$nodeVersion = "20.19.2"
$distRoot = Join-Path $PWD "dist\TrendChartsPortable"
$appDest = Join-Path $distRoot "app"
$nodeDest = Join-Path $distRoot "node"
$dataDest = Join-Path $distRoot "data"
$cacheDir = Join-Path $PWD "dist\.cache"
$nodeZip = Join-Path $cacheDir "node-v$nodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip"

Write-Host "=== Build TrendCharts portable ===" -ForegroundColor Cyan

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found. Install Node.js from https://nodejs.org/"
}

Write-Host "Installing project dependencies..."
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Test-Path $distRoot) {
    Remove-Item $distRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $appDest -Force | Out-Null
New-Item -ItemType Directory -Path $dataDest -Force | Out-Null
New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null

Write-Host "Copying app files..."
$appFiles = @(
    "index.js",
    "db.js",
    "launcher.js",
    "package.json",
    "package-lock.json"
)
foreach ($file in $appFiles) {
    if (Test-Path $file) {
        Copy-Item $file (Join-Path $appDest $file) -Force
    }
}

Copy-Item "public" (Join-Path $appDest "public") -Recurse -Force

Write-Host "Installing app dependencies..."
Push-Location $appDest
npm install --omit=dev
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
Pop-Location

$localDb = Join-Path $PWD "data\trends.db"
if (Test-Path $localDb) {
    Copy-Item $localDb (Join-Path $dataDest "trends.db") -Force
    Write-Host "Copied database: data\trends.db"
} else {
    Write-Host "No local data\trends.db - will be created on first run." -ForegroundColor Yellow
    Write-Host "Export from PostgreSQL: npm run export-db"
}

if (-not (Test-Path $nodeZip)) {
    Write-Host "Downloading portable Node.js v$nodeVersion..."
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
}

Write-Host "Extracting Node.js..."
Expand-Archive -Path $nodeZip -DestinationPath $cacheDir -Force
$nodeSrc = Join-Path $cacheDir "node-v$nodeVersion-win-x64"
if (Test-Path $nodeDest) { Remove-Item $nodeDest -Recurse -Force }
Copy-Item $nodeSrc $nodeDest -Recurse -Force

Write-Host "Building TrendCharts.exe..."
$launcherCs = Join-Path $PWD "scripts\launcher.cs"
$exeOut = Join-Path $distRoot "TrendCharts.exe"
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $csc)) {
    throw "C# compiler not found at $csc"
}

& $csc /nologo /target:exe /out:$exeOut $launcherCs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path $exeOut)) {
    throw "Failed to build TrendCharts.exe"
}

$cmdLauncher = @"
@echo off
cd /d "%~dp0"
set DB_PATH=%~dp0data\trends.db
cd /d "%~dp0app"
"%~dp0node\node.exe" launcher.js
pause
"@
Set-Content -Path (Join-Path $distRoot "TrendCharts.cmd") -Value $cmdLauncher -Encoding ASCII

Set-Content -Path (Join-Path $distRoot ".env") -Value "PORT=3000`n" -Encoding UTF8

$readmePath = Join-Path $distRoot "README_PORTABLE.txt"
@(
    "TrendChartsForArchivarius - portable"
    ""
    "ZAPUSK: dvazhdy shchelknite TrendCharts.exe"
    "PERENOS: skopiruyte vsyu papku TrendChartsPortable na drugoy PK"
    "BAZA: data/trends.db (edet vmeste s papkoy)"
    "OSTANOVKA: zakroyte okno konsoli"
    "ADRES: http://localhost:3000"
    ""
    "Zapasnoj zapusk: TrendCharts.cmd"
) | Set-Content -Path $readmePath -Encoding UTF8

node (Join-Path $PWD "scripts\write-readme-ru.js") $distRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
Write-Host "Portable folder: $distRoot"
Write-Host "Run: $(Join-Path $distRoot 'TrendCharts.exe')"
