$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Join-Path $root 'host-manifest.json'
if (!(Test-Path $manifest)) { throw '请先准备 host-manifest.json' }
$target = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\NativeMessagingHosts'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item $manifest (Join-Path $target 'com.yunzhongshu.clipbridge.json') -Force
New-Item -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.yunzhongshu.clipbridge' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.yunzhongshu.clipbridge' -Name '(default)' -Value (Join-Path $target 'com.yunzhongshu.clipbridge.json')
Write-Host 'Native Messaging host 已注册。请重新加载扩展。'
