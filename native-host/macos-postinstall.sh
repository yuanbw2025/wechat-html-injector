#!/bin/sh
set -eu

# The package is installed by macOS as root. Resolve the logged-in desktop
# user so CLI credentials and the Native Messaging manifest stay user-scoped.
CONSOLE_USER="$(/usr/bin/stat -f '%Su' /dev/console)"
[ -n "$CONSOLE_USER" ] && [ "$CONSOLE_USER" != root ] || { echo '找不到当前登录用户'; exit 1; }
USER_HOME="$(/usr/bin/dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
[ -n "$USER_HOME" ] || { echo '无法找到用户主目录'; exit 1; }

APP_DIR="$USER_HOME/.yunzhongshu"
BIN_DIR="$APP_DIR/bin"
NODE_DIR="$APP_DIR/node"
HOST_FILE="$APP_DIR/host.js"
mkdir -p "$BIN_DIR" "$NODE_DIR"
ARCH="$(/usr/bin/uname -m)"
case "$ARCH" in
  arm64|aarch64) CLI_ARCH_NAME=arm64; NODE_ARCH_NAME=arm64 ;;
  x86_64|amd64) CLI_ARCH_NAME=amd64; NODE_ARCH_NAME=x64 ;;
  *) echo "不支持的 macOS 架构：$ARCH"; exit 1 ;;
esac

CLI_VERSION=2.6.0
NODE_VERSION=22.14.0
TMP_DIR="$(/usr/bin/mktemp -d)"
trap '/bin/rm -rf "$TMP_DIR"' EXIT
/usr/bin/curl -fL --retry 2 "https://wpsai.wpscdn.cn/skillhub/pro/v${CLI_VERSION}/releases/kdocs-cli-${CLI_VERSION}-darwin-$CLI_ARCH_NAME.tar.gz" -o "$TMP_DIR/cli.tar.gz"
/usr/bin/tar xzf "$TMP_DIR/cli.tar.gz" -C "$TMP_DIR"
CLI_SOURCE="$(/usr/bin/find "$TMP_DIR" -type f -name kdocs-cli | /usr/bin/head -1)"
[ -n "$CLI_SOURCE" ] || { echo 'kdocs-cli 下载失败'; exit 1; }
/bin/cp "$CLI_SOURCE" "$BIN_DIR/kdocs-cli"
/bin/chmod 755 "$BIN_DIR/kdocs-cli"
/usr/bin/curl -fL --retry 2 "https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-$NODE_ARCH_NAME.tar.gz" -o "$TMP_DIR/node.tar.gz"
/usr/bin/tar xzf "$TMP_DIR/node.tar.gz" -C "$NODE_DIR" --strip-components=1

/bin/cp "$3/usr/local/share/yunzhongshu/host.js" "$HOST_FILE"
/bin/rm -rf "$3/usr/local/share/yunzhongshu"
/bin/chmod 700 "$HOST_FILE"
for NM_DIR in "$USER_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" "$USER_HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"; do
  /bin/mkdir -p "$NM_DIR"
  /usr/bin/printf '%s\n' '{"name":"com.yunzhongshu.clipbridge","description":"云中书 WPS 网页剪存","path":"'"$NODE_DIR/bin/node"'","type":"stdio","args":["'"$HOST_FILE"'"],"allowed_origins":["chrome-extension://fpledbkcofnlandfhncnaohbjdgphmpj/"]}' > "$NM_DIR/com.yunzhongshu.clipbridge.json"
done
/bin/chown -R "$CONSOLE_USER" "$APP_DIR"
/usr/bin/sudo -u "$CONSOLE_USER" env HOME="$USER_HOME" PATH="$BIN_DIR:/usr/bin:/bin" "$BIN_DIR/kdocs-cli" auth login || true
echo '云中书 WPS 剪存组件安装完成'
