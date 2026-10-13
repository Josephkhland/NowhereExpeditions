# Starts the Nowhere Expeditions toolkit, each part in its own window:
#   - Content manager   http://127.0.0.1:8001
#   - Public site       http://127.0.0.1:8000
#   - Discord bot       (through run_bot.py, so the dashboard's Restart button works;
#                        the bot opens its own dashboard with the key, http://127.0.0.1:8766)
# then opens the content manager and the site in the browser once they answer.
# Anything already running is left alone.
#
#   powershell -ExecutionPolicy Bypass -File tools\start-everything.ps1 [-NoBot] [-OpenOnly]
#
#   -NoBot     start everything except the bot
#   -OpenOnly  start nothing; just wait for the servers and open the pages (used by VS Code)

param([switch]$NoBot, [switch]$OpenOnly)

$root = Split-Path -Parent $PSScriptRoot
$botFolder = Join-Path $root "discord_server\bot"
$botPython = Join-Path $botFolder ".venv\Scripts\python.exe"

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

if (-not $OpenOnly) {
    if (Test-Port 8001) { Write-Host "Content manager already running." }
    else { Start-Window "Content manager" (Join-Path $root "content-manager") "python app.py" }

    if (Test-Port 8000) { Write-Host "Public site already running." }
    else { Start-Window "Public site" (Join-Path $root "public-site") "python -m http.server 8000 --bind 127.0.0.1" }

    if (-not $NoBot) {
        if (Test-Port 8766) { Write-Host "Bot already running: use the dashboard link in its window." }
        elseif (-not (Test-Path $botPython)) { Write-Host "Bot venv not found at $botPython; skipping the bot." }
        else { Start-Window "Discord bot" $botFolder "& '$botPython' run_bot.py --open-dashboard" }
    }
}

if (Wait-Port 8001) { Start-Process "http://127.0.0.1:8001" } else { Write-Host "Content manager didn't answer on 8001." }
if (Wait-Port 8000) { Start-Process "http://127.0.0.1:8000" } else { Write-Host "Public site didn't answer on 8000." }
