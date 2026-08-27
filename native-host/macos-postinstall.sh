#!/bin/sh
set -u

# The package is installed by macOS as root. Resolve the logged-in desktop
# user so CLI credentials and the Native Messaging manifest stay user-scoped.
CONSOLE_USER="${YUNZHONGSHU_CONSOLE_USER:-$(/usr/bin/stat -f '%Su' /dev/console)}"
[ -n "$CONSOLE_USER" ] && [ "$CONSOLE_USER" != root ] || exit 0
USER_HOME="${YUNZHONGSHU_USER_HOME:-$(/usr/bin/dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')}"
[ -n "$USER_HOME" ] || exit 0

APP_DIR="$USER_HOME/.yunzhongshu"
BIN_DIR="$APP_DIR/bin"
NODE_DIR="$APP_DIR/node"
HOST_FILE="$APP_DIR/host.js"
mkdir -p "$BIN_DIR" "$NODE_DIR" 2>/dev/null || exit 0
LOG_FILE="$APP_DIR/install.log"
exec >>"$LOG_FILE" 2>&1
ERRORS=""
fail() { ERRORS="$ERRORS\n$1"; echo "错误：$1"; }
echo "开始安装 $(date)"

ARCH="$(/usr/bin/uname -m)"
case "$ARCH" in
  arm64|aarch64) CLI_ARCH_NAME=arm64; NODE_ARCH_NAME=arm64 ;;
  x86_64|amd64) CLI_ARCH_NAME=amd64; NODE_ARCH_NAME=x64 ;;
  *) fail "不支持的 macOS 架构：$ARCH"; exit 0 ;;
esac

CLI_VERSION=2.6.0
NODE_VERSION=22.14.0
TMP_DIR="$(/usr/bin/mktemp -d)"
trap '/bin/rm -rf "$TMP_DIR"' EXIT

if ! /usr/bin/curl -fL --retry 2 "https://wpsai.wpscdn.cn/skillhub/pro/v${CLI_VERSION}/releases/kdocs-cli-${CLI_VERSION}-darwin-$CLI_ARCH_NAME.tar.gz" -o "$TMP_DIR/cli.tar.gz"; then
  fail "kdocs-cli 下载失败，请检查网络后在插件设置中重试"
else
  /usr/bin/tar xzf "$TMP_DIR/cli.tar.gz" -C "$TMP_DIR" 2>/dev/null || fail "kdocs-cli 压缩包损坏"
  CLI_SOURCE="$(/usr/bin/find "$TMP_DIR" -type f -name kdocs-cli | /usr/bin/head -1)"
  if [ -n "$CLI_SOURCE" ]; then /bin/cp "$CLI_SOURCE" "$BIN_DIR/kdocs-cli" && /bin/chmod 755 "$BIN_DIR/kdocs-cli"; else fail "kdocs-cli 下载包中没有可执行文件"; fi
fi

if ! /usr/bin/curl -fL --retry 2 "https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-$NODE_ARCH_NAME.tar.gz" -o "$TMP_DIR/node.tar.gz"; then
  fail "Node.js 下载失败，请检查网络后在插件设置中重试"
else
  /usr/bin/tar xzf "$TMP_DIR/node.tar.gz" -C "$NODE_DIR" --strip-components=1 2>/dev/null || fail "Node.js 压缩包损坏"
fi

PKG_ROOT="${3:-/}"
if [ -f "$PKG_ROOT/usr/local/share/yunzhongshu/host.js" ]; then
  /bin/cp "$PKG_ROOT/usr/local/share/yunzhongshu/host.js" "$HOST_FILE"
  /bin/rm -rf "$PKG_ROOT/usr/local/share/yunzhongshu"
  /bin/chmod 700 "$HOST_FILE"
else
  fail "找不到 Native Messaging 组件文件"
fi

NODE_BIN="$NODE_DIR/bin/node"
if [ -x "$NODE_BIN" ]; then
  for NM_DIR in "$USER_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" "$USER_HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"; do
    /bin/mkdir -p "$NM_DIR"
    /usr/bin/printf '%s\n' '{"name":"com.yunzhongshu.clipbridge","description":"云中书 WPS 网页剪存","path":"'"$NODE_BIN"'","type":"stdio","args":["'"$HOST_FILE"'"],"allowed_origins":["chrome-extension://fpledbkcofnlandfhncnaohbjdgphmpj/"]}' > "$NM_DIR/com.yunzhongshu.clipbridge.json"
  done
else
  fail "Node.js 未安装，暂未注册浏览器组件"
fi
/bin/chown -R "$CONSOLE_USER" "$APP_DIR"
if [ -x "$BIN_DIR/kdocs-cli" ]; then /usr/bin/sudo -u "$CONSOLE_USER" env HOME="$USER_HOME" PATH="$BIN_DIR:/usr/bin:/bin" "$BIN_DIR/kdocs-cli" auth login || echo "WPS 登录未完成"; fi

if [ -n "$ERRORS" ]; then
  printf '%b\n' "$ERRORS" > "$APP_DIR/install-errors.txt"
  echo "安装未完全成功，详细信息已写入 install-errors.txt"
else
  /bin/rm -f "$APP_DIR/install-errors.txt"
  echo "云中书 WPS 剪存组件安装完成"
fi
exit 0
