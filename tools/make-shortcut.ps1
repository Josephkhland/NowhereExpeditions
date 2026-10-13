# Puts a "Nowhere Expeditions" shortcut (with its icon) on the desktop of whoever runs this.
#
#   powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1
#
# The shortcut runs tools\start-everything.ps1: content manager, public site and the Discord bot.

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$path = Join-Path $desktop "Nowhere Expeditions.lnk"

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($path)
$link.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = "-ExecutionPolicy Bypass -WindowStyle Minimized -File `"$root\tools\start-everything.ps1`""
$link.WorkingDirectory = $root
$link.IconLocation = "$root\tools\nowhere-expeditions.ico,0"
$link.Description = "Start the content manager, public site and Discord bot (with its dashboard)"
$link.Save()

Write-Host "Shortcut created: $path"
