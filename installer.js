(function () {
  'use strict';
  const HOST_NAME = 'com.yunzhongshu.clipbridge';
  const CLI_VERSION = '2.6.0';
  const NODE_VERSION = '22.14.0';

  async function getHostSource() {
    const response = await fetch(chrome.runtime.getURL('native-host/host.js'));
    if (!response.ok) throw new Error('无法读取本地组件文件');
    return response.text();
  }
  function saveFile(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zipBytes(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const push = bytes => { chunks.push(bytes); offset += bytes.length; };
    const u16 = value => { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); return bytes; };
    const u32 = value => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value >>> 0, true); return bytes; };
    const join = parts => { const size = parts.reduce((sum, part) => sum + part.length, 0); const out = new Uint8Array(size); let cursor = 0; for (const part of parts) { out.set(part, cursor); cursor += part.length; } return out; };
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
      const crc = crc32(data);
      const localOffset = offset;
      const local = join([u32(0x04034b50), u16(20), u16(0x800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
      push(local); push(data);
      central.push(join([u32(0x02014b50), u16(0x0314), u16(20), u16(0x800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32((file.mode || 0o100644) << 16), u32(localOffset), name]));
    }
    const centralOffset = offset;
    for (const entry of central) push(entry);
    const centralSize = offset - centralOffset;
    push(join([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(centralOffset), u16(0)]));
    return join(chunks);
  }
  function saveZip(files, filename) {
    const url = URL.createObjectURL(new Blob([zipBytes(files)], { type: 'application/zip' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function replace(template, source) {
    return template.join('\n').replace('__EXTENSION_ID__', chrome.runtime.id).replace('__HOST_SOURCE__', source);
  }
  function macTemplate() {
    return [
      '#!/bin/sh', 'set -eu', "EXT_ID='__EXTENSION_ID__'", 'APP_DIR="$HOME/.yunzhongshu"', 'BIN_DIR="$APP_DIR/bin"', 'NODE_DIR="$APP_DIR/node"', 'HOST_FILE="$APP_DIR/host.js"',
      'mkdir -p "$BIN_DIR" "$NODE_DIR"', 'ARCH="$(uname -m)"', 'case "$ARCH" in arm64|aarch64) CLI_ARCH_NAME=arm64; NODE_ARCH_NAME=arm64 ;; x86_64|amd64) CLI_ARCH_NAME=amd64; NODE_ARCH_NAME=x64 ;; *) echo "不支持的 macOS 架构：$ARCH"; exit 1 ;; esac',
      'download() { curl -fL --retry 2 "$1" -o "$2"; }', 'echo "正在安装 WPS 剪存组件…"',
      `CLI_ARCHIVE="/tmp/kdocs-cli-${CLI_VERSION}-darwin-$CLI_ARCH_NAME.tar.gz"`, `download "https://wpsai.wpscdn.cn/skillhub/pro/v${CLI_VERSION}/releases/kdocs-cli-${CLI_VERSION}-darwin-$CLI_ARCH_NAME.tar.gz" "$CLI_ARCHIVE"`,
      'TMP_DIR="$(mktemp -d)"; trap \'rm -rf "$TMP_DIR" "$CLI_ARCHIVE"\' EXIT', 'tar xzf "$CLI_ARCHIVE" -C "$TMP_DIR"', 'CLI_SOURCE="$(find "$TMP_DIR" -type f -name kdocs-cli | head -1)"', '[ -n "$CLI_SOURCE" ] || { echo "kdocs-cli 下载失败"; exit 1; }', 'cp "$CLI_SOURCE" "$BIN_DIR/kdocs-cli"; chmod 755 "$BIN_DIR/kdocs-cli"',
      `NODE_ARCHIVE="/tmp/node-${NODE_VERSION}-darwin-$NODE_ARCH_NAME.tar.gz"`, `download "https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-$NODE_ARCH_NAME.tar.gz" "$NODE_ARCHIVE"`, 'tar xzf "$NODE_ARCHIVE" -C "$NODE_DIR" --strip-components=1', 'NODE_BIN="$NODE_DIR/bin/node"',
      'cat > "$HOST_FILE" <<\'HOST_SOURCE\'', '__HOST_SOURCE__', 'HOST_SOURCE', 'chmod 700 "$HOST_FILE"',
      'NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"', 'mkdir -p "$NM_DIR"', 'printf \'%s\\n\' \'{"name":"com.yunzhongshu.clipbridge","description":"云中书 WPS 网页剪存","path":"\'"$NODE_BIN"\'","type":"stdio","args":["\'"$HOST_FILE"\'"],"allowed_origins":["chrome-extension://\'"$EXT_ID"\'/"]}\' > "$NM_DIR/com.yunzhongshu.clipbridge.json"', 'EDGE_NM_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"', 'mkdir -p "$EDGE_NM_DIR"', 'cp "$NM_DIR/com.yunzhongshu.clipbridge.json" "$EDGE_NM_DIR/com.yunzhongshu.clipbridge.json"',
      'echo "正在打开 WPS 登录页面…"', '"$BIN_DIR/kdocs-cli" auth login || echo "WPS 登录未完成，可稍后在插件设置中重新检测。"', 'echo "安装完成，请回到浏览器插件设置页点击检测。"', 'read -r -p "按回车关闭此窗口…" _',
    ];
  }
  function linuxTemplate() {
    return [
      '#!/bin/sh', 'set -eu', "EXT_ID='__EXTENSION_ID__'", 'APP_DIR="$HOME/.yunzhongshu"', 'BIN_DIR="$APP_DIR/bin"', 'NODE_DIR="$APP_DIR/node"', 'HOST_FILE="$APP_DIR/host.js"', 'mkdir -p "$BIN_DIR" "$NODE_DIR"',
      'ARCH="$(uname -m)"; case "$ARCH" in arm64|aarch64) CLI_ARCH_NAME=arm64; NODE_ARCH_NAME=arm64 ;; x86_64|amd64) CLI_ARCH_NAME=amd64; NODE_ARCH_NAME=x64 ;; *) echo "不支持的 Linux 架构：$ARCH"; exit 1 ;; esac',
      `curl -fL "https://wpsai.wpscdn.cn/skillhub/pro/v${CLI_VERSION}/releases/kdocs-cli-${CLI_VERSION}-linux-$CLI_ARCH_NAME.tar.gz" -o /tmp/yunzhongshu-cli.tar.gz`, 'TMP_DIR="$(mktemp -d)"; trap \'rm -rf "$TMP_DIR" /tmp/yunzhongshu-cli.tar.gz\' EXIT', 'tar xzf /tmp/yunzhongshu-cli.tar.gz -C "$TMP_DIR"', 'CLI_SOURCE="$(find "$TMP_DIR" -type f -name kdocs-cli | head -1)"; [ -n "$CLI_SOURCE" ] || { echo "kdocs-cli 下载失败"; exit 1; }; cp "$CLI_SOURCE" "$BIN_DIR/kdocs-cli"; chmod 755 "$BIN_DIR/kdocs-cli"',
      `curl -fL "https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-$NODE_ARCH_NAME.tar.gz" -o /tmp/yunzhongshu-node.tar.gz`, 'tar xzf /tmp/yunzhongshu-node.tar.gz -C "$NODE_DIR" --strip-components=1',
      'cat > "$HOST_FILE" <<\'HOST_SOURCE\'', '__HOST_SOURCE__', 'HOST_SOURCE', 'chmod 700 "$HOST_FILE"', 'NM_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"; mkdir -p "$NM_DIR"', 'printf \'%s\\n\' \'{"name":"com.yunzhongshu.clipbridge","description":"云中书 WPS 网页剪存","path":"\'"$NODE_DIR/bin/node"\'","type":"stdio","args":["\'"$HOST_FILE"\'"],"allowed_origins":["chrome-extension://\'"$EXT_ID"\'/"]}\' > "$NM_DIR/com.yunzhongshu.clipbridge.json"', '"$BIN_DIR/kdocs-cli" auth login || true', 'echo "安装完成，请回到插件设置页点击检测。"', 'EDGE_NM_DIR="$HOME/.config/microsoft-edge/NativeMessagingHosts"', 'mkdir -p "$EDGE_NM_DIR"', 'cp "$NM_DIR/com.yunzhongshu.clipbridge.json" "$EDGE_NM_DIR/com.yunzhongshu.clipbridge.json"', 'read -r -p "按回车关闭…" _',
    ];
  }
  function windowsTemplate() {
    return [
      "$ErrorActionPreference = 'Stop'", "$ExtensionId = '__EXTENSION_ID__'", "$AppDir = Join-Path $env:LOCALAPPDATA 'Yunzhongshu'", "$BinDir = Join-Path $AppDir 'bin'", "$NodeDir = Join-Path $AppDir 'node'", "$HostFile = Join-Path $AppDir 'host.js'", 'New-Item -ItemType Directory -Force -Path $BinDir,$NodeDir | Out-Null',
      "$tmp = Join-Path $env:TEMP ('yunzhongshu-' + [guid]::NewGuid()); New-Item -ItemType Directory -Force $tmp | Out-Null", 'try {',
      `  Invoke-WebRequest 'https://wpsai.wpscdn.cn/skillhub/pro/v${CLI_VERSION}/releases/kdocs-cli-${CLI_VERSION}-windows-amd64.zip' -OutFile (Join-Path $tmp 'cli.zip')`, "  Expand-Archive (Join-Path $tmp 'cli.zip') (Join-Path $tmp 'cli') -Force", "  $cli = Get-ChildItem (Join-Path $tmp 'cli') -Recurse -Filter 'kdocs-cli.exe' | Select-Object -First 1; if (-not $cli) { throw 'kdocs-cli 下载包中没有找到可执行文件' }; Copy-Item $cli.FullName (Join-Path $BinDir 'kdocs-cli.exe') -Force",
      `  Invoke-WebRequest 'https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip' -OutFile (Join-Path $tmp 'node.zip')`, "  Expand-Archive (Join-Path $tmp 'node.zip') $NodeDir -Force", '  $nodeBin = (Get-ChildItem $NodeDir -Recurse -Filter node.exe | Select-Object -First 1).FullName', "  @'", '__HOST_SOURCE__', "'@ | Set-Content -Encoding UTF8 $HostFile",
      "  $manifestDir = Join-Path $AppDir 'NativeMessagingHosts'; New-Item -ItemType Directory -Force $manifestDir | Out-Null", "  $manifestPath = Join-Path $manifestDir 'com.yunzhongshu.clipbridge.json'", "  @{name='com.yunzhongshu.clipbridge';description='云中书 WPS 网页剪存';path=$nodeBin;type='stdio';args=@($HostFile);allowed_origins=@(\"chrome-extension://$ExtensionId/\")} | ConvertTo-Json -Compress | ForEach-Object { [System.IO.File]::WriteAllText($manifestPath, $_, (New-Object System.Text.UTF8Encoding($false))) }", "  foreach($key in @('HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.yunzhongshu.clipbridge','HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.yunzhongshu.clipbridge')) { New-Item -Path $key -Force | Out-Null; Set-ItemProperty -Path $key -Name '(default)' -Value $manifestPath }", "  & (Join-Path $BinDir 'kdocs-cli.exe') auth login", '} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }', "Write-Host '安装完成，请回到插件设置页点击检测。'; Read-Host '按回车关闭'",
    ];
  }
  async function downloadInstaller(platform) {
    if (platform === 'mac') {
      const response = await fetch(chrome.runtime.getURL('native-host/macos-installer.pkg'));
      if (!response.ok) throw new Error('无法读取 macOS 安装包');
      saveFile(new Uint8Array(await response.arrayBuffer()), '云中书-WPS剪存安装器.pkg');
      return;
    }
    const source = await getHostSource();
    if (platform === 'linux') saveFile(replace(linuxTemplate(), source), 'yunzhongshu-wps-clip-install.sh');
    if (platform === 'windows') saveFile(replace(windowsTemplate(), source), '云中书-WPS剪存安装.ps1');
  }
  window.YunzhongshuInstaller = { downloadInstaller };
})();
