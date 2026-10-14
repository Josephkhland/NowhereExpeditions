# Starts the Nowhere Expeditions toolkit:
#   - Content manager   http://127.0.0.1:8001
#   - Public site       http://127.0.0.1:8000
#   - Table insights    http://127.0.0.1:8002 (private transcript stats and moments review)
#   - Discord bot       (through run_bot.py, so the dashboard's Restart button works;
#                        the bot hands its dashboard, with the key, to the app: http://127.0.0.1:8766)
# With the Nowhere Expeditions desktop app installed (npm install in desktop-app/), the app runs them
# all itself, in its Terminal tab, and shows each in its own tab; running this again just brings that
# window to the front. Without the app (or with -Browser), each starts in its own PowerShell window
# and the pages open in the browser.
# Anything already running is left alone.
#
#   powershell -ExecutionPolicy Bypass -File tools\start-everything.ps1 [-NoBot] [-NoInsights] [-OpenOnly] [-Browser]
#
#   -NoBot       start everything except the bot
#   -NoInsights  start everything except table insights
#   -OpenOnly    start nothing; just open the app (or the pages) (used by VS Code)
#   -Browser     open the pages in the browser instead of the app

param([switch]$NoBot, [switch]$NoInsights, [switch]$OpenOnly, [switch]$Browser)

$root = Split-Path -Parent $PSScriptRoot
$botFolder = Join-Path $root "discord_server\bot"
$botPython = Join-Path $botFolder ".venv\Scripts\python.exe"
$appFolder = Join-Path $root "desktop-app"
$electron = Join-Path $appFolder "node_modules\electron\dist\electron.exe"
$useApp = (-not $Browser) -and (Test-Path $electron)

function Test-Port([int]$port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect("127.0.0.1", $port); return $true } catch { return $false } finally { $client.Close() }
}

function Wait-Port([int]$port, [int]$seconds = 30) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Start-Window([string]$title, [string]$folder, [string]$command) {
    $script = "`$host.UI.RawUI.WindowTitle = '$title'; $command"
    Start-Process powershell -WorkingDirectory $folder -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $script
}

# The app starts the servers and the bot itself. A second launch only focuses the window that's already open.
if ($useApp) {
    $appArgs = @("`"$appFolder`"")
    if ($OpenOnly) { $appArgs += "--open-only" }
    if ($NoBot) { $appArgs += "--no-bot" }
    if ($NoInsights) { $appArgs += "--no-insights" }
    Start-Process -FilePath $electron -ArgumentList $appArgs -WorkingDirectory $appFolder
    return
}

if (-not $OpenOnly) {
    if (Test-Port 8001) { Write-Host "Content manager already running." }
    else { Start-Window "Content manager" (Join-Path $root "content-manager") "python app.py" }

    if (Test-Port 8000) { Write-Host "Public site already running." }
    else { Start-Window "Public site" (Join-Path $root "public-site") "python -m http.server 8000 --bind 127.0.0.1" }

    if (-not $NoInsights) {
        if (Test-Port 8002) { Write-Host "Table insights already running." }
        else { Start-Window "Table insights" (Join-Path $root "table-insights") "python -I app.py" }
    }

    if (-not $NoBot) {
        if (Test-Port 8766) { Write-Host "Bot already running." }
        elseif (-not (Test-Path $botPython)) { Write-Host "Bot venv not found at $botPython; skipping the bot." }
        else { Start-Window "Discord bot" $botFolder "& '$botPython' run_bot.py --open-dashboard" }
    }
}

if (Wait-Port 8001) { Start-Process "http://127.0.0.1:8001" } else { Write-Host "Content manager didn't answer on 8001." }
if (Wait-Port 8000) { Start-Process "http://127.0.0.1:8000" } else { Write-Host "Public site didn't answer on 8000." }
if (-not $NoInsights) {
    if (Wait-Port 8002) { Start-Process "http://127.0.0.1:8002" } else { Write-Host "Table insights didn't answer on 8002." }
}
