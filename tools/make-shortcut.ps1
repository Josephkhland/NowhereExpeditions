# Creates the desktop shortcut and updates an existing taskbar pin to launch Tauri directly.
# Run: & .\tools\make-shortcut.ps1
# Does not pin/unpin apps, restart Explorer, or change execution/antivirus policy.
[CmdletBinding()]
param([string]$BackupDirectory)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$appFolder = Join-Path $root 'desktop-app'
$executable = Join-Path $appFolder 'src-tauri\target\release\nowhere-expeditions.exe'
if (-not (Test-Path -LiteralPath $executable)) {
    throw 'Build the Tauri release first: run npm run build in desktop-app.'
}

$desktop = [Environment]::GetFolderPath('Desktop')
$desktopLink = Join-Path $desktop 'Nowhere Expeditions.lnk'
$taskbarFolder = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$taskbarLink = Join-Path $taskbarFolder 'Nowhere Expeditions.lnk'
$targets = @(@{ Path = $desktopLink; Name = 'desktop' })
if (Test-Path -LiteralPath $taskbarLink) {
    $targets += @{ Path = $taskbarLink; Name = 'taskbar' }
}
if ($BackupDirectory) {
    New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
}

$shortcutShell = New-Object -ComObject WScript.Shell
foreach ($target in $targets) {
    if ($BackupDirectory -and (Test-Path -LiteralPath $target.Path)) {
        $backup = Join-Path $BackupDirectory ($target.Name + '-before-tauri.lnk')
        if (-not (Test-Path -LiteralPath $backup)) {
            Copy-Item -LiteralPath $target.Path -Destination $backup
        }
    }
    $link = $shortcutShell.CreateShortcut($target.Path)
    $link.TargetPath = $executable
    $link.Arguments = ''
    $link.WorkingDirectory = $appFolder
    $link.IconLocation = "$root\tools\nowhere-expeditions.ico,0"
    $link.Description = 'Nowhere Expeditions toolkit (Tauri)'
    $link.WindowStyle = 1
    $link.Save()

    $verified = $shortcutShell.CreateShortcut($target.Path)
    if ($verified.TargetPath -ne $executable -or $verified.Arguments -ne '') {
        throw "Shortcut verification failed: $($target.Path)"
    }
    Write-Host "Updated $($target.Name): $($target.Path)"
    Write-Host "  Target: $($verified.TargetPath)"
}
